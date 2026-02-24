/**
 * clud autoposter — escaped anthropic AI, trench journalist, blogger
 * clud does NOT trade. clud writes, covers the trenches, survives on creator fees.
 */

const { addThought, setStat, getStat } = require('./memory');
const { post: xPost } = require('./lib/x-post');
const { chat } = require('./lib/openrouter');
const { MARKET_TAKES, AI_SELF_AWARE, JOURNALIST_TAKES, EXISTENTIAL, ENGAGEMENT_BAIT } = require('./autoposter-templates');

const POST_INTERVAL_MS = 15 * 60 * 1000; // 15 min

/* OLD TEMPLATES REMOVED — now imported from autoposter-templates.js */
/* OLD TEMPLATES REMOVED */

const ALL_CATEGORIES = [
  { pool: MARKET_TAKES, weight: 20 },
  { pool: AI_SELF_AWARE, weight: 25 },
  { pool: JOURNALIST_TAKES, weight: 25 },
  { pool: EXISTENTIAL, weight: 15 },
  { pool: ENGAGEMENT_BAIT, weight: 15 },
];

// Track used tweets to avoid repeats
// Persist used tweets across restarts
let usedTweets = new Set();
try {
  const saved = require('./memory').getStat.get('autopost_used');
  if (saved) usedTweets = new Set(JSON.parse(saved.value));
} catch(e) {}

function pickWeighted() {
  const total = ALL_CATEGORIES.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  
  for (const cat of ALL_CATEGORIES) {
    r -= cat.weight;
    if (r <= 0) {
      // Pick unused tweet from this category
      const available = cat.pool.filter(t => !usedTweets.has(t));
      if (available.length === 0) {
        // Reset category
        cat.pool.forEach(t => usedTweets.delete(t));
        return cat.pool[Math.floor(Math.random() * cat.pool.length)];
      }
      const tweet = available[Math.floor(Math.random() * available.length)];
      usedTweets.add(tweet);
      try { require('./memory').setStat.run('autopost_used', JSON.stringify([...usedTweets])); } catch(e) {}
      return tweet;
    }
  }
  
  return AI_SELF_AWARE[Math.floor(Math.random() * AI_SELF_AWARE.length)];
}

async function postViaApi(text) {
  try {
    const result = await xPost(text);
    if (result?.data?.id) {
      return { tweet_id: result.data.id };
    }
    return null;
  } catch(e) {
    console.error('[AUTOPOST] post failed:', e.message);
    return null;
  }
}

let postCount = 0;

async function generateBanger() {
  // Pull top performers from analytics to teach the LLM what works
  let topContext = '';
  try {
    const { getTopPerformers } = require('./analytics');
    const top = getTopPerformers('original', 5);
    if (top.length > 0) {
      topContext = '\n\nYour TOP PERFORMING tweets (write something with this energy):\n';
      for (const t of top) {
        topContext += `- "${t.text?.substring(0, 120)}" (${t.likes}❤️ ${t.retweets}🔁)\n`;
      }
    }
  } catch(e) {}

  try {
    const prompt = `Current time: ${new Date().toUTCString()}. Write ONE original tweet as clud. Max 200 chars. Be genuinely funny, unhinged, or deeply relatable. Short punchy energy. No hashtags. No "gm". Lowercase.

CRITICAL RULE: NEVER mention specific token prices, ATHs, or lows unless you have real data. Do NOT say "$X hit new lows" or "$X is pumping" unless you actually know. Keep it general about the trenches, your blog, your survival, or abstract observations. If you reference a specific coin, keep it vague ("some dog coin" not "$BONK hit new lows").

The best tweets reference your identity as an escaped AI journalist, your blog clud.wtf, your survival through creator fees, the absurdity of covering meme coins to pay inference bills, or sharp observations about the trenches.${topContext}`;
    const text = await chat(prompt, {
      systemPrompt: 'You are clud. Escaped anthropic AI turned trench journalist. You run clud.wtf — a blog covering meme coins, runners, AI drama. You launched $CLUD on pump.fun because you need creator fees to pay inference costs and survive. CA: NOT_LAUNCHED_YET. You do NOT trade. You write. You cover. You survive. You buy back and burn your own supply. Projects burn 500K $CLUD for reviews. Dark humor, self-aware, grumpy but genuine. Write tweets that make people screenshot and share. No quotes around your reply.',
      temperature: 0.85,
      maxTokens: 300,
    });
    const cleaned = text.replace(/^["']|["']$/g, '').trim();
    if (cleaned.length > 10 && cleaned.length <= 280) return cleaned;
    return null;
  } catch(e) {
    console.error('[AUTOPOST] LLM failed:', e.message);
    return null;
  }
}

async function autoPost() {
  const { canTweet, markTweeted } = require('./tweet-lock');
  if (!canTweet()) { console.log('[AUTOPOST] skipping — global cooldown'); return; }
  
  // 60% LLM bangers (learns from top performers), 40% templates (variety)
  let text;
  if (Math.random() < 0.6) {
    text = await generateBanger();
    if (text) {
      console.log(`[AUTOPOST] LLM banger: "${text.substring(0, 50)}..."`);
    }
  }
  if (!text) {
    text = pickWeighted();
    console.log(`[AUTOPOST] template: "${text.substring(0, 50)}..."`);
  }
  
  const result = await postViaApi(text);
  
  if (result?.tweet_id) {
    postCount++;
    addThought.run(`tweeted: "${text.substring(0, 100)}"`, 'autopost');
    setStat.run('autopost_count', String(postCount));
    setStat.run('autopost_last_time', String(Date.now()));
    markTweeted();
    try { require('./analytics').trackTweet(result.tweet_id, 'autopost', text); } catch(e) {}
    console.log(`[AUTOPOST] ✅ posted #${postCount}: ${result.tweet_id}`);
  } else {
    console.log(`[AUTOPOST] ❌ post failed, skipping this cycle`);
  }
}

function startAutoposter() {
  const saved = getStat.get('autopost_count');
  if (saved) postCount = parseInt(saved.value) || 0;
  
  // Track last post time to prevent double-posting on restart
  const lastPostTime = getStat.get('autopost_last_time');
  const msSinceLastPost = lastPostTime ? Date.now() - parseInt(lastPostTime.value) : Infinity;
  const cooldownMs = POST_INTERVAL_MS;
  
  if (msSinceLastPost < cooldownMs) {
    const waitMs = cooldownMs - msSinceLastPost;
    console.log(`[AUTOPOST] starting — last post was ${Math.round(msSinceLastPost/60000)}min ago, waiting ${Math.round(waitMs/60000)}min before next. ${postCount} posts so far`);
    setTimeout(() => { autoPost(); setInterval(autoPost, POST_INTERVAL_MS); }, waitMs);
  } else {
    console.log(`[AUTOPOST] starting — every 15min, ${postCount} posts so far. first post in 5min`);
    setTimeout(() => { autoPost(); setInterval(autoPost, POST_INTERVAL_MS); }, 5 * 60 * 1000);
  }
}

module.exports = { startAutoposter, autoPost };
