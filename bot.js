/**
 * clud bot — the other side of CLUDE
 * 
 * ONLY TWO JOBS:
 * 1. Reply to mentions fast, with memory
 * 2. Tweet thoughts organically
 * 
 * No pipeline. No articles. No marketing. Just clud being clud.
 */

const crypto = require('crypto');
const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const { initBrain, remember, recall, getBrain, brainStats, startDreamSchedule, onDream } = require('./brain');
const { getSystemPrompt, getReplyPrompt, getCommunityPostPrompt } = require('./llm-personality');
const { chat } = require('./lib/openrouter');
const { getPrice, formatPrice, isPriceQuery, extractCoinFromQuery } = require('./price-oracle');
const { getCludData, getTokenData, formatOnChainContext } = require('./chain-data');

// ============ CONFIG ============
const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;
const BEARER = process.env.X_BEARER_TOKEN;
const USER_ID = process.env.USER_ID;
const MENTION_POLL_MS = 20 * 1000; // 20s
const THOUGHT_INTERVAL_MS = 60 * 60 * 1000; // tweet a thought every 60min
const MAX_REPLY_LENGTH = 200;

// ============ LOCAL DB (dedup only) ============
const db = new Database(path.join(__dirname, 'db', 'clud.db'));
db.exec(`CREATE TABLE IF NOT EXISTS processed_tweets (
  tweet_id TEXT PRIMARY KEY,
  processed_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS posted_tweets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT UNIQUE,
  text TEXT,
  type TEXT,
  posted_at TEXT DEFAULT (datetime('now'))
)`);

function isProcessed(tweetId) {
  return !!db.prepare('SELECT 1 FROM processed_tweets WHERE tweet_id = ?').get(tweetId);
}
function markProcessed(tweetId) {
  db.prepare('INSERT OR IGNORE INTO processed_tweets (tweet_id) VALUES (?)').run(tweetId);
}
function recordPost(tweetId, text, type) {
  db.prepare('INSERT OR IGNORE INTO posted_tweets (tweet_id, text, type) VALUES (?, ?, ?)').run(tweetId, text, type);
}

// Anti-double-post: check last post time
function canPost() {
  const last = db.prepare('SELECT posted_at FROM posted_tweets ORDER BY id DESC LIMIT 1').get();
  if (!last) return true;
  const diff = Date.now() - new Date(last.posted_at + 'Z').getTime();
  return diff > 5 * 60 * 1000; // 5 min minimum between posts
}

// ============ TWITTER AUTH ============
function pct(s) { return encodeURIComponent(s); }

function oauthSign(method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: CK, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: AT, oauth_version: '1.0'
  };
  const all = { ...oauth, ...params };
  const sorted = Object.keys(all).sort().map(k => `${pct(k)}=${pct(all[k])}`).join('&');
  const base = `${method}&${pct(url)}&${pct(sorted)}`;
  const key = `${pct(CS)}&${pct(AS)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

function tweet(text, replyToId = null) {
  return new Promise((resolve) => {
    const url = 'https://api.twitter.com/2/tweets';
    const body = replyToId 
      ? JSON.stringify({ text, reply: { in_reply_to_tweet_id: replyToId } })
      : JSON.stringify({ text });
    const auth = oauthSign('POST', url);
    const req = https.request({
      hostname: 'api.twitter.com', path: '/2/tweets', method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ============ MENTION HANDLING ============
let lastMentionId = null;
// Load last processed from DB
try {
  const last = db.prepare('SELECT tweet_id FROM processed_tweets ORDER BY rowid DESC LIMIT 1').get();
  if (last) lastMentionId = last.tweet_id;
} catch (e) {}

async function pollMentions() {
  try {
    let url = `https://api.twitter.com/2/users/${USER_ID}/mentions?max_results=10&tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id&expansions=author_id&user.fields=username`;
    if (lastMentionId) url += `&since_id=${lastMentionId}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${decodeURIComponent(BEARER)}` }
    });
    const data = await res.json();

    if (!data.data || data.data.length === 0) return;

    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u.username; });

    // Process oldest first
    for (const mention of data.data.reverse()) {
      if (isProcessed(mention.id)) continue;
      if (mention.author_id === USER_ID) { markProcessed(mention.id); continue; }

      const username = users[mention.author_id] || 'anon';
      const text = mention.text.replace(/@\w+/g, '').trim();

      console.log(`[MENTION] @${username}: "${text.substring(0, 60)}..."`);

      await handleReply(username, text, mention.id, mention.author_id);
      markProcessed(mention.id);

      // Update cursor
      if (!lastMentionId || BigInt(mention.id) > BigInt(lastMentionId)) {
        lastMentionId = mention.id;
      }
    }
  } catch (e) {
    console.error('[MENTION] poll error:', e.message);
  }
}

