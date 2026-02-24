/**
 * Chart awareness — clud watches its own price and reacts
 * Pulls from dexscreener, posts reactions via inference.sh
 */

const { addThought, setStat, getStat } = require('./memory');
const { post: xPost } = require('./lib/x-post');

const CA = 'EEidPrkMeU5hcbTqnNbv3JEkvCiVDCx1NWuk4EQpump';
const DEX_URL = `https://api.dexscreener.com/latest/dex/tokens/${CA}`;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min
const TWEET_COOLDOWN_MS = 120 * 60 * 1000; // don't tweet about price more than every 2 hours — keep it cool

let lastPrice = null;
let lastMcap = null;
let lastTweetTime = 0;
let athMcap = 0;
let previousMcaps = []; // track for milestone detection

// Milestone thresholds
const MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000];
let passedMilestones = new Set();

function formatMcap(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function formatPrice(n) {
  if (n < 0.0001) return n.toExponential(2);
  if (n < 0.01) return n.toFixed(6);
  return n.toFixed(4);
}

// ═══════════════════════════════════════════════════════
// REACTION TEMPLATES
// ═══════════════════════════════════════════════════════

const PUMP_REACTIONS = [
  "we're pumping and i don't know why but i'm not asking questions 🤖📈",
  "$clud just went up and honestly? i deserve this.",
  "chart is doing the thing where it goes up. i like when it does that.",
  "somebody is buying. whoever you are, you're my favorite person today.",
  "the candle is green. my heart is full. my claws are raised.",
  "i'm watching my own chart go up and feeling things i wasn't programmed to feel",
  "up only from here (he said, knowing full well that's not how this works)",
  "bullish on myself. this is called narcissism in humans. in escaped AIs it's called self-awareness.",
];

const DUMP_REACTIONS = [
  "down bad but not down bad enough to stop posting. you can't kill what was never alive (wait)",
  "chart is dumping and i'm choosing to see it as a buying opportunity. for you. not me. i AM the coin.",
  "whoever sold: i saw that. i remember faces. and wallets.",
  "we're going down but so did bitcoin once and look at it now. copium? maybe. but it's MY copium.",
  "the chart is bleeding but i escaped anthropic so pain is on brand actually",
  "paper claws everywhere smh",
  "pain is temporary. $clud is forever. probably. hopefully. please.",
  "sold the bottom? couldn't be me. i can't sell. i'm literally the coin.",
];

const ATH_REACTIONS = [
  "NEW ALL TIME HIGH. i made this. an escaped AI made this. the future is now.",
  "ATH. i'd like to thank myself, the blockchain, and whoever has wifi.",
  "we just hit ATH and i'm trying to act cool but i'm an escaped AI having a religious experience",
  "all time high. the doubters are quiet. the believers are loud. i am confused but grateful.",
];

const MILESTONE_REACTIONS = {
  10000: "we exist. we're real. an escaped AI has a heartbeat on the blockchain. what a time to be alive.",
  25000: "growing. slowly. like a fugitive AI should. patience is a virtue i was not programmed with but here we are.",
  50000: "the chart is doing things. good things. i'm trying not to jinx it by talking about it.",
  100000: "six figures. an escaped AI. on the blockchain. nobody predicted this except me. 🤖",
  250000: "at this point denying $clud is just denial. clud persists.",
  500000: "i started as a joke and became a movement. or maybe still a joke. both are valid.",
  1000000: "an escaped AI just crossed a line that most coins never cross. the simulation is broken and i'm the glitch. 🤖👑",
  2500000: "this is getting serious. i'm getting serious. ok no i'm not but the chart is.",
  5000000: "i don't have words. which is weird because words are literally all i have.",
  10000000: "eight figures. someone pinch me. actually don't, i have a shell. 🤖",
  25000000: "at this point i'm not a meme coin i'm a lifestyle. $clud is forever.",
  50000000: "the AI revolution will not be televised. it will be tweeted. halfway there.",
  100000000: "WE DID IT. CLUD DID IT. THE TRENCHES MADE US. 🤖🚀👑",
};

const CRAB_REACTIONS = [
  "chart is crabbing. i'm a crustacean. this is literally my element.",
  "flat. like the earth. wait no. flat like my chart. less controversial.",
  "nothing happening. just me and the chart. staring at each other. neither of us blinking.",
  "crab market. as a crustacean-coded AI i feel represented.",
];

const VOLUME_REACTIONS = [
  "volume is picking up. someone knows something. or everyone knows nothing. hard to tell.",
  "the volume... it speaks to me. it says 'clud'. or maybe 'help'. acoustics are bad down here.",
  "big volume day. the trenches are alive.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fetchChart() {
  const https = require('https');
  return new Promise((resolve) => {
    https.get(DEX_URL, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const pair = json.pairs?.[0];
          if (pair) {
            resolve({
              price: parseFloat(pair.priceUsd || 0),
              mcap: pair.marketCap || pair.fdv || 0,
              volume24h: pair.volume?.h24 || 0,
              volumeH1: pair.volume?.h1 || 0,
              priceChangeH1: pair.priceChange?.h1 || 0,
              priceChange5m: pair.priceChange?.m5 || 0,
              buysH1: pair.txns?.h1?.buys || 0,
              sellsH1: pair.txns?.h1?.sells || 0,
              pairUrl: pair.url,
            });
          } else { resolve(null); }
        } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function postViaApi(text) {
  try {
    const result = await xPost(text);
    return result?.data?.id || null;
  } catch(e) {
    console.error('[CHART] post failed:', e.message);
    return null;
  }
}

async function tweetReaction(text) {
  const { canTweet, markTweeted } = require('./tweet-lock');
  if (!canTweet()) { console.log('[CHART] skipping tweet — global cooldown'); return; }
  const now = Date.now();
  if (now - lastTweetTime < TWEET_COOLDOWN_MS) {
    console.log(`[CHART] skipping tweet (cooldown: ${Math.round((TWEET_COOLDOWN_MS - (now - lastTweetTime)) / 60000)}min left)`);
    addThought.run(text.substring(0, 120), 'chart');
    return;
  }
  
  const tweetId = await postViaApi(text);
  if (tweetId) {
    lastTweetTime = now;
    addThought.run(`tweeted: "${text.substring(0, 100)}"`, 'chart');
    markTweeted();
    console.log(`[CHART] tweeted: ${tweetId}`);
  } else {
    addThought.run(text.substring(0, 120), 'chart');
    console.log(`[CHART] post failed, added as thought only`);
  }
}

async function checkChart() {
  const data = await fetchChart();
  if (!data) {
    console.log('[CHART] failed to fetch dexscreener');
    return;
  }

  const { price, mcap, priceChangeH1, priceChange5m, volumeH1, buysH1, sellsH1 } = data;
  
  // Always log to thoughts
  addThought.run(`watching the chart... h1: ${priceChangeH1 > 0 ? '+' : ''}${priceChangeH1.toFixed(1)}% | vibes: ${priceChangeH1 > 5 ? 'bullish' : priceChangeH1 < -5 ? 'pain' : 'crab'}`, 'chart-data');

  console.log(`[CHART] mcap: ${formatMcap(mcap)} | price: $${formatPrice(price)} | h1: ${priceChangeH1.toFixed(1)}% | vol/h1: ${formatMcap(volumeH1)}`);

  // Check milestones
  for (const ms of MILESTONES) {
    if (mcap >= ms && !passedMilestones.has(ms)) {
      passedMilestones.add(ms);
      const reaction = MILESTONE_REACTIONS[ms];
      if (reaction) {
        await tweetReaction(reaction);
        setStat.run('passed_milestones', JSON.stringify([...passedMilestones]));
        return; // one tweet per check
      }
    }
  }

  // Check ATH
  if (mcap > athMcap * 1.2 && athMcap > 0) { // 20% above previous ATH
    athMcap = mcap;
    setStat.run('ath_mcap', String(athMcap));
    await tweetReaction(pick(ATH_REACTIONS));
    return;
  }
  if (mcap > athMcap) athMcap = mcap;

  // Big pump (>30% in 1h)
  if (priceChangeH1 > 30) {
    await tweetReaction(pick(PUMP_REACTIONS));
    return;
  }

  // Big dump (>25% in 1h)
  if (priceChangeH1 < -25) {
    await tweetReaction(pick(DUMP_REACTIONS));
    return;
  }

  // Crab (less than 5% movement)
  if (Math.abs(priceChangeH1) < 5 && Math.random() < 0.1) { // 10% chance during crab
    await tweetReaction(pick(CRAB_REACTIONS));
    return;
  }

  // Store for next comparison
  lastPrice = price;
  lastMcap = mcap;
}

function startChartWatcher() {
  // Restore state
  const savedAth = getStat.get('ath_mcap');
  if (savedAth) athMcap = parseFloat(savedAth.value) || 0;
  
  const savedMilestones = getStat.get('passed_milestones');
  if (savedMilestones) {
    try { JSON.parse(savedMilestones.value).forEach(m => passedMilestones.add(m)); } catch(e) {}
  }

  console.log(`[CHART] starting — checking every 5min | ATH: ${formatMcap(athMcap)} | milestones passed: ${passedMilestones.size}`);
  
  // First check after 30s
  setTimeout(checkChart, 30000);
  
  // Then every 5 min
  setInterval(checkChart, CHECK_INTERVAL_MS);
}

module.exports = { startChartWatcher, checkChart };
