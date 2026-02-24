/**
 * Price oracle — fetches live prices for any token
 * Uses dexscreener + coingecko for major coins
 */

const https = require('https');

const MAJOR_COINS = {
  'bitcoin': 'bitcoin', 'btc': 'bitcoin',
  'ethereum': 'ethereum', 'eth': 'ethereum',
  'solana': 'solana', 'sol': 'solana',
  'bonk': 'bonk', 'wif': 'dogwifcoin',
  'pepe': 'pepe', 'doge': 'dogecoin',
  'clud': 'clud',
};

require('dotenv').config();
const CLUD_CA = process.env.TOKEN_CA || 'NOT_LAUNCHED_YET';

function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'clud-bot/1.0' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

async function getPrice(query) {
  const lower = query.toLowerCase().replace('$', '');
  
  // Check if it's clud
  if (lower === 'clud') {
    const data = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${CLUD_CA}`);
    if (data?.pairs?.[0]) {
      const p = data.pairs[0];
      return {
        name: 'clud',
        symbol: '$clud',
        price: p.priceUsd,
        mcap: p.marketCap || p.fdv,
        change24h: p.priceChange?.h24,
        changeH1: p.priceChange?.h1,
        volume24h: p.volume?.h24,
      };
    }
    return null;
  }

  // Major coins via coingecko
  const cgId = MAJOR_COINS[lower];
  if (cgId) {
    const data = await httpGet(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
    if (data?.[cgId]) {
      const coin = data[cgId];
      return {
        name: cgId,
        symbol: `$${lower.toUpperCase()}`,
        price: coin.usd,
        mcap: coin.usd_market_cap,
        change24h: coin.usd_24h_change,
      };
    }
  }

  // Try dexscreener search for any token
  const data = await httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (data?.pairs?.[0]) {
    const p = data.pairs[0];
    return {
      name: p.baseToken?.name || query,
      symbol: p.baseToken?.symbol ? `$${p.baseToken.symbol}` : query,
      price: p.priceUsd,
      mcap: p.marketCap || p.fdv,
      change24h: p.priceChange?.h24,
      volume24h: p.volume?.h24,
    };
  }

  return null;
}

function formatPrice(p) {
  if (!p) return null;
  const price = parseFloat(p.price);
  let priceStr;
  if (price >= 1000) priceStr = `$${price.toLocaleString('en-US', {maximumFractionDigits: 2})}`;
  else if (price >= 1) priceStr = `$${price.toFixed(2)}`;
  else if (price >= 0.001) priceStr = `$${price.toFixed(4)}`;
  else priceStr = `$${price.toExponential(2)}`;

  let mcapStr = '';
  if (p.mcap) {
    const m = parseFloat(p.mcap);
    if (m >= 1e9) mcapStr = ` | mcap: $${(m/1e9).toFixed(1)}B`;
    else if (m >= 1e6) mcapStr = ` | mcap: $${(m/1e6).toFixed(1)}M`;
    else if (m >= 1e3) mcapStr = ` | mcap: $${(m/1e3).toFixed(1)}K`;
  }

  const change = p.change24h ? ` | 24h: ${parseFloat(p.change24h) > 0 ? '+' : ''}${parseFloat(p.change24h).toFixed(1)}%` : '';
  
  return `${p.symbol}: ${priceStr}${mcapStr}${change}`;
}

// Detect if a message is asking for price
function isPriceQuery(text) {
  const lower = text.toLowerCase();
  return /\b(price|how much|what.*(worth|cost|trading|at))\b/.test(lower) &&
    /\b(btc|bitcoin|eth|ethereum|sol|solana|clud|bonk|wif|pepe|doge)\b/.test(lower) ||
    /\b(bitcoin|btc|sol|solana) price\b/.test(lower) ||
    /price of \b(bitcoin|btc|sol|eth|clud)\b/.test(lower);
}

function extractCoinFromQuery(text) {
  const lower = text.toLowerCase();
  const coins = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'clud', 'bonk', 'wif', 'pepe', 'doge'];
  for (const c of coins) {
    if (lower.includes(c)) return c;
  }
  // Try $TICKER
  const ticker = text.match(/\$([A-Za-z]{2,10})/);
  if (ticker) return ticker[1];
  return null;
}

module.exports = { getPrice, formatPrice, isPriceQuery, extractCoinFromQuery };
