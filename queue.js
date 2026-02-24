/**
 * Reply queue — rate-aware posting via direct X API
 * No inference.sh dependency
 */

const { addThought } = require('./memory');

// Rate limits (basic X API plan)
const API_MAX_POSTS_PER_15MIN = 17;
const API_COOLDOWN_MS = 55000;  // ~55s between posts (17 per 15 min)
const MAX_QUEUE_SIZE = 50;

let queue = [];
let posting = false;
let apiPostTimestamps = [];

// Stats
let stats = { apiOk: 0, apiFail: 0, dropped: 0 };

function getStats() { return { ...stats, queueSize: queue.length }; }

function enqueue(text, replyToId, priority = 1, meta = {}) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.sort((a, b) => b.priority - a.priority);
    const dropped = queue.pop();
    stats.dropped++;
    console.log(`[QUEUE] dropped low-priority reply to ${dropped.meta?.username || 'unknown'} (queue full)`);
  }

  text = text.trimEnd();
  queue.push({ text, replyToId, priority, meta, enqueuedAt: Date.now() });
  queue.sort((a, b) => b.priority - a.priority);
  
  if (!posting) drainQueue();
}

function getPriority(userId, interactionCount) {
  if (interactionCount > 5) return 3;
  if (interactionCount > 1) return 2;
  return 1;
}

function canPostAPI() {
  const now = Date.now();
  apiPostTimestamps = apiPostTimestamps.filter(t => now - t < 15 * 60 * 1000);
  return apiPostTimestamps.length < API_MAX_POSTS_PER_15MIN;
}

function getAPIWaitTime() {
  if (canPostAPI()) return 0;
  const oldest = apiPostTimestamps[0];
  return (oldest + 15 * 60 * 1000) - Date.now() + 1000;
}

async function postViaAPI(text, replyToId) {
  const https = require('https');
  const crypto = require('crypto');
  
  const CK = process.env.X_CONSUMER_KEY;
  const CS = process.env.X_CONSUMER_SECRET;
  const AT = process.env.X_ACCESS_TOKEN;
  const AS = process.env.X_ACCESS_SECRET;
  
  function pct(s) { return encodeURIComponent(s).replace(/!/g,'%21').replace(/\*/g,'%2A').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29'); }
  function sign(method,url,params) { const sorted=Object.keys(params).sort().map(k=>`${pct(k)}=${pct(params[k])}`).join('&'); const base=`${method}&${pct(url)}&${pct(sorted)}`; return crypto.createHmac('sha1',`${pct(CS)}&${pct(AS)}`).update(base).digest('base64'); }
  function oauthHeader(method,baseUrl) { const oauth={oauth_consumer_key:CK,oauth_nonce:crypto.randomBytes(16).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:Math.floor(Date.now()/1000).toString(),oauth_token:AT,oauth_version:'1.0'}; oauth.oauth_signature=sign(method,baseUrl,oauth); return 'OAuth '+Object.keys(oauth).sort().map(k=>`${pct(k)}="${pct(oauth[k])}"`).join(', '); }
  
  return new Promise((resolve) => {
    const body = { text };
    if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
    
    const jsonBody = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.twitter.com',
      path: '/2/tweets',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': oauthHeader('POST', 'https://api.twitter.com/2/tweets'),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          const reset = res.headers['x-rate-limit-reset'];
          console.log(`[QUEUE] API rate limited. Reset: ${reset}`);
          resolve({ rateLimited: true, reset });
        } else if (res.statusCode === 201 || res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        } else {
          console.error(`[QUEUE] API error ${res.statusCode}: ${data.substring(0, 100)}`);
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(jsonBody);
    req.end();
  });
}

async function drainQueue() {
  if (posting || queue.length === 0) return;
  posting = true;

  while (queue.length > 0) {
    const item = queue.shift();
    
    // Skip stale items (older than 30 min)
    if (Date.now() - item.enqueuedAt > 30 * 60 * 1000) {
      stats.dropped++;
      console.log(`[QUEUE] dropped stale reply (${Math.round((Date.now() - item.enqueuedAt) / 60000)}min old)`);
      continue;
    }

    const waitTime = getAPIWaitTime();
    if (waitTime > 0) {
      console.log(`[QUEUE] rate limit, waiting ${Math.round(waitTime/1000)}s (${queue.length} in queue)`);
      await sleep(waitTime);
    }
    
    const result = await postViaAPI(item.text, item.replyToId);
    if (result?.rateLimited) {
      queue.unshift(item);
      const resetMs = result.reset ? (result.reset * 1000 - Date.now() + 2000) : 60000;
      console.log(`[QUEUE] 429 — sleeping ${Math.round(resetMs/1000)}s`);
      await sleep(Math.max(resetMs, 10000));
    } else if (result?.data?.id) {
      stats.apiOk++;
      apiPostTimestamps.push(Date.now());
      console.log(`[QUEUE] posted: "${item.text.substring(0, 40)}..." → ${result.data.id}`);
      await sleep(API_COOLDOWN_MS);
    } else {
      stats.apiFail++;
      console.error(`[QUEUE] failed: "${item.text.substring(0, 40)}..."`);
    }
  }

  posting = false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { enqueue, getPriority, getStats, drainQueue };
