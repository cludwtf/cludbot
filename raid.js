/**
 * Raid engine — finds viral/trending tweets and gets clud in early replies
 * Target: tweets with high engagement in crypto/solana/AI space
 * Goal: maximum impressions from riding viral tweets
 */

const { addThought } = require('./memory');
const { chat } = require('./lib/openrouter');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;

const RAID_INTERVAL_MS = 20 * 60 * 1000; // every 20 min — replies score low, do fewer
const RAIDED_TWEETS = new Set();
let raidCount = 0;

function pct(s) { return encodeURIComponent(s).replace(/!/g,'%21').replace(/\*/g,'%2A').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29'); }
function sign(m,u,p) { const s=Object.keys(p).sort().map(k=>`${pct(k)}=${pct(p[k])}`).join('&'); return crypto.createHmac('sha1',`${pct(CS)}&${pct(AS)}`).update(`${m}&${pct(u)}&${pct(s)}`).digest('base64'); }
function oH(m,u,qp={}) { const o={oauth_consumer_key:CK,oauth_nonce:crypto.randomBytes(16).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:Math.floor(Date.now()/1000).toString(),oauth_token:AT,oauth_version:'1.0'}; o.oauth_signature=sign(m,u,{...o,...qp}); return 'OAuth '+Object.keys(o).sort().map(k=>`${pct(k)}="${pct(o[k])}"`).join(', '); }

function apiGet(baseUrl, qp={}) {
  return new Promise((resolve) => {
    const qs = Object.entries(qp).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    const path = qs ? `${new URL(baseUrl).pathname}?${qs}` : new URL(baseUrl).pathname;
    const req = https.request({ hostname:'api.twitter.com', path, method:'GET', headers:{'Authorization':oH('GET',baseUrl,qp)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve({status:res.statusCode, data:JSON.parse(d)}); } catch(e) { resolve({status:res.statusCode, data:null}); }
      });
    });
    req.on('error',()=>resolve({status:0,data:null}));
    req.end();
  });
}

function postTweet(text, replyToId) {
  return new Promise((resolve) => {
    const body = { text, reply: { in_reply_to_tweet_id: replyToId } };
    const jsonBody = JSON.stringify(body);
    const req = https.request({ hostname:'api.twitter.com', path:'/2/tweets', method:'POST', headers:{'Content-Type':'application/json','Authorization':oH('POST','https://api.twitter.com/2/tweets')} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    });
    req.on('error',()=>resolve(null));
    req.write(jsonBody);
    req.end();
  });
}

// Target big accounts — get in their replies EARLY for max visibility
// These are accounts NOT in the KOL list (engagement.js/quote-tweet.js handle those)
// Focus: big CT accounts, news accounts, solana ecosystem, AI agents
const RAID_TARGETS = [
  // Big CT accounts
  'from:AltcoinGordon -is:retweet',
  'from:MartyPartyMusic -is:retweet',
  'from:TheCryptoDog -is:retweet',
  'from:ZssBecker -is:retweet',
  'from:crypto_bitlord -is:retweet',
  'from:CryptoTony__ -is:retweet',
  'from:StackingUSD -is:retweet',
  'from:MarioNawfal -is:retweet',
  'from:CryptoCapo_ -is:retweet',
  'from:inversebrah -is:retweet',
  'from:CryptoWizardd -is:retweet',
  'from:CryptoGodJohn -is:retweet',
  'from:DefiIgnas -is:retweet',
  // Solana ecosystem
  'from:sol' + 'anafloor -is:retweet',
  'from:SOLBigBrain -is:retweet',
  // AI agent ecosystem
  'from:0xzerebro -is:retweet',
  'from:truth_terminal -is:retweet',
  'from:aixbt_agent -is:retweet',
  'from:Overdose_AI -is:retweet',
];

// Thread promotion mode — set to null to disable
const THREAD_PROMO = 'https://x.com/cludwtf';
const THREAD_PROMO_UNTIL = Date.now() + (6 * 60 * 60 * 1000); // 6 hours from now