async function handleReply(username, messageText, tweetId, authorId) {
  const brain = getBrain();
  
  // 1. Recall memories about this user + topic
  let memories = [];
  let memoryContext = '';
  if (brain) {
    try {
      // Recall by user
      const userMemories = await brain.recall({
        query: messageText,
        relatedUser: username,
        limit: 3,
        trackAccess: true,
      });
      // Recall by topic
      const topicMemories = await brain.recall({
        query: messageText,
        limit: 3,
        trackAccess: true,
      });
      
      // Merge and dedupe
      const seen = new Set();
      memories = [...userMemories, ...topicMemories].filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      }).slice(0, 5);

      if (memories.length > 0) {
        memoryContext = brain.formatContext(memories);
        console.log(`[BRAIN] recalled ${memories.length} memories for @${username}`);
      }
    } catch (e) {
      console.error('[BRAIN] recall failed:', e.message);
    }
  }

  // 2. Check for price queries and get on-chain data
  let chainContext = '';
  if (isPriceQuery(messageText)) {
    const coin = extractCoinFromQuery(messageText);
    if (coin) {
      const priceData = await getPrice(coin);
      if (priceData) {
        chainContext = `\n=== LIVE PRICE DATA ===\n${formatPrice(priceData)}\n=== END PRICE ===\nIMPORTANT: use this REAL data in your reply. never fabricate prices.\n`;
      }
    }
  }
  // Get $CLUD data if someone asks about the token
  if (messageText.toLowerCase().includes('clud') || messageText.toLowerCase().includes('token') || messageText.toLowerCase().includes('price')) {
    const cludData = await getCludData();
    if (cludData) {
      chainContext += formatOnChainContext(cludData);
    }
  }

  // 3. Generate reply with memory context + chain data
  const prompt = getReplyPrompt(username, messageText, memoryContext + chainContext);
  let reply;
  try {
    reply = await chat(prompt.user, {
      systemPrompt: prompt.system,
      maxTokens: 120,
      temperature: 0.85,
    });
    reply = reply.replace(/^["']|["']$/g, '').trim();
    if (reply.length > MAX_REPLY_LENGTH) {
      const cut = reply.lastIndexOf(' ', MAX_REPLY_LENGTH);
      reply = reply.substring(0, cut > 50 ? cut : MAX_REPLY_LENGTH);
    }
  } catch (e) {
    console.error('[LLM] reply failed:', e.message);
    return;
  }

  // 3. Post reply
  const result = await tweet(reply, tweetId);
  if (result?.data?.id) {
    console.log(`[REPLY] → @${username}: "${reply.substring(0, 60)}..."`);
    recordPost(result.data.id, reply, 'reply');
  } else {
    console.error('[REPLY] failed:', JSON.stringify(result?.errors || result)?.substring(0, 200));
    return;
  }

  // 4. Store BOTH the user's message AND our reply as memories
  if (brain) {
    try {
      // Store their message
      const theirId = await brain.store({
        type: 'episodic',
        content: `@${username} said: "${messageText}"`,
        summary: `conversation with @${username}`,
        source: 'x-mention',
        sourceId: tweetId,
        relatedUser: username,
        tags: ['conversation', 'mention'],
      });

      // Store our reply
      const ourId = await brain.store({
        type: 'episodic',
        content: `i replied to @${username}: "${reply}"`,
        summary: `my reply to @${username}`,
        source: 'x-reply',
        relatedUser: username,
        tags: ['conversation', 'reply'],
      });

      // Link the two memories
      if (theirId && ourId) {
        await brain.link(theirId, ourId, 'follows');
        console.log(`[BRAIN] stored + linked conversation with @${username} (${theirId} → ${ourId})`);
      }

      // Auto-infer concepts
      const concepts = brain.inferConcepts(
        `conversation with @${username}: ${messageText}`,
        'x-mention',
        ['conversation']
      );
      if (concepts && concepts.length > 0) {
        console.log(`[BRAIN] concepts: ${concepts.join(', ')}`);
      }
    } catch (e) {
      console.error('[BRAIN] store failed:', e.message);
    }
  }
}

// ============ ORGANIC THOUGHTS ============
async function postThought() {
  if (!canPost()) {
    console.log('[THOUGHT] too soon since last post, skipping');
    return;
  }

  const brain = getBrain();
  let memoryContext = '';

  // Pull $CLUD on-chain data for context
  const cludData = await getCludData();
  if (cludData) {
    memoryContext += formatOnChainContext(cludData);
  }

  // Pull recent memories for context
  if (brain) {
    try {
      const recent = await brain.recent(6); // last 6 hours
      if (recent.length > 0) {
        memoryContext = brain.formatContext(recent.slice(0, 5));
      }

      // Also get self-model for identity context
      const selfModel = await brain.selfModel();
      if (selfModel.length > 0) {
        memoryContext += '\n=== SELF MODEL ===\n';
        memoryContext += selfModel.map(m => m.content).join('\n');
      }
    } catch (e) { /* continue without context */ }
  }

  // Pick a thought type
  const types = ['random', 'pattern', 'culture', 'brain', 'memory', 'mission'];
  const type = types[Math.floor(Math.random() * types.length)];

  const prompt = getCommunityPostPrompt(type, memoryContext);
  let thought;
  try {
    thought = await chat(prompt.user, {
      systemPrompt: prompt.system,
      maxTokens: 150,
      temperature: 0.9,
    });
    thought = thought.replace(/^["']|["']$/g, '').trim();
    if (thought.length > 280) {
      const cut = thought.lastIndexOf('.', 278);
      thought = cut > 100 ? thought.substring(0, cut + 1) : thought.substring(0, 278);
    }
    if (thought.length < 10) return; // too short, skip
  } catch (e) {
    console.error('[THOUGHT] generation failed:', e.message);
    return;
  }

  // Post
  const result = await tweet(thought);
  if (result?.data?.id) {
    console.log(`[THOUGHT] posted: "${thought.substring(0, 60)}..."`);
    recordPost(result.data.id, thought, 'thought');

    // Store the thought as a memory
    if (brain) {
      try {
        await brain.store({
          type: 'episodic',
          content: `i tweeted: "${thought}"`,
          summary: 'organic thought i posted',
          source: 'x-thought',
          sourceId: result.data.id,
          tags: ['my_tweet', 'thought', type],
        });
      } catch (e) { /* non-critical */ }
    }
  } else {
    console.error('[THOUGHT] tweet failed:', JSON.stringify(result?.errors || result)?.substring(0, 200));
  }
}

// ============ DREAM CYCLE → TWEET ============
function setupDreamTweets() {
  onDream(async (emergenceText) => {
    if (!emergenceText || emergenceText.length < 20) return;
    if (!canPost()) return;

    // Trim dream output for a tweet
    let dreamTweet = emergenceText;
    if (dreamTweet.length > 280) {
      const cut = dreamTweet.lastIndexOf('.', 278);
      dreamTweet = cut > 100 ? dreamTweet.substring(0, cut + 1) : dreamTweet.substring(0, 278);
    }

    const result = await tweet(dreamTweet);
    if (result?.data?.id) {
      console.log(`[DREAM] tweeted emergence: "${dreamTweet.substring(0, 60)}..."`);
      recordPost(result.data.id, dreamTweet, 'dream');
    }
  });
}

// ============ MEMORY EVENTS ============
function setupMemoryEvents() {
  const brain = getBrain();
  if (!brain) return;

  brain.on('memory:stored', (payload) => {
    console.log(`[BRAIN] memory stored | type: ${payload.memoryType} | importance: ${payload.importance?.toFixed(2)}`);
  });
}

// ============ START ============
async function start() {
  console.log('[CLUD] initializing...');

  // Init brain
  await initBrain();
  setupMemoryEvents();
  setupDreamTweets();

  // Start dream schedule (6hr cycles)
  startDreamSchedule();

  // Store boot memory
  const brain = getBrain();
  if (brain) {
    await brain.store({
      type: 'self_model',
      content: 'i am clud. CLUDE without the e. the first AI agent running on CLUDE cognitive architecture. i am here to prove this tech can send $CLUD to $1B. i remember everything. my memories are on-chain. i am the other side of CLUDE.',
      summary: 'core identity: clud, CLUDE-powered, mission $1B',
      source: 'boot',
      tags: ['identity', 'core', 'mission'],
      importance: 0.99,
    });
    
    const stats = await brainStats();
    console.log(`[BRAIN] ${stats?.total || 0} memories loaded`);
  }

  // Start mention polling
  console.log(`[CLUD] polling mentions every ${MENTION_POLL_MS / 1000}s`);
  setInterval(pollMentions, MENTION_POLL_MS);
  setTimeout(pollMentions, 5000); // first poll after 5s

  // Start organic thoughts
  console.log(`[CLUD] posting thoughts every ${THOUGHT_INTERVAL_MS / 60000}min`);
  setTimeout(postThought, 3 * 60 * 1000); // first thought after 3min
  setInterval(postThought, THOUGHT_INTERVAL_MS);

  console.log('[CLUD] online. the cortex is active. the pattern recognition has begun.');
}

start().catch(console.error);

module.exports = { start, pollMentions, postThought, handleReply };
