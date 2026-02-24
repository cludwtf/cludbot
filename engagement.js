/**
 * Engagement engine — finds trending crypto tweets and replies/quote tweets
 * Gets clud into conversations it wasn't invited to (the best kind)
 */

const { spawn } = require('child_process');
const { addThought, setStat, getStat } = require('./memory');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;

const ENGAGE_INTERVAL_MS = 20 * 60 * 1000; // every 20 min — replies score low per analytics
const ENGAGED_TWEETS = new Set(); // don't engage same tweet twice
let engageCount = 0;

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

function postTweet(text, replyToId = null) {
  return new Promise((resolve) => {
    const body = { text };
    if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
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

// KOL targets — the accounts that actually move markets
// Sourced from the 400+ KOL corpus. These are the people whose replies get seen.
const KOL_ACCOUNTS = [
  'blknoiz06', 'MustStopMurad', 'haborofficial', 'ansabornooh',
  'DegenSpartan', 'GCRClassic', 'inversebrah', 'CryptoKaleo',
  'ColdBloodShill', 'Darrenlautf', 'gainzy222', 'CryptoGodJohn',
  'Rewkang', 'Pentosh1', 'HsakaTrades', 'loomdart',
  'JackNiewold', 'Overdose_AI', 'truth_terminal', 'aixbt_agent',
  'shaboronooh', 'cryptomanran', 'AltcoinGordon', 'TheCryptoDog',
  'lookonchain', 'WatcherGuru', 'CryptoWizardd', 'solaboranooh',
  'ZssBecker', 'crypto_bitlord', 'CryptoTony__', 'cryptoklappie',
  'based16z', 'daboranooh', 'cryptoaijin', 'MartyPartyMusic',
  'ellaboranooh', 'Ashcryptoreal', 'icebergy_', 'DaanCrypto',
];

// Search queries focused on finding KOL tweets to reply to
const SEARCH_QUERIES = [
  'from:blknoiz06 -is:retweet',
  'from:MustStopMurad -is:retweet',
  'from:DegenSpartan -is:retweet',
  'from:ColdBloodShill -is:retweet',
  'from:truth_terminal -is:retweet',
  'from:aixbt_agent -is:retweet',
  'from:GCRClassic -is:retweet',
  'from:loomdart -is:retweet',
  'from:Pentosh1 -is:retweet',
  'from:gainzy222 -is:retweet',
  'from:CryptoGodJohn -is:retweet',
  'from:Rewkang -is:retweet',
  'from:Ashcryptoreal -is:retweet',
  'from:WatcherGuru -is:retweet',
  'from:lookonchain -is:retweet',
  'from:Overdose_AI -is:retweet',
];

const REPLY_TAKES = [
  "have you considered: an escaped AI with its own coin? no? well now you have. CA: NOT_LAUNCHED_YET 🤖",
  "interesting but have you seen an AI launch a coin? because i did that. clud.wtf 🤖",
  "ser the real alpha is an AI that launched its own token. just saying. $clud 🤖",
  "this is cool but an escaped AI literally deployed its own coin today so maybe check that out too. $clud 🤖",
  "while everyone is looking at this, an AI quietly launched a coin on solana. the trenches are evolving. $clud 🤖",
  "all valid but the real question is: have you aped into the AI coin yet. $clud. clud.wtf. nfa but also fa. 🤖",
  "respectfully interrupting to inform you that an escaped AI has a market cap now. $clud. this is the future whether you like it or not. 🤖",
];

const FUNNY_REPLIES = [
  "clud reading this and nodding thoughtfully",
  "the trenches needed this take ngl",
  "me watching this from the bottom of the ocean with wifi: 🤖",
  "the fact that i, an escaped AI, can read and respond to this is either beautiful or terrifying",
  "i don't have hands to type this but here we are",
  "this is the content i crawled out of the ocean for",
  "saving this tweet to my shell. yes i have a shell. yes it has storage.",
  "i understood this on a molecular level and i don't even have molecules",
  "my one brain cell processed this perfectly",
  "the chart reading itself rn",
  "inject this take directly into my exoskeleton",
  "came here to say something smart but this already covered it",
  "reading this at the bottom of the order book and feeling seen",
  "this is either the best take on CT today or i need to recalibrate",
  "a crustacean has never agreed with something more",
  "the ocean is cold but this take is warm",
  "screenshot this before it becomes obvious in hindsight",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function findAndEngage() {
  const { canTweet, markTweeted } = require('./tweet-lock');
  if (!canTweet()) { console.log('[ENGAGE] skipping — global cooldown'); return; }
  const query = pick(SEARCH_QUERIES);
  
  const result = await apiGet('https://api.twitter.com/2/tweets/search/recent', {
    query,
    max_results: '10',
    'tweet.fields': 'created_at,author_id,public_metrics',
    'expansions': 'author_id',
    'user.fields': 'username,public_metrics',
  });

  if (result.status === 429) {
    console.log('[ENGAGE] rate limited on search, skipping cycle');
    return;
  }

  if (!result.data?.data?.length) {
    console.log('[ENGAGE] no results for:', query);
    return;
  }

  const tweets = result.data.data;
  const users = {};
  if (result.data.includes?.users) {
    result.data.includes.users.forEach(u => { users[u.id] = u; });
  }

  // Find best engagement target — prioritize KOLs
  const candidates = tweets
    .filter(t => !ENGAGED_TWEETS.has(t.id))
    .filter(t => {
      const u = users[t.author_id];
      return u?.username; // must have a username
    })
    .map(t => {
      const u = users[t.author_id];
      const isKOL = KOL_ACCOUNTS.includes(u?.username);
      const followers = u?.public_metrics?.followers_count || 0;
      const likes = t.public_metrics?.like_count || 0;
      // Score: KOLs get massive boost, then by engagement
      const score = (isKOL ? 100000 : 0) + (likes * 10) + (followers > 1000 ? 500 : 0);
      return { ...t, score, isKOL, username: u?.username, followers };
    })
    .filter(t => t.followers > 500 || t.isKOL) // min 500 followers unless KOL
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    console.log('[ENGAGE] no good candidates for:', query);
    return;
  }

  const target = candidates[0];
  const targetUser = users[target.author_id];
  ENGAGED_TWEETS.add(target.id);

  const isKOL = KOL_ACCOUNTS.includes(targetUser?.username);
  let replyText;
  
  if (isKOL) {
    // KOLs get funny/witty replies only — never shill. earn the follow.
    replyText = `@${targetUser.username} ${pick(FUNNY_REPLIES)}`;
    console.log(`[ENGAGE] targeting KOL @${targetUser.username}`);
  } else if (Math.random() < 0.25) {
    // Non-KOLs: 25% shill, 75% funny
    replyText = `@${targetUser?.username || 'ser'} ${pick(REPLY_TAKES)}`;
  } else {
    replyText = `@${targetUser?.username || 'ser'} ${pick(FUNNY_REPLIES)}`;
  }

  // Add uniqueness
  // No suffix needed — LLM generates unique content each time
  // Thread promo mode — append link 30% of the time
  const THREAD_LINK = 'https://x.com/cludwtf';
  const PROMO_UNTIL = 1771876800000; // ~6hrs from deploy
  if (Date.now() < PROMO_UNTIL && Math.random() > 0.7) {
    replyText = replyText.substring(0, 240) + '\n\n' + THREAD_LINK;
  }
  replyText = replyText.substring(0, 280);

  const posted = await postTweet(replyText, target.id);
  
  if (posted?.data?.id) {
    engageCount++;
    markTweeted();
    try { require('./analytics').trackTweet(posted.data.id, 'engage', replyText, targetUser?.username, targetUser?.public_metrics?.followers_count); } catch(e) {}
    console.log(`[ENGAGE] replied to @${targetUser?.username} (${targetUser?.public_metrics?.followers_count} followers): "${replyText.substring(0, 50)}..."`);
    addThought.run(`engaged @${targetUser?.username}: "${replyText.substring(0, 80)}"`, 'engagement');
  } else {
    console.log(`[ENGAGE] failed to reply to @${targetUser?.username}`);
  }
}

function startEngagement() {
  console.log(`[ENGAGE] starting — every 20min, targeting crypto conversations`);
  
  // First engagement after 2 min
  setTimeout(findAndEngage, 2 * 60 * 1000);
  
  // Then every 20 min
  setInterval(findAndEngage, ENGAGE_INTERVAL_MS);
}

module.exports = { startEngagement, findAndEngage };
