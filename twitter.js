/**
 * Twitter/X API v2 client — multi-source polling + inference.sh posting
 * 3 polling sources staggered for ~20s response time
 */

const crypto = require('crypto');
const https = require('https');
require('dotenv').config();
const { post: xPost } = require('./lib/x-post');

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;
const USER_ID = 'USER_ID_NOT_SET'; // @cludwtf
const PINNED_TWEET_ID = '2025834868446531762';

// ═══════════════════════════════════════════════════════
// OAUTH 1.0a
// ═══════════════════════════════════════════════════════

function pct(s) {
  return encodeURIComponent(s)
    .replace(/!/g, '%21').replace(/\*/g, '%2A')
    .replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function sign(method, url, params) {
  const sorted = Object.keys(params).sort().map(k => `${pct(k)}=${pct(params[k])}`).join('&');
  const base = `${method}&${pct(url)}&${pct(sorted)}`;
  return crypto.createHmac('sha1', `${pct(CS)}&${pct(AS)}`).update(base).digest('base64');
}

function oauthHeader(method, baseUrl, queryParams = {}) {
  const oauth = {
    oauth_consumer_key: CK,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: AT,
    oauth_version: '1.0',
  };
  oauth.oauth_signature = sign(method, baseUrl, { ...oauth, ...queryParams });
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

function apiGet(baseUrl, queryParams = {}) {
  return new Promise((resolve, reject) => {
    const qs = Object.entries(queryParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const path = qs ? `${new URL(baseUrl).pathname}?${qs}` : new URL(baseUrl).pathname;

    const req = https.request({
      hostname: 'api.twitter.com',
      path,
      method: 'GET',
      headers: { 'Authorization': oauthHeader('GET', baseUrl, queryParams) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 429) {
            const reset = res.headers['x-rate-limit-reset'];
            reject({ status: 429, reset, body: json });
          } else if (res.statusCode >= 400) {
            reject({ status: res.statusCode, body: json });
          } else {
            resolve(json);
          }
        } catch (e) {
          reject({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// READING — 3 sources
// ═══════════════════════════════════════════════════════

async function getMentions(sinceId = null) {
  const params = {
    'max_results': '10',
    'tweet.fields': 'created_at,author_id,conversation_id,referenced_tweets',
    'expansions': 'author_id',
    'user.fields': 'username,name',
  };
  if (sinceId) params.since_id = sinceId;

  try {
    return await apiGet(`https://api.twitter.com/2/users/${USER_ID}/mentions`, params);
  } catch (e) {
    if (e.status === 429) console.log('[RATE LIMIT] mentions');
    else console.error('[ERROR] getMentions:', e.status);
    return null;
  }
}

async function searchPinnedReplies(sinceId = null) {
  const params = {
    'query': `conversation_id:${PINNED_TWEET_ID} -from:cludwtf`,
    'max_results': '10',
    'tweet.fields': 'created_at,author_id',
    'expansions': 'author_id',
    'user.fields': 'username,name',
  };
  if (sinceId) params.since_id = sinceId;

  try {
    return await apiGet('https://api.twitter.com/2/tweets/search/recent', params);
  } catch (e) {
    if (e.status === 429) console.log('[RATE LIMIT] pinned search');
    else console.error('[ERROR] searchPinned:', e.status);
    return null;
  }
}

async function searchMentionText(sinceId = null) {
  const params = {
    'query': '@cludwtf -from:cludwtf',
    'max_results': '10',
    'tweet.fields': 'created_at,author_id,conversation_id',
    'expansions': 'author_id',
    'user.fields': 'username,name',
  };
  if (sinceId) params.since_id = sinceId;

  try {
    return await apiGet('https://api.twitter.com/2/tweets/search/recent', params);
  } catch (e) {
    if (e.status === 429) console.log('[RATE LIMIT] mention search');
    else console.error('[ERROR] searchMention:', e.status);
    return null;
  }
}

async function searchRecent(query, maxResults = 10) {
  const params = {
    'query': query,
    'max_results': String(maxResults),
    'tweet.fields': 'created_at,author_id,public_metrics',
  };

  try {
    return await apiGet('https://api.twitter.com/2/tweets/search/recent', params);
  } catch (e) {
    console.error('[ERROR] searchRecent:', e.status);
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// POSTING — direct API via lib/x-post
// ═══════════════════════════════════════════════════════

async function postTweet(text, replyToId = null) {
  try {
    const result = await xPost(text, { replyTo: replyToId });
    if (result?.data?.id) {
      console.log(`[TWEET] posted: "${text.substring(0, 50)}..." ${replyToId ? `(reply to ${replyToId})` : ''}`);
      return result;
    }
    return null;
  } catch (e) {
    console.error(`[ERROR] postTweet: ${e.message}`);
    return null;
  }
}

async function getHomeTimeline() { return []; }

module.exports = {
  getMentions,
  searchPinnedReplies,
  searchMentionText,
  searchRecent,
  postTweet,
  getHomeTimeline,
  PINNED_TWEET_ID,
};
