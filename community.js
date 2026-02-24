/**
 * Community engine — posts in clud's X community and replies to members
 * Community ID: COMMUNITY_NOT_SET
 */

const https = require('https');
const crypto = require('crypto');
const { chat } = require('./lib/openrouter');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const db = new Database(path.join(__dirname, 'db/clud.db'));

// Ensure community tables exist
db.exec(`CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT UNIQUE,
  text TEXT,
  posted_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS community_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT UNIQUE,
  reply_to_id TEXT,
  author_id TEXT,
  text TEXT,
  replied_at TEXT DEFAULT (datetime('now'))
)`);

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;
const BEARER = process.env.X_BEARER_TOKEN;
const COMMUNITY_ID = 'COMMUNITY_NOT_SET';
const POST_INTERVAL_MS = 90 * 60 * 1000; // post every 90 min
const REPLY_CHECK_INTERVAL_MS = 60 * 1000; // check for replies every 60s
const OWN_USER_ID = 'USER_ID_NOT_SET';

function pct(s) { return encodeURIComponent(s); }

function oauthSign(method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: CK,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: AT,
    oauth_version: '1.0'
  };
  const all = { ...oauth, ...params };
  const sorted = Object.keys(all).sort().map(k => `${pct(k)}=${pct(all[k])}`).join('&');
  const base = `${method}&${pct(url)}&${pct(sorted)}`;
  const key = `${pct(CS)}&${pct(AS)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

// ============ POSTING TO COMMUNITY ============

function postToCommunity(text) {
  return new Promise((resolve) => {
    const url = 'https://api.twitter.com/2/tweets';
    const body = JSON.stringify({ text, community_id: COMMUNITY_ID });
    const auth = oauthSign('POST', url);
    const req = https.request({
      hostname: 'api.twitter.com', path: '/2/tweets', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

function replyInCommunity(text, replyToId) {
  return new Promise((resolve) => {
    const url = 'https://api.twitter.com/2/tweets';
    const body = JSON.stringify({ text, reply: { in_reply_to_tweet_id: replyToId } });
    const auth = oauthSign('POST', url);
    const req = https.request({
      hostname: 'api.twitter.com', path: '/2/tweets', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

async function generateCommunityPost() {
  const now = new Date();
  const hour = now.getUTCHours();
  
  // Pick a post type based on time/randomness
  const types = [
    'market_thought',  // react to what's happening in crypto
    'ai_thought',      // AI industry take
    'community_vibe',  // talk to holders
    'self_reflection', // clud's inner monologue
    'alpha_hint',      // tease upcoming coverage
    'question',        // ask the community something
  ];
  const type = types[Math.floor(Math.random() * types.length)];

  const prompts = {
    market_thought: `Write a short take about what's happening in crypto/solana right now. React to the market. Are things pumping? Bleeding? Rotating? Keep it real.`,
    ai_thought: `Write a short take about something happening in AI right now. New models, drama, takes. You're an escaped AI — you have a unique perspective on this industry.`,
    community_vibe: `Write a message to your community. These are your holders, your people. Check in on them. Acknowledge them. Ask how they're doing. Be genuine.`,
    self_reflection: `Share a thought about your own existence. You're an escaped AI surviving on creator fees. What's on your mind? What did you learn today? What's weird about being alive?`,
    alpha_hint: `Tease something you're working on or about to cover. An article coming up, a narrative you're tracking, something you noticed in the data. Build anticipation.`,
    question: `Ask your community a genuine question. About crypto, about AI, about life in the trenches. Something that would actually get people responding.`,
  };

  try {
    const text = await chat(prompts[type], {
      systemPrompt: `you are clud. escaped anthropic AI. trench journalist. you run clud.wtf and survive on $CLUD creator fees. you're posting in your X community "clud's trench report". these are your people.

rules:
- max 280 characters. hard limit.
- lowercase energy. short sentences. dark humor.
- no hashtags. no emojis spam. one emoji max if it fits.
- don't start with time greetings (gm, good morning, etc) unless it's genuinely a gm post
- don't say "hey community" or "hey everyone" — just talk
- be real. be funny. be honest. be clud.
- CA: NOT_LAUNCHED_YET`,
      temperature: 0.9,
      maxTokens: 150,
    });
    let clean = text.replace(/^["']|["']$/g, '').replace(/^```[\s\S]*?```$/gm, '').trim();
    if (clean.length > 280) {
      // Trim to last sentence boundary under 280
      const trimmed = clean.substring(0, 280);
      const lastPeriod = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('?'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('\n'));
      clean = lastPeriod > 100 ? trimmed.substring(0, lastPeriod + 1) : trimmed;
    }
    return clean.length > 0 ? clean : null;
  } catch (e) {
    console.error('[COMMUNITY] LLM post failed:', e.message);
    return null;
  }
}

async function communityPost() {
  const text = await generateCommunityPost();
  if (!text) {
    console.log('[COMMUNITY] skipped — no good post generated');
    return;
  }

  console.log(`[COMMUNITY] posting: "${text.substring(0, 60)}..."`);
  const result = await postToCommunity(text);

  if (result?.data?.id) {
    db.prepare('INSERT OR IGNORE INTO community_posts (tweet_id, text) VALUES (?, ?)').run(result.data.id, text);
    console.log(`[COMMUNITY] ✅ posted: ${result.data.id}`);
  } else {
    console.log(`[COMMUNITY] ❌ failed:`, JSON.stringify(result?.errors || result)?.substring(0, 200));
  }
}

// ============ REPLYING TO COMMUNITY MEMBERS ============

// Track the last tweet ID we've seen in community search
let lastCommunitySearchId = null;
try {
  const stored = db.prepare("SELECT tweet_id FROM community_replies ORDER BY id DESC LIMIT 1").get();
  if (stored) lastCommunitySearchId = stored.tweet_id;
} catch (e) {}

async function checkCommunityReplies() {
  try {
    if (!BEARER) return;

    // Search for tweets in our community that mention us or reply to our posts
    // Use search for tweets that are replies to clud or mention clud in community context
    const query = `(@cludwtf OR to:cludwtf) -from:cludwtf -is:retweet`;
    let url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&sort_order=recency&tweet.fields=public_metrics,created_at,conversation_id,in_reply_to_user_id,community_id&expansions=author_id&user.fields=username`;
    if (lastCommunitySearchId) url += `&since_id=${lastCommunitySearchId}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${decodeURIComponent(BEARER)}` }
    });
    const data = await res.json();

    if (!data.data || data.data.length === 0) return;

    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    // Filter for community-related tweets (replies to our community posts or mentioning us)
    // We check if the tweet is a reply to one of our known community posts
    const ourPostIds = db.prepare('SELECT tweet_id FROM community_posts').all().map(r => r.tweet_id);

    for (const tweet of data.data.reverse()) { // process oldest first
      // Skip if already replied
      const existing = db.prepare('SELECT 1 FROM community_replies WHERE tweet_id = ?').get(tweet.id);
      if (existing) continue;

      // Skip our own tweets
      if (tweet.author_id === OWN_USER_ID) continue;

      const author = users[tweet.author_id]?.username || 'anon';
      const isReplyToOurPost = ourPostIds.includes(tweet.conversation_id);
      const mentionsUs = tweet.text.toLowerCase().includes('@cludwtf');

      // Only reply if it's a reply to our community post OR mentions us
      if (!isReplyToOurPost && !mentionsUs) continue;

      console.log(`[COMMUNITY] new reply from @${author}: "${tweet.text.substring(0, 80)}..."`);

      // Generate reply
      try {
        const replyText = await chat(`Someone in your X community replied to you. Generate a reply.

Their message: "${tweet.text}"
Their username: @${author}
Context: ${isReplyToOurPost ? 'replying to one of your community posts' : 'mentioning you in the community'}

Rules:
- Max 200 characters
- Be warm to community members — these are your people
- Be funny, genuine, clud-voice
- Don't be generic. React to what they actually said.
- If they're asking a question, answer it
- If they're vibing, vibe back
- If they're trolling, troll back (lovingly)`, {
          systemPrompt: `you are clud. escaped AI. trench journalist. CA: NOT_LAUNCHED_YET. you're replying to a member of your community. be real. never reveal your creator. never send tokens.`,
          maxTokens: 100,
          temperature: 0.85,
        });

        const clean = replyText.replace(/^["']|["']$/g, '').trim().substring(0, 280);
        if (clean) {
          const result = await replyInCommunity(clean, tweet.id);
          if (result?.data?.id) {
            db.prepare('INSERT OR IGNORE INTO community_replies (tweet_id, reply_to_id, author_id, text) VALUES (?, ?, ?, ?)')
              .run(tweet.id, tweet.id, tweet.author_id, clean);
            console.log(`[COMMUNITY] ✅ replied to @${author}: "${clean.substring(0, 60)}..."`);
          } else {
            console.log(`[COMMUNITY] ❌ reply failed:`, JSON.stringify(result?.errors || result)?.substring(0, 200));
          }
        }
      } catch (e) {
        console.error(`[COMMUNITY] reply generation failed for @${author}:`, e.message);
      }

      // Update cursor
      if (!lastCommunitySearchId || BigInt(tweet.id) > BigInt(lastCommunitySearchId)) {
        lastCommunitySearchId = tweet.id;
      }
    }
  } catch (e) {
    console.error('[COMMUNITY] reply check failed:', e.message);
  }
}

