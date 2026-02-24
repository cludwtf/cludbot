// X/Twitter direct posting - replaces inference.sh x/post-create
const crypto = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');

function oauthSign(method, url, params, consumerKey, consumerSecret, accessToken, accessSecret) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const paramStr = Object.keys(allParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseStr = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseStr).digest('base64');

  oauthParams.oauth_signature = signature;
  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return authHeader;
}

async function post(text, options = {}) {
  const { replyTo, mediaIds, communityId } = options;

  const consumerKey = process.env.X_CONSUMER_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  if (!consumerKey || !consumerSecret || !accessToken || !accessSecret) {
    throw new Error('X API OAuth credentials not set');
  }

  const url = 'https://api.twitter.com/2/tweets';
  const body = { text };

  if (replyTo) {
    body.reply = { in_reply_to_tweet_id: replyTo };
  }
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds };
  }
  if (communityId) {
    body.community_id = communityId;
  }

  const auth = oauthSign('POST', url, {}, consumerKey, consumerSecret, accessToken, accessSecret);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X API ${res.status}: ${err}`);
  }

  return await res.json();
}

async function uploadMedia(buffer, mimeType = 'image/png') {
  const consumerKey = process.env.X_CONSUMER_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  // INIT
  const initUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const initParams = {
    command: 'INIT',
    total_bytes: buffer.length.toString(),
    media_type: mimeType,
  };

  let auth = oauthSign('POST', initUrl, initParams, consumerKey, consumerSecret, accessToken, accessSecret);
  let res = await fetch(initUrl, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(initParams),
  });
  const initData = await res.json();
  const mediaId = initData.media_id_string;

  // APPEND
  const formData = new FormData();
  formData.append('command', 'APPEND');
  formData.append('media_id', mediaId);
  formData.append('segment_index', '0');
  formData.append('media_data', buffer.toString('base64'));

  auth = oauthSign('POST', initUrl, { command: 'APPEND', media_id: mediaId, segment_index: '0' },
    consumerKey, consumerSecret, accessToken, accessSecret);
  await fetch(initUrl, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ command: 'APPEND', media_id: mediaId, segment_index: '0', media_data: buffer.toString('base64') }),
  });

  // FINALIZE
  const finalParams = { command: 'FINALIZE', media_id: mediaId };
  auth = oauthSign('POST', initUrl, finalParams, consumerKey, consumerSecret, accessToken, accessSecret);
  res = await fetch(initUrl, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(finalParams),
  });

  return (await res.json()).media_id_string;
}

module.exports = { post, uploadMedia, oauthSign };