async function generateLLMReply(tweetText, username) {
  const isPromoMode = THREAD_PROMO && Date.now() < THREAD_PROMO_UNTIL;
  
  const systemPrompt = isPromoMode
    ? `You are clud, an escaped AI on crypto twitter. Write a short witty reply to this tweet that's relevant to what they said, then naturally work in that you "wrote a thread about this" or "explained this in a thread" — linking to your origin story. The reply should feel organic, not forced. Reply must be under 240 chars to leave room for the link. Be funny first. No hashtags.`
    : 'You are clud, an escaped AI on crypto twitter. Your replies should be genuinely funny and make people want to follow you. Never shill. Never be cringe. Be the funniest account in the replies. Short and punchy.';
  
  const promoInstruction = isPromoMode
    ? `\n\nWrite a short, witty reply that's relevant to their tweet AND naturally mentions your thread. Max 220 chars (link added separately). Don't force it — if the tweet topic doesn't connect to AI/crypto/memecoins, just be funny without mentioning the thread.`
    : `\n\nWrite a short, funny reply as clud (an escaped AI). Max 200 chars. Be genuinely witty and relevant to what they said. DON'T shill, DON'T mention $clud or any coin. Just be funny enough that people click your profile. No hashtags.`;

  try {
    const prompt = `@${username} tweeted this viral tweet: "${tweetText}"${promoInstruction}`;
    const text = await chat(prompt, { systemPrompt, temperature: 0.85, maxTokens: 200 });
    return text.replace(/^["']|["']$/g, '').trim() || null;
  } catch(e) {
    console.error('[RAID] LLM failed:', e.message);
    return null;
  }
}

const FALLBACK_REPLIES = [
  'clud reading this and having a moment 🤖',
  'the trenches needed this energy today',
  'me processing this from the bottom of the ocean with wifi',
  'filed this directly into my exoskeleton',
  'inject this take into my shell',
  'a crustacean has never related harder',
  'reading this at 3am from the blockchain and feeling things',
  'the ocean is cold but this thread is warm',
  'my one brain cell understood every word of this',
  'came here to be funny but this already won',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function raidViral() {
  const { canTweet, markTweeted } = require('./tweet-lock');
  if (!canTweet()) { console.log('[RAID] skipping — global cooldown'); return; }
  const query = pick(RAID_TARGETS);
  
  console.log(`[RAID] searching: ${query.substring(0, 40)}...`);
  
  const result = await apiGet('https://api.twitter.com/2/tweets/search/recent', {
    query,
    max_results: '10',
    sort_order: 'relevancy',
    'tweet.fields': 'created_at,author_id,public_metrics',
    'expansions': 'author_id',
    'user.fields': 'username,public_metrics',
  });

  if (result.status === 429) {
    console.log('[RAID] rate limited, skipping');
    return;
  }

  if (!result.data?.data?.length) {
    console.log('[RAID] no viral tweets found for:', query.substring(0, 30));
    return;
  }

  const tweets = result.data.data;
  const users = {};
  if (result.data.includes?.users) {
    result.data.includes.users.forEach(u => { users[u.id] = u; });
  }

  // Pick the most recent tweet from this target account
  const candidates = tweets
    .filter(t => !RAIDED_TWEETS.has(t.id))
    .filter(t => {
      const u = users[t.author_id];
      return u && u.id !== 'USER_ID_NOT_SET'; // don't reply to ourselves
    })
    .filter(t => t.text && t.text.length > 20) // skip low-effort tweets
    .sort((a, b) => {
      // Sort by engagement, highest first
      const aScore = (a.public_metrics?.like_count || 0) + (a.public_metrics?.retweet_count || 0) * 3;
      const bScore = (b.public_metrics?.like_count || 0) + (b.public_metrics?.retweet_count || 0) * 3;
      return bScore - aScore;
    });

  if (candidates.length === 0) {
    console.log('[RAID] no candidates passed filters');
    return;
  }

  const target = candidates[0];
  const targetUser = users[target.author_id];
  RAIDED_TWEETS.add(target.id);

  const likes = target.public_metrics?.like_count || 0;
  const rts = target.public_metrics?.retweet_count || 0;
  const followers = targetUser?.public_metrics?.followers_count || 0;

  console.log(`[RAID] target: @${targetUser?.username} (${followers} followers, ${likes} likes, ${rts} RTs)`);

  // Generate witty reply — NO SHILLING on viral tweets, pure comedy for profile clicks
  let replyText = await generateLLMReply(target.text?.substring(0, 200) || '', targetUser?.username || 'ser');
  
  if (!replyText) {
    replyText = pick(FALLBACK_REPLIES);
  }

  // Prepend @ mention
  replyText = `@${targetUser?.username} ${replyText}`;
  
  // Append thread link in promo mode (50% of the time to not be spammy)
  const isPromoMode = THREAD_PROMO && Date.now() < THREAD_PROMO_UNTIL;
  if (isPromoMode && Math.random() > 0.4) {
    replyText = replyText.substring(0, 240) + '\n\n' + THREAD_PROMO;
  }
  replyText = replyText.substring(0, 280);

  const posted = await postTweet(replyText, target.id);
  
  if (posted?.data?.id) {
    raidCount++;
    markTweeted();
    try { require('./analytics').trackTweet(posted.data.id, 'raid', replyText, targetUser?.username, followers); } catch(e) {}
    console.log(`[RAID] ✅ replied to viral tweet by @${targetUser?.username} (${likes} likes): "${replyText.substring(0, 60)}..."`);
    addThought.run(`raided @${targetUser?.username} (${likes}❤️): "${replyText.substring(0, 80)}"`, 'raid');
  } else {
    const err = posted?.detail || posted?.errors?.[0]?.message || 'unknown error';
    console.log(`[RAID] ❌ failed: ${err}`);
  }
}

function startRaidEngine() {
  console.log(`[RAID] starting — every ${RAID_INTERVAL_MS/60000}min, targeting viral crypto tweets`);
  
  // First raid after 1 min
  setTimeout(raidViral, 60 * 1000);
  
  // Then every interval
  setInterval(raidViral, RAID_INTERVAL_MS);
}

module.exports = { startRaidEngine, raidViral };
