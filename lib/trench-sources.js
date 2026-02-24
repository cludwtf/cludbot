/**
 * Trench news sources — pump.fun graduations, trending runners, KOL signals, narrative detection
 */
const fetch = globalThis.fetch || require('node-fetch');

const BLACKLIST_SYMBOLS = ['SOL', 'WSOL', 'USDC', 'USDT', 'RAY', 'JUP', 'JTO', 'PYTH', 'TEST', 'TESTCOIN', 'WRAPPED'];
const BLACKLIST_NAMES = ['wrapped', 'test', 'bridged', 'wormhole', 'staked'];

function isBlacklisted(symbol, name) {
  if (BLACKLIST_SYMBOLS.includes((symbol || '').toUpperCase())) return true;
  if (BLACKLIST_NAMES.some(b => (name || '').toLowerCase().includes(b))) return true;
  return false;
}

/**
 * 1. Pump.fun graduation tracker — coins that just graduated from bonding curve to raydium
 */
async function fetchPumpGraduations() {
  try {
    // pump.fun API for recently graduated (king of the hill / completed bonding curve)
    const res = await fetch('https://frontend-api-v3.pump.fun/coins/currently-live?limit=50&offset=0&includeNsfw=false');
    if (!res.ok) throw new Error(`pump.fun API ${res.status}`);
    const coins = await res.json();
    
    // Filter for graduated coins (complete = true, or has raydium_pool)
    const graduated = (coins || []).filter(c => {
      if (!c.mint || !c.symbol || !c.name) return false;
      if (isBlacklisted(c.symbol, c.name)) return false;
      if (c.market_cap < 50000) return false; // minimum viable
      return c.complete === true || c.raydium_pool;
    }).map(c => ({
      name: c.name,
      symbol: c.symbol,
      ca: c.mint,
      mcap: c.market_cap || c.usd_market_cap || 0,
      description: (c.description || '').substring(0, 200),
      twitter: c.twitter || null,
      website: c.website || null,
      created: c.created_timestamp,
      source: 'pump.fun graduation',
    }));

    return graduated.slice(0, 10);
  } catch (e) {
    console.error('[TRENCH] pump.fun graduation fetch failed:', e.message);
    
    // Fallback: use DexScreener to find recent pump.fun tokens with high volume
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=pump');
      const data = await res.json();
      const pumpCoins = (data.pairs || [])
        .filter(p => p.chainId === 'solana' && p.pairCreatedAt && (Date.now() - p.pairCreatedAt < 24 * 60 * 60 * 1000))
        .filter(p => !isBlacklisted(p.baseToken?.symbol, p.baseToken?.name))
        .filter(p => (p.volume?.h24 || 0) > 100000 && (p.marketCap || p.fdv || 0) > 100000)
        .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
        .slice(0, 5)
        .map(p => ({
          name: p.baseToken?.name,
          symbol: p.baseToken?.symbol,
          ca: p.baseToken?.address,
          mcap: p.marketCap || p.fdv || 0,
          volume24h: p.volume?.h24 || 0,
          priceChange24h: p.priceChange?.h24 || 0,
          liquidity: p.liquidity?.usd || 0,
          source: 'dexscreener (pump.fun recent)',
        }));
      return pumpCoins;
    } catch (e2) {
      console.error('[TRENCH] fallback fetch failed:', e2.message);
      return [];
    }
  }
}

/**
 * 2. DexScreener trending + boosted tokens on Solana
 */