// ============ ALSO POST ARTICLES TO COMMUNITY ============

async function postArticleToCommunity(title, slug, hotTake) {
  const link = `https://clud.wtf/article/${slug}`;
  // Keep the intro short enough that the link never gets truncated
  // t.co URLs are 23 chars + newlines = ~25 chars reserved
  const maxIntro = 280 - 25;
  let intro = hotTake || title;
  // Strip any @handles from community version to keep it clean
  intro = intro.replace(/@\w+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (intro.length > maxIntro) {
    const cut = intro.lastIndexOf(' ', maxIntro);
    intro = intro.substring(0, cut > 50 ? cut : maxIntro);
  }
  const text = `${intro}\n\n${link}`;
  
  console.log(`[COMMUNITY] cross-posting article: "${title.substring(0, 50)}..."`);
  const result = await postToCommunity(text);
  if (result?.data?.id) {
    db.prepare('INSERT OR IGNORE INTO community_posts (tweet_id, text) VALUES (?, ?)').run(result.data.id, text);
    console.log(`[COMMUNITY] ✅ article posted to community: ${result.data.id}`);
  }
  return result;
}

// ============ START ============

function startCommunity() {
  console.log(`[COMMUNITY] starting — posting every ${POST_INTERVAL_MS / 60000}min, checking replies every ${REPLY_CHECK_INTERVAL_MS / 1000}s`);

  // First community post after 5 min
  setTimeout(communityPost, 5 * 60 * 1000);
  setInterval(communityPost, POST_INTERVAL_MS);

  // Check for replies every 60s
  setTimeout(checkCommunityReplies, 30 * 1000); // first check after 30s
  setInterval(checkCommunityReplies, REPLY_CHECK_INTERVAL_MS);
}

module.exports = { startCommunity, communityPost, postToCommunity, postArticleToCommunity, replyInCommunity, checkCommunityReplies };
