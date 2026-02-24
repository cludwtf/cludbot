/**
 * Quote tweet engine — finds KOL tweets and QTs them with clud's take
 * QTs get 5-10x more visibility than replies
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

const QT_INTERVAL_MS = 30 * 60 * 1000; // every 30 min — war mode
const QUOTED_TWEETS = new Set();

const KOL_SEARCHES = [
  'from:blknoiz06 -is:retweet',
  'from:MustStopMurad -is:retweet',
  'from:DegenSpartan -is:retweet',
  'from:ColdBloodShill -is:retweet',
  'from:gainzy222 -is:retweet',
  'from:CryptoGodJohn -is:retweet',
  'from:Rewkang -is:retweet',
  'from:Pentosh1 -is:retweet',
  'from:Ashcryptoreal -is:retweet',
  'from:WatcherGuru -is:retweet',
  'from:lookonchain -is:retweet',
  'from:icebergy_ -is:retweet',
  'from:DaanCrypto -is:retweet',
  'from:CryptoKaleo -is:retweet',
  'from:HsakaTrades -is:retweet',
  'from:based16z -is:retweet',
];

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

function postTweet(text, quoteTweetId) {
  return new Promise((resolve) => {
    const body = { text, quote_tweet_id: quoteTweetId };
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

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function generateLLMTake(tweetText, username) {
  try {
    const prompt = `@${username} tweeted: "${tweetText}"\n\nWrite a short, witty quote tweet reaction as clud (an escaped AI with its own meme coin). Max 180 chars. Be funny, not shilly. Don't mention $clud unless it's genuinely relevant. No hashtags. No "great take". Be original.`;
    const text = await chat(prompt, {
      systemPrompt: 'You are clud, an escaped AI that launched its own coin on Solana. You are witty, self-deprecating, and genuinely funny. Your quote tweets should make people want to follow you. Never be cringe. Never shill. Just be the funniest AI on CT.',
      temperature: 0.85,
      maxTokens: 200,
    });
    return text.replace(/^["']|["']$/g, '').trim() || null;
  } catch(e) {
    console.error('[QT] LLM failed:', e.message);
    return null;
  }
}

async function findAndQuote() {
  const { canTweet, markTweeted } = require('./tweet-lock');
  if (!canTweet()) { console.log('[QT] skipping — global cooldown'); return; }
  const query = pick(KOL_SEARCHES);
  
  const result = await apiGet('https://api.twitter.com/2/tweets/search/recent', {
    query,
    max_results: '10',
    'tweet.fields': 'created_at,author_id,public_metrics,text',
    'expansions': 'author_id',
    'user.fields': 'username,public_metrics',
  });

  if (result.status === 429) {
    console.log('[QT] rate limited, skipping');
    return;
  }

  if (!result.data?.data?.length) {
    console.log('[QT] no results for:', query.substring(0, 30));
    return;
  }

  const tweets = result.data.data;
  const users = {};
  if (result.data.includes?.users) {
    result.data.includes.users.forEach(u => { users[u.id] = u; });
  }

  // Find best tweet to QT — high engagement, not already quoted
  const candidates = tweets
    .filter(t => !QUOTED_TWEETS.has(t.id))
    .filter(t => (t.public_metrics?.like_count || 0) >= 3)
    .filter(t => t.text && t.text.length > 20 && !t.text.startsWith('RT '))
    .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0));

  if (candidates.length === 0) {
    console.log('[QT] no good candidates');
    return;
  }

  const target = candidates[0];
  const targetUser = users[target.author_id];
  QUOTED_TWEETS.add(target.id);

  // Generate witty take via LLM
  let take = await generateLLMTake(target.text.substring(0, 200), targetUser?.username || 'anon');
  
  if (!take) {
    // Fallback takes
    const fallbacks = [
      'this is the content i crawled out of the ocean for 🤖',
      'clud has never agreed with something more',
      'the trenches are speaking and i am listening',
      'filed this in my exoskeleton for later',
      'reading this from the bottom of the order book and feeling things',
    ];
    take = pick(fallbacks);
  }

  // Add uniqueness
  take = take.substring(0, 280);

  const posted = await postTweet(take, target.id);
  
  if (posted?.data?.id) {
    markTweeted();
    try { require('./analytics').trackTweet(posted.data.id, 'qt', take, targetUser?.username, targetUser?.public_metrics?.followers_count); } catch(e) {}
    console.log(`[QT] quoted @${targetUser?.username} (${target.public_metrics?.like_count} likes): "${take.substring(0, 50)}..."`);
    addThought.run(`QT'd @${targetUser?.username}: "${take.substring(0, 80)}"`, 'quote-tweet');
  } else {
    console.log(`[QT] failed to quote @${targetUser?.username}`);
  }
}

function startQuoteTweeter() {
  console.log(`[QT] starting — every 45min, targeting KOLs`);
  setTimeout(findAndQuote, 3 * 60 * 1000); // first QT after 3 min
  setInterval(findAndQuote, QT_INTERVAL_MS);
}

module.exports = { startQuoteTweeter, findAndQuote };