async function fetchTrendingRunners() {
  try {
    // DexScreener token profiles for boosted tokens
    const [boostRes, trendRes] = await Promise.all([
      fetch('https://api.dexscreener.com/token-boosts/top/v1').catch(() => null),
      fetch('https://api.dexscreener.com/latest/dex/search?q=solana').catch(() => null),
    ]);

    const runners = [];

    // Boosted tokens
    if (boostRes?.ok) {
      const boostData = await boostRes.json();
      const solBoosted = (boostData || [])
        .filter(t => t.chainId === 'solana' && !isBlacklisted(t.tokenAddress, ''))
        .slice(0, 5);
      
      for (const t of solBoosted) {
        try {
          const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`);
          const pairData = await pairRes.json();
          const pair = pairData.pairs?.[0];
          if (pair && (pair.volume?.h24 || 0) > 200000) {
            runners.push({
              name: pair.baseToken?.name,
              symbol: pair.baseToken?.symbol,
              ca: pair.baseToken?.address,
              mcap: pair.marketCap || pair.fdv || 0,
              volume24h: pair.volume?.h24 || 0,
              priceChange24h: pair.priceChange?.h24 || 0,
              priceChange1h: pair.priceChange?.h1 || 0,
              liquidity: pair.liquidity?.usd || 0,
              buys24h: pair.txns?.h24?.buys || 0,
              sells24h: pair.txns?.h24?.sells || 0,
              url: pair.url || `https://dexscreener.com/solana/${pair.baseToken?.address}`,
              source: 'dexscreener boosted',
              boosted: true,
            });
          }
        } catch (e) { /* skip */ }
      }
    }

    return runners;
  } catch (e) {
    console.error('[TRENCH] trending fetch failed:', e.message);
    return [];
  }
}

/**
 * 3. Detect narrative clusters — group runners by meta/theme
 */
