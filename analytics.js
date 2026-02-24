/**
 * Tweet analytics — tracks performance of outgoing tweets
 * Checks back on tweets after delay to measure engagement
 * Stores results for learning and strategy adjustment
 */

const https = require('https');
const crypto = require('crypto');
const { addThought, setStat, getStat } = require('./memory');
require('dotenv').config();

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;

function pct(s) { return encodeURIComponent(s).replace(/!/g,'%21').replace(/\*/g,'%2A').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29'); }
function sign(m,u,p) { const s=Object.keys(p).sort().map(k=>`${pct(k)}=${pct(p[k])}`).join('&'); return crypto.createHmac('sha1',`${pct(CS)}&${pct(AS)}`).update(`${m}&${pct(u)}&${pct(s)}`).digest('base64'); }
function oH(m,u,qp={}) { const o={oauth_consumer_key:CK,oauth_nonce:crypto.randomBytes(16).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:Math.floor(Date.now()/1000).toString(),oauth_token:AT,oauth_version:'1.0'}; o.oauth_signature=sign(m,u,{...o,...qp}); return 'OAuth '+Object.keys(o).sort().map(k=>`${pct(k)}="${pct(o[k])}"`).join(', '); }

// Queue of tweets to check later
const pendingChecks = []; // { tweetId, type, text, postedAt, target? }
const CHECK_DELAY_MS = 30 * 60 * 1000; // check after 30 min
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // process queue every 15 min

// SQLite for persistent storage
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(require('path').join(__dirname, 'db', 'clud.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS tweet_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT UNIQUE,
    type TEXT,
    text TEXT,
    target_username TEXT,
    target_followers INTEGER DEFAULT 0,
    posted_at INTEGER,
    checked_at INTEGER,
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    score REAL DEFAULT 0
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_perf_type ON tweet_performance(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_perf_score ON tweet_performance(score DESC)`);
} catch(e) {
  console.error('[ANALYTICS] db init error:', e.message);
}

const insertPerf = db?.prepare(`INSERT OR REPLACE INTO tweet_performance 
  (tweet_id, type, text, target_username, target_followers, posted_at, checked_at, likes, retweets, replies, impressions, score) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const getTopTweets = db?.prepare(`SELECT * FROM tweet_performance WHERE type = ? ORDER BY score DESC LIMIT ?`);
const getTopAll = db?.prepare(`SELECT * FROM tweet_performance ORDER BY score DESC LIMIT ?`);
const getByType = db?.prepare(`SELECT type, COUNT(*) as count, AVG(score) as avg_score, MAX(score) as best_score, SUM(likes) as total_likes, SUM(retweets) as total_rts FROM tweet_performance GROUP BY type`);

// Track a tweet for later performance check
function trackTweet(tweetId, type, text, targetUsername, targetFollowers) {
  pendingChecks.push({
    tweetId,
    type, // 'autopost', 'raid', 'engage', 'qt', 'community', 'chart', 'reply', 'burn'
    text: text?.substring(0, 200),
    targetUsername,
    targetFollowers: targetFollowers || 0,
    postedAt: Date.now(),
  });
  console.log(`[ANALYTICS] tracking ${type} tweet ${tweetId}`);
}

// Fetch tweet metrics from X API
function getTweetMetrics(tweetId) {
  return new Promise((resolve) => {
    const url = 'https://api.twitter.com/2/tweets/' + tweetId;
    const qp = { 'tweet.fields': 'public_metrics' };
    const qs = Object.entries(qp).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const req = https.request({
      hostname: 'api.twitter.com',
      path: `/2/tweets/${tweetId}?${qs}`,
      method: 'GET',
      headers: { 'Authorization': oH('GET', url, qp) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j.data?.public_metrics || null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Process pending checks
async function processChecks() {
  const now = Date.now();
  const ready = [];
  const remaining = [];
  
  for (const item of pendingChecks) {
    if (now - item.postedAt >= CHECK_DELAY_MS) {
      ready.push(item);
    } else {
      remaining.push(item);
    }
  }
  
  pendingChecks.length = 0;
  pendingChecks.push(...remaining);
  
  if (ready.length === 0) return;
  
  console.log(`[ANALYTICS] checking ${ready.length} tweets...`);
  
  for (const item of ready) {
    await new Promise(r => setTimeout(r, 1500)); // rate limit
    
    const metrics = await getTweetMetrics(item.tweetId);
    if (!metrics) continue;
    
    const likes = metrics.like_count || 0;
    const rts = metrics.retweet_count || 0;
    const replies = metrics.reply_count || 0;
    const impressions = metrics.impression_count || 0;
    
    // Score: weighted engagement
    // Likes=1, RTs=3 (spread), Replies=2 (conversation)
    // Normalize by follower reach if it was a raid/engage
    const rawScore = likes + (rts * 3) + (replies * 2);
    const score = rawScore;
    
    try {
      insertPerf?.run(
        item.tweetId, item.type, item.text, item.targetUsername || null,
        item.targetFollowers, item.postedAt, now,
        likes, rts, replies, impressions, score
      );
    } catch(e) {}
    
    if (score > 5) {
      console.log(`[ANALYTICS] 🔥 ${item.type} scored ${score} (${likes}❤️ ${rts}🔁 ${replies}💬): "${item.text?.substring(0, 60)}"`);
    }
  }
}

// Get insights for LLM prompting
function getTopPerformers(type, limit = 5) {
  try {
    if (type) return getTopTweets?.all(type, limit) || [];
    return getTopAll?.all(limit) || [];
  } catch(e) { return []; }
}

function getTypeBreakdown() {
  try { return getByType?.all() || []; } catch(e) { return []; }
}

// Generate a report
function generateReport() {
  const breakdown = getTypeBreakdown();
  const top = getTopPerformers(null, 10);
  
  let report = '📊 TWEET PERFORMANCE REPORT\n\n';
  
  if (breakdown.length > 0) {
    report += 'BY TYPE:\n';
    for (const b of breakdown) {
      report += `  ${b.type}: ${b.count} tweets, avg score ${b.avg_score?.toFixed(1)}, best ${b.best_score?.toFixed(0)}, ${b.total_likes} total ❤️, ${b.total_rts} total 🔁\n`;
    }
    report += '\n';
  }
  
  if (top.length > 0) {
    report += 'TOP PERFORMERS:\n';
    for (const t of top) {
      report += `  [${t.type}] score:${t.score} | ${t.likes}❤️ ${t.retweets}🔁 ${t.replies}💬 | "${t.text?.substring(0, 80)}"\n`;
    }
  }
  
  return report;
}

function startAnalytics() {
  console.log(`[ANALYTICS] starting — checking tweet performance every ${CHECK_INTERVAL_MS/60000}min (${CHECK_DELAY_MS/3600000}hr delay)`);
  setInterval(processChecks, CHECK_INTERVAL_MS);
}

module.exports = { trackTweet, startAnalytics, getTopPerformers, getTypeBreakdown, generateReport };
