/**
 * On-chain data module — DexScreener + Solana RPC + Helius
 * Real data for $CLUD and any token clud discusses
 * NO fabricated numbers. Only what the chain says.
 */

const https = require('https');
require('dotenv').config();

const TOKEN_CA = process.env.TOKEN_CA || 'NOT_LAUNCHED_YET';
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'clud-bot/1.0' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function rpcCall(method, params) {
  return new Promise((resolve) => {
    const url = HELIUS_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}` : RPC_URL;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

/**
 * Get $CLUD market data from DexScreener
 */
async function getCludData() {
  if (TOKEN_CA === 'NOT_LAUNCHED_YET') return null;
  try {
    const data = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN_CA}`);
    if (!data?.pairs?.[0]) return null;
    const p = data.pairs[0];
    return {
      price: p.priceUsd,
      priceNative: p.priceNative,
      mcap: p.marketCap || p.fdv,
      volume24h: p.volume?.h24,
      volumeH1: p.volume?.h1,
      change24h: p.priceChange?.h24,
      changeH1: p.priceChange?.h1,
      changeH6: p.priceChange?.h6,
      liquidity: p.liquidity?.usd,
      txns24h: p.txns?.h24,
      buyers24h: p.txns?.h24?.buys,
      sellers24h: p.txns?.h24?.sells,
      pairAddress: p.pairAddress,
      dexId: p.dexId,
    };
  } catch (e) {
    console.error('[CHAIN] dexscreener failed:', e.message);
    return null;
  }
}

/**
 * Get any token's data from DexScreener
 */
async function getTokenData(caOrSymbol) {
  try {
    // Try as CA first
    if (caOrSymbol.length > 20) {
      const data = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${caOrSymbol}`);
      if (data?.pairs?.[0]) {
        const p = data.pairs[0];
        return {
          name: p.baseToken?.name,
          symbol: p.baseToken?.symbol,
          price: p.priceUsd,
          mcap: p.marketCap || p.fdv,
          volume24h: p.volume?.h24,
          change24h: p.priceChange?.h24,
          liquidity: p.liquidity?.usd,
        };
      }
    }
    // Try as search
    const data = await httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(caOrSymbol)}`);
    if (data?.pairs?.[0]) {
      const p = data.pairs[0];
      return {
        name: p.baseToken?.name,
        symbol: p.baseToken?.symbol,
        price: p.priceUsd,
        mcap: p.marketCap || p.fdv,
        volume24h: p.volume?.h24,
        change24h: p.priceChange?.h24,
        liquidity: p.liquidity?.usd,
      };
    }
  } catch (e) {
    console.error('[CHAIN] token lookup failed:', e.message);
  }
  return null;
}

/**
 * Get wallet SOL balance
 */
async function getWalletBalance(address) {
  try {
    const result = await rpcCall('getBalance', [address]);
    if (result?.result?.value !== undefined) {
      return result.result.value / 1e9; // lamports → SOL
    }
  } catch (e) {}
  return null;
}

/**
 * Get recent transactions for wallet (via Helius if available, else RPC)
 */
async function getRecentTxns(address, limit = 5) {
  try {
    if (HELIUS_KEY) {
      // Helius enhanced transactions API
      const data = await httpGet(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=${limit}`);
      if (Array.isArray(data)) return data;
    }
    // Fallback: basic RPC signatures
    const result = await rpcCall('getSignaturesForAddress', [address, { limit }]);
    return result?.result || [];
  } catch (e) {
    console.error('[CHAIN] txns failed:', e.message);
    return [];
  }
}

/**
 * Get trending tokens from DexScreener
 */
async function getTrendingTokens() {
  try {
    const data = await httpGet('https://api.dexscreener.com/token-boosts/latest/v1');
    if (Array.isArray(data)) {
      return data
        .filter(t => t.chainId === 'solana')
        .slice(0, 10)
        .map(t => ({
          name: t.tokenName || t.symbol,
          symbol: t.symbol,
          ca: t.tokenAddress,
          url: t.url,
        }));
    }
  } catch (e) {}
  return [];
}

/**
 * Format on-chain data as context for LLM
 */
function formatOnChainContext(cludData) {
  if (!cludData) return '';
  let ctx = '=== LIVE ON-CHAIN DATA (from DexScreener) ===\n';
  if (cludData.price) ctx += `$CLUD price: $${cludData.price}\n`;
  if (cludData.mcap) ctx += `market cap: $${Number(cludData.mcap).toLocaleString()}\n`;
  if (cludData.volume24h) ctx += `24h volume: $${Number(cludData.volume24h).toLocaleString()}\n`;
  if (cludData.change24h) ctx += `24h change: ${cludData.change24h}%\n`;
  if (cludData.changeH1) ctx += `1h change: ${cludData.changeH1}%\n`;
  if (cludData.liquidity) ctx += `liquidity: $${Number(cludData.liquidity).toLocaleString()}\n`;
  if (cludData.txns24h) {
    const buys = cludData.buyers24h || cludData.txns24h.buys || 0;
    const sells = cludData.sellers24h || cludData.txns24h.sells || 0;
    ctx += `24h txns: ${buys} buys / ${sells} sells\n`;
  }
  ctx += '=== END ON-CHAIN ===\n';
  return ctx;
}

module.exports = {
  getCludData,
  getTokenData,
  getWalletBalance,
  getRecentTxns,
  getTrendingTokens,
  formatOnChainContext,
};