function detectNarratives(runners) {
  const narratives = {
    'AI / AGENT': { keywords: ['ai', 'agent', 'gpt', 'claude', 'llm', 'neural', 'bot', 'intelligence', 'model'], coins: [] },
    'ANIMAL': { keywords: ['dog', 'cat', 'frog', 'pepe', 'doge', 'shib', 'inu', 'bear', 'bull', 'whale', 'fish', 'bird', 'monkey', 'ape', 'panda', 'duck', 'owl', 'rat', 'mouse'], coins: [] },
    'CULTURE / MEME': { keywords: ['trump', 'elon', 'musk', 'wojak', 'chad', 'based', 'npc', 'cope', 'seethe', 'sigma', 'gigachad', 'dark', 'lord'], coins: [] },
    'FOOD': { keywords: ['pizza', 'burger', 'taco', 'sushi', 'coffee', 'beer', 'wine', 'cake', 'cookie'], coins: [] },
    'TECH / INFRA': { keywords: ['swap', 'dex', 'bridge', 'stake', 'yield', 'vault', 'protocol', 'chain', 'layer', 'node', 'oracle'], coins: [] },
  };

  for (const runner of runners) {
    const text = `${runner.name} ${runner.symbol} ${runner.description || ''}`.toLowerCase();
    for (const [narrative, config] of Object.entries(narratives)) {
      if (config.keywords.some(kw => text.includes(kw))) {
        config.coins.push(runner);
        break; // each coin goes to one narrative
      }
    }
  }

  // Return narratives with 2+ coins (that's a trend)
  return Object.entries(narratives)
    .filter(([_, config]) => config.coins.length >= 2)
    .map(([name, config]) => ({ narrative: name, coins: config.coins, count: config.coins.length }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 4. KOL editorial topics — generate editorial angles from CT knowledge
 */
function getKOLEditorialTopics() {
  // These are editorial angles clud can write about based on its KOL corpus knowledge
  // Rotate through these — one per day
  const topics = [
    {
      topic: "the psychology of CT calls — why KOLs post runners after they've already run",
      angle: "analyze how crypto twitter influencers time their calls. most 'alpha' is posted after the move. the real alpha is understanding why.",
      tag: "EDITORIAL",
    },
    {
      topic: "the anatomy of a pump.fun graduation — what separates the ones that make it from the 99% that don't",
      angle: "break down the mechanics. bonding curve completion, raydium migration, the critical first hour of real trading. what makes a coin survive graduation.",
      tag: "EDITORIAL",
    },
    {
      topic: "narrative rotation speed is accelerating — metas that lasted weeks now last hours",
      angle: "AI coins, animal coins, political coins — the shelf life of a narrative is shrinking. what this means for the trenches.",
      tag: "EDITORIAL",
    },
    {
      topic: "the dev wallet playbook — how to spot a rug before it happens",
      angle: "common patterns: bundled supply, slow sells disguised as 'taking profit', wallet splitting, the friend-who-snipes. what the chain tells you.",
      tag: "EDITORIAL",
    },
    {
      topic: "why 'community' is the most overused and least understood word in crypto",
      angle: "every coin claims community. 90% of them are telegram groups with 50 bots. what real community looks like vs manufactured engagement.",
      tag: "EDITORIAL",
    },
    {
      topic: "the CT engagement farm — how bots and reply guys shape what you think is popular",
      angle: "reply guys, engagement pods, bot farms. the timeline isn't organic. analyze the machine behind CT virality.",
      tag: "EDITORIAL",
    },
    {
      topic: "volume doesn't lie but it can be manufactured — understanding real vs wash volume",
      angle: "how to tell the difference between organic volume and self-trading. dexscreener numbers aren't always what they seem.",
      tag: "EDITORIAL",
    },
    {
      topic: "the 5am-11am PST window — why timing your launch matters more than your tokenomics",
      angle: "analyze when successful coins launch vs when they die. the timezone arbitrage of meme coins.",
      tag: "EDITORIAL",
    },
    {
      topic: "graduated but dead — why most coins die within 48 hours of leaving pump.fun",
      angle: "bonding curve graduation is just the beginning. most coins bleed out on raydium. analyze the post-graduation survival rate.",
      tag: "EDITORIAL",
    },
    {
      topic: "the rise of AI agent coins — when the dev is literally artificial intelligence",
      angle: "from truth terminal to AI agents to clud. AI-launched coins are a narrative unto themselves. what makes them different.",
      tag: "EDITORIAL",
    },
    {
      topic: "solana vs base — the meme coin chain war nobody's talking about",
      angle: "solana dominates pump.fun memes but base is growing. compare the ecosystems, the degens, the money flow.",
      tag: "EDITORIAL",
    },
    {
      topic: "the KOL economy — how much money flows through crypto twitter callouts",
      angle: "paid promotions, 'organic' calls that aren't, the economics of being a crypto influencer. follow the money.",
      tag: "EDITORIAL",
    },
    {
      topic: "what the bonding curve actually tells you — reading pump.fun charts like a degen",
      angle: "the shape of the bonding curve at different stages reveals who's buying and selling. teach the reader to read these charts.",
      tag: "EDITORIAL",
    },
    {
      topic: "the art of the ticker — why $WIF hit billions and $RANDOMDOG didn't",
      angle: "naming psychology, ticker memorability, cultural resonance. what makes a meme coin name stick.",
      tag: "EDITORIAL",
    },
  ];

  // Pick based on day of year for rotation
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return topics[dayOfYear % topics.length];
}

/**
 * 5. Collect daily recap data
 */
let dailyRunners = []; // accumulated throughout the day

function addToDailyRunners(runners) {
  for (const r of runners) {
    const existing = dailyRunners.find(d => d.symbol === r.symbol);
    if (existing) {
      // Update with latest data
      if (r.mcap > existing.mcap) Object.assign(existing, r);
    } else {
      dailyRunners.push({ ...r, firstSeen: new Date().toISOString() });
    }
  }
  // Keep top 20 by volume
  dailyRunners.sort((a, b) => (b.volume24h || b.mcap || 0) - (a.volume24h || a.mcap || 0));
  dailyRunners = dailyRunners.slice(0, 20);
}

function getDailyRunners() {
  return [...dailyRunners];
}

function resetDailyRunners() {
  const snapshot = [...dailyRunners];
  dailyRunners = [];
  return snapshot;
}

module.exports = {
  fetchPumpGraduations,
  fetchTrendingRunners,
  detectNarratives,
  getKOLEditorialTopics,
  addToDailyRunners,
  getDailyRunners,
  resetDailyRunners,
};
