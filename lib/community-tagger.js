/**
 * Community Tagger — finds project X handles for token mentions in tweets
 * Sources: DexScreener socials, X API search fallback
 * Caches in SQLite community_handles table
 */

const Database = require('better-sqlite3');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');

const db = new Database(path.join(__dirname, '..', 'db', 'clud.db'));
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCached(symbol) {
  const row = db.prepare('SELECT handle, updated_at FROM community_handles WHERE symbol = ?').get(symbol);
  if (row && (Date.now() - row.updated_at) < CACHE_TTL) return row.handle || null;
  return undefined; // not cached or expired
}

function setCache(symbol, handle) {
  db.prepare('INSERT OR REPLACE INTO community_handles (symbol, handle, updated_at) VALUES (?, ?, ?)').run(symbol, handle || '', Date.now());
}

async function findHandleFromDexScreener(symbol) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, {
      headers: { 'User-Agent': 'clud-bot/1.0' }
    });
    const data = await res.json();
    const pairs = data.pairs || [];
    // Find solana pair with matching symbol
    for (const p of pairs) {
      if (p.baseToken?.symbol?.toUpperCase() !== symbol.toUpperCase()) continue;
      const socials = p.info?.socials || [];
      const twitter = socials.find(s => s.type === 'twitter');
      if (twitter?.url) {
        const match = twitter.url.match(/(?:twitter\.com|x\.com)\/([^/?]+)/i);
        if (match) return match[1];
      }
    }
  } catch (e) {
    console.error(`[TAGGER] DexScreener lookup failed for ${symbol}:`, e.message);
  }
  return null;
}

async function findHandleFromXSearch(symbol) {
  try {
    const bearer = process.env.X_BEARER_TOKEN;
    if (!bearer) return null;
    const query = encodeURIComponent(`${symbol} official`);
    const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&expansions=author_id&user.fields=username,public_metrics`, {
      headers: { 'Authorization': `Bearer ${decodeURIComponent(bearer)}` }
    });
    const data = await res.json();
    const users = (data.includes?.users || [])
      .filter(u => u.public_metrics?.followers_count > 100)
      .sort((a, b) => b.public_metrics.followers_count - a.public_metrics.followers_count);
    if (users.length > 0) return users[0].username;
  } catch (e) {
    console.error(`[TAGGER] X search failed for ${symbol}:`, e.message);
  }
  return null;
}

async function getProjectHandle(symbol) {
  if (!symbol) return null;
  const cached = getCached(symbol);
  if (cached !== undefined) return cached;

  let handle = await findHandleFromDexScreener(symbol);
  if (!handle) handle = await findHandleFromXSearch(symbol);
  
  setCache(symbol, handle);
  return handle;
}

module.exports = { getProjectHandle };
