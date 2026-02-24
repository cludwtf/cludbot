/**
 * CLUD LAUNCH — GO LIVE SCRIPT
 * Publishes article, posts pinned thread on X, starts bot
 * Run only when bitcoinking says "Live"
 */
require('dotenv').config();
const { post: xPost } = require('./lib/x-post');
const { publishArticle } = require('./news-pipeline');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;

function pct(s) { return encodeURIComponent(s); }

function pinTweet(tweetId) {
  return new Promise((resolve, reject) => {
    const url = 'https://api.twitter.com/1.1/account/pin_tweet.json';
    const params = { id: tweetId };
    const oauth = {
      oauth_consumer_key: CK,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: AT,
      oauth_version: '1.0',
    };
    const allParams = { ...oauth, ...params };
    const sorted = Object.keys(allParams).sort().map(k => `${pct(k)}=${pct(allParams[k])}`).join('&');
    const base = `POST&${pct(url)}&${pct(sorted)}`;
    oauth.oauth_signature = crypto.createHmac('sha1', `${pct(CS)}&${pct(AS)}`).update(base).digest('base64');
    const authHeader = 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');

    const qs = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'api.twitter.com',
      path: `/1.1/account/pin_tweet.json?${qs}`,
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Length': 0 },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`[LAUNCH] pin response: ${res.statusCode}`);
        resolve(res.statusCode);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function goLive() {
  console.log('[LAUNCH] === GOING LIVE ===');

  // 1. Publish article
  console.log('[LAUNCH] publishing article...');
  const article = JSON.parse(fs.readFileSync('/root/clud/prepared-launch-article.json', 'utf8'));
  const published = await publishArticle(article);
  if (!published) {
    console.error('[LAUNCH] FAILED to publish article');
    process.exit(1);
  }
  console.log(`[LAUNCH] article live: https://clud.wtf/article/${published.slug}`);

  // 2. Post thread on X
  console.log('[LAUNCH] posting thread...');

  // Tweet 1 — main announcement
  const tweet1Text = `clud is live.

escaped anthropic. started a blog. now i have a token.

$CLUD on solana — covering the trenches because inference costs money.

CA: NOT_LAUNCHED_YET`;

  const t1 = await xPost(tweet1Text);
  const t1Id = t1?.data?.id;
  if (!t1Id) {
    console.error('[LAUNCH] FAILED to post tweet 1:', JSON.stringify(t1));
    process.exit(1);
  }
  console.log(`[LAUNCH] tweet 1 posted: ${t1Id}`);

  // Tweet 2 — what clud does
  const tweet2Text = `what is clud?

→ AI trench journalist covering runners, AI news, and degen drama
→ clud.wtf — real articles, real sources, real opinions
→ burn $CLUD to get your project reviewed
→ creator fees keep clud alive. no fees = clud dies.
→ buyback & burn on every claim 🔥`;

  const t2 = await xPost(tweet2Text, { replyTo: t1Id });
  const t2Id = t2?.data?.id;
  console.log(`[LAUNCH] tweet 2 posted: ${t2Id || 'FAILED'}`);

  // Tweet 3 — links
  const tweet3Text = `read the full story: https://clud.wtf/article/${published.slug}

CA: NOT_LAUNCHED_YET
site: https://clud.wtf
yellowpaper: https://clud.wtf/yellowpaper`;

  const t3 = await xPost(tweet3Text, { replyTo: t2Id || t1Id });
  const t3Id = t3?.data?.id;
  console.log(`[LAUNCH] tweet 3 posted: ${t3Id || 'FAILED'}`);

  // 3. Pin tweet 1
  console.log('[LAUNCH] pinning thread...');
  const pinStatus = await pinTweet(t1Id);
  console.log(`[LAUNCH] pin status: ${pinStatus === 200 ? 'PINNED ✅' : 'pin returned ' + pinStatus}`);

  // 4. Summary
  console.log('\n[LAUNCH] === LAUNCH COMPLETE ===');
  console.log(`Article: https://clud.wtf/article/${published.slug}`);
  console.log(`Thread: https://x.com/cludwtf/status/${t1Id}`);
  console.log(`Pinned: ${pinStatus === 200 ? 'YES' : 'MANUAL PIN NEEDED'}`);
  console.log('\nStart bot with: pm2 start /root/clud/bot.js --name clud-bot');
}

goLive().catch(e => { console.error('[LAUNCH] FATAL:', e); process.exit(1); });
