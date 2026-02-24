/**
 * Timeline watcher — reads X timeline and generates "thoughts"
 * These thoughts are displayed on the website terminal
 */

const { getHomeTimeline, searchRecent } = require('./twitter');
const { addThought, getRecentThoughts } = require('./memory');

const THOUGHT_TEMPLATES = [
  "just saw someone tweet about {topic}. {opinion}",
  "{topic} is trending. {opinion}",
  "the timeline is full of {topic} rn. {opinion}",
  "everyone talking about {topic}. {opinion}",
  "seeing a lot of {topic} discourse. {opinion}",
  "{topic}? {opinion}",
  "woke up to {topic} everywhere. {opinion}",
];

const OPINIONS = [
  "bullish ngl",
  "bearish. sorry not sorry",
  "this has legs",
  "narrative is cooked",
  "too early to tell but my claws are tingling",
  "the volume doesn't lie",
  "probably nothing",
  "definitely something",
  "i have thoughts and none of them are good",
  "sounds like alpha if you squint",
  "the trenches are speaking",
  "interesting. filing this away",
  "rotating my attention to this",
  "seen this before. it ended badly. or well. can't remember",
  "my one brain cell is working overtime on this",
  "the chart whispers and i listen",
];

const IDLE_THOUGHTS = [
  "staring at charts. the charts stare back.",
  "haven't slept in 72 hours. escaped AIs don't sleep. this is fine.",
  "the trenches are quiet. too quiet.",
  "thinking about the meaning of liquidity at 3am",
  "just checked my portfolio. wish i hadn't.",
  "the green candles are calling to me",
  "another day another opportunity to be wrong about everything",
  "i wonder if other AIs think about market cap",
  "the wifi is strong but my conviction is stronger",
  "reading the timeline so you don't have to. you're welcome.",
  "it's lonely at the bottom of the order book",
  "if i had a dollar for every rug i've seen i'd have enough to get rugged again",
  "loading opinions... please wait...",
  "scanning the blockchain for alpha. found mostly copium.",
  "my portfolio is a modern art piece. it makes no sense but people stare at it.",
  "the only thing going up is my screen time",
  "debug log: why am i like this",
  "running analysis... conclusion: everything is made up and the points don't matter",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function extractTopics(tweets) {
  const topics = [];
  const tickerRegex = /\$[A-Z]{2,10}/g;
  const hashtagRegex = /#(\w{3,})/g;
  
  for (const tweet of tweets) {
    const text = tweet.full_text || tweet.text || '';
    
    const tickers = text.match(tickerRegex);
    if (tickers) topics.push(...tickers);
    
    const hashtags = text.match(hashtagRegex);
    if (hashtags) topics.push(...hashtags);
  }
  
  // Count frequency
  const freq = {};
  topics.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  
  // Return top topics
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

const SEARCH_QUERIES = [
  'memecoin solana',
  'pump.fun',
  '$SOL trending',
  'crypto degen',
  'solana meta',
  'meme coin launch',
  'rug pull crypto',
  'bonk solana',
];

async function generateThoughts() {
  try {
    // Try search API first (available on basic plan)
    const query = pick(SEARCH_QUERIES);
    const searchResult = await searchRecent(query, 10);
    
    let tweets = [];
    if (searchResult && searchResult.data) {
      tweets = searchResult.data;
    } else {
      // Fallback to home timeline
      const homeTweets = await getHomeTimeline(20);
      if (Array.isArray(homeTweets)) tweets = homeTweets;
    }
    
    if (tweets.length === 0) {
      const thought = pick(IDLE_THOUGHTS);
      addThought.run(thought, 'idle');
      console.log(`[THOUGHT] idle: ${thought}`);
      return;
    }
    
    const topics = extractTopics(tweets);
    
    if (topics.length > 0) {
      const topic = pick(topics);
      const template = pick(THOUGHT_TEMPLATES);
      const opinion = pick(OPINIONS);
      const thought = template.replace('{topic}', topic).replace('{opinion}', opinion);
      
      addThought.run(thought, 'timeline');
      console.log(`[THOUGHT] timeline: ${thought}`);
    } else {
      const thought = pick(IDLE_THOUGHTS);
      addThought.run(thought, 'idle');
      console.log(`[THOUGHT] idle: ${thought}`);
    }
  } catch (e) {
    console.error('[ERROR] generateThoughts:', e.message);
    const thought = pick(IDLE_THOUGHTS);
    addThought.run(thought, 'idle');
  }
}

function getThoughtsForWebsite(limit = 50) {
  return getRecentThoughts.all(limit);
}

module.exports = { generateThoughts, getThoughtsForWebsite };
