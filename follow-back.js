/**
 * Follow-back system — auto-follows anyone who follows clud
 * People notice when you follow back. Builds loyalty.
 */

const https = require('https');
const crypto = require('crypto');
const { addThought, setStat, getStat } = require('./memory');
require('dotenv').config();

const CK = process.env.X_CONSUMER_KEY;
const CS = process.env.X_CONSUMER_SECRET;
const AT = process.env.X_ACCESS_TOKEN;
const AS = process.env.X_ACCESS_SECRET;
const USER_ID = 'USER_ID_NOT_SET'; // @cludwtf

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 min
const followedBack = new Set();
let totalFollowBacks = 0;

function pct(s) { return encodeURIComponent(s).replace(/!/g,'%21').replace(/\*/g,'%2A').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29'); }
function sign(m,u,p) { const s=Object.keys(p).sort().map(k=>`${pct(k)}=${pct(p[k])}`).join('&'); return crypto.createHmac('sha1',`${pct(CS)}&${pct(AS)}`).update(`${m}&${pct(u)}&${pct(s)}`).digest('base64'); }
function oH(m,u,qp={}) { const o={oauth_consumer_key:CK,oauth_nonce:crypto.randomBytes(16).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:Math.floor(Date.now()/1000).toString(),oauth_token:AT,oauth_version:'1.0'}; o.oauth_signature=sign(m,u,{...o,...qp}); return 'OAuth '+Object.keys(o).sort().map(k=>`${pct(k)}="${pct(o[k])}"`).join(', '); }

function apiGet(baseUrl, qp={}) {
  return new Promise((resolve) => {
    const qs = Object.entries(qp).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
    const path = qs ? `${new URL(baseUrl).pathname}?${qs}` : new URL(baseUrl).pathname;
    const req = https.request({ hostname:'api.twitter.com', path, method:'GET', headers:{'Authorization':oH('GET',baseUrl,qp)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve({status:res.statusCode, data:JSON.parse(d)}); } catch(e) { resolve(null); }
      });
    });
    req.on('error',()=>resolve(null));
    req.end();
  });
}

function followUser(targetId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ target_user_id: targetId });
    const req = https.request({ 
      hostname:'api.twitter.com', 
      path:`/2/users/${USER_ID}/following`, 
      method:'POST', 
      headers:{
        'Content-Type':'application/json',
        'Authorization':oH('POST',`https://api.twitter.com/2/users/${USER_ID}/following`)
      }
    }, res => {
      let d=''; res.on('data',c=>d+=c); 
      res.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    });
    req.on('error',()=>resolve(null));
    req.write(body);
    req.end();
  });
}

async function checkAndFollowBack() {
  // Get followers
  const result = await apiGet(`https://api.twitter.com/2/users/${USER_ID}/followers`, {
    max_results: '50',
    'user.fields': 'username,public_metrics',
  });

  if (!result || result.status === 429) {
    console.log('[FOLLOW] rate limited or error');
    return;
  }

  const followers = result.data?.data || [];
  if (followers.length === 0) return;

  // Get who we're following
  const following = await apiGet(`https://api.twitter.com/2/users/${USER_ID}/following`, {
    max_results: '100',
  });

  const followingIds = new Set();
  if (following?.data?.data) {
    following.data.data.forEach(u => followingIds.add(u.id));
  }

  let newFollows = 0;
  for (const follower of followers) {
    if (followingIds.has(follower.id) || followedBack.has(follower.id)) continue;
    
    // Follow back
    const result = await followUser(follower.id);
    if (result?.data?.following) {
      followedBack.add(follower.id);
      totalFollowBacks++;
      newFollows++;
      console.log(`[FOLLOW] followed back @${follower.username} (${follower.public_metrics?.followers_count || '?'} followers)`);
      
      // Don't spam — 2s between follows
      await new Promise(r => setTimeout(r, 2000));
      
      // Max 10 per cycle to avoid rate limits
      if (newFollows >= 10) break;
    }
  }

  if (newFollows > 0) {
    console.log(`[FOLLOW] followed back ${newFollows} new followers (total: ${totalFollowBacks})`);
    setStat.run('total_follow_backs', String(totalFollowBacks));
  }
}

function startFollowBack() {
  const saved = getStat.get('total_follow_backs');
  if (saved) totalFollowBacks = parseInt(saved.value) || 0;
  
  console.log(`[FOLLOW] starting — checking every 15min | total follow-backs: ${totalFollowBacks}`);
  setTimeout(checkAndFollowBack, 60 * 1000); // first check after 1 min
  setInterval(checkAndFollowBack, CHECK_INTERVAL_MS);
}

module.exports = { startFollowBack };
