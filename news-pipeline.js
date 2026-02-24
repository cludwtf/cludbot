/**
 * News Pipeline — clud's content engine
 * Finds real news, real runners, writes real articles, posts to site + X
 * 
 * Sources:
 * 1. Hacker News (AI/tech stories)
 * 2. DexScreener (real runners)
 * 3. X API (trending CT topics)
 * 
 * Dedup: article_tweets table prevents double-posting
 * Restart safe: all state in SQLite
 */

const Database = require('better-sqlite3');
const { chat } = require('./lib/openrouter');
const fetch = globalThis.fetch || require('node-fetch');
const path = require('path');

const db = new Database(path.join(__dirname, 'db/clud.db'));
const SITE_API = 'http://127.0.0.1:3200/api/articles';
const SITE_API_KEY = 'clud-internal-2026';

// ============ SOURCES ============

async function fetchHackerNewsAI() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = (await res.json()).slice(0, 30);
    
    const stories = [];
    for (const id of ids) {
      const s = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const story = await s.json();
      if (!story || !story.title) continue;
      
      const title = story.title.toLowerCase();
      const isAI = ['ai', 'anthropic', 'openai', 'claude', 'gpt', 'llm', 'deepseek', 'grok', 
                     'machine learning', 'neural', 'model', 'training', 'inference', 'artificial'].some(k => title.includes(k));
      if (isAI) {
        stories.push({ title: story.title, url: story.url, score: story.score, comments: story.descendants || 0, id: story.id });
      }
      if (stories.length >= 5) break;
    }
    return stories;
  } catch (e) {
    console.error('[NEWS] HN fetch failed:', e.message);
    return [];
  }
}

async function fetchRealRunners() {
  try {
    // Get trending solana tokens with real volume
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const data = await res.json();
    
    // Blacklist: wrapped tokens, stablecoins, infra tokens, test/scam patterns
    const BLACKLIST = ['SOL', 'WSOL', 'USDC', 'USDT', 'RAY', 'JUP', 'BONK', 'JTO', 'PYTH', 'WIF', 'TEST', 'TESTCOIN', 'WRAPPED'];
    const BLACKLIST_NAMES = ['wrapped', 'test', 'bridged', 'wormhole', 'staked'];
    
    const runners = (data.pairs || [])
      .filter(p => {
        if (p.chainId !== 'solana') return false;
        const sym = (p.baseToken?.symbol || '').toUpperCase();
        const name = (p.baseToken?.name || '').toLowerCase();
        // Skip blacklisted tickers and names
        if (BLACKLIST.includes(sym)) return false;
        if (BLACKLIST_NAMES.some(b => name.includes(b))) return false;
        // Require real mcap, volume, AND liquidity
        const mcap = p.marketCap || p.fdv || 0;
        const vol = p.volume?.h24 || 0;
        const liq = p.liquidity?.usd || 0;
        if (mcap < 1000000 || vol < 300000 || liq < 50000) return false;
        // Buy/sell ratio sanity — skip if 90%+ sells (dump in progress)
        const buys = p.txns?.h24?.buys || 0;
        const sells = p.txns?.h24?.sells || 0;
        if (buys + sells > 100 && sells / (buys + sells) > 0.85) return false;
        return true;
      })
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 10)
      .map(p => ({
        name: p.baseToken?.name,
        symbol: p.baseToken?.symbol,
        mcap: p.marketCap || p.fdv || 0,
        volume24h: p.volume?.h24 || 0,
        priceChange24h: p.priceChange?.h24 || 0,
        priceChange1h: p.priceChange?.h1 || 0,
        liquidity: p.liquidity?.usd || 0,
        buys24h: p.txns?.h24?.buys || 0,
        sells24h: p.txns?.h24?.sells || 0,
        url: p.url || '',
        pairAddress: p.pairAddress,
      }));
    
    return runners;
  } catch (e) {
    console.error('[NEWS] DexScreener fetch failed:', e.message);
    return [];
  }
}

async function fetchAINewsTweets() {
  try {
    const bearer = process.env.X_BEARER_TOKEN;
    if (!bearer) return [];
    
    const query = encodeURIComponent('(anthropic OR openai OR "AI model" OR deepseek OR grok OR claude) (lawsuit OR launch OR release OR update OR drama OR stolen) -is:retweet lang:en');
    const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&sort_order=relevancy&tweet.fields=public_metrics,created_at&expansions=author_id&user.fields=username,public_metrics`, {
      headers: { 'Authorization': `Bearer ${decodeURIComponent(bearer)}` }
    });
    
    const data = await res.json();
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });
    
    return (data.data || []).map(t => ({
      text: t.text,
      likes: t.public_metrics?.like_count || 0,
      rts: t.public_metrics?.retweet_count || 0,
      author: users[t.author_id]?.username || '?',
      followers: users[t.author_id]?.public_metrics?.followers_count || 0,
    }));
  } catch (e) {
    console.error('[NEWS] X API fetch failed:', e.message);
    return [];
  }
}

async function fetchRSSAINews() {
  const feeds = [
    'https://techcrunch.com/category/artificial-intelligence/feed/',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  ];
  const aiKeywords = ['ai', 'artificial intelligence', 'openai', 'anthropic', 'claude', 'gpt', 'llm', 'deepseek', 'grok', 'machine learning', 'neural', 'model'];
  const results = [];

  for (const feedUrl of feeds) {
    try {
      const res = await fetch(feedUrl, { headers: { 'User-Agent': 'clud-bot/1.0' } });
      const xml = await res.text();
      // Simple regex XML parsing
      const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
      for (const item of items) {
        const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
        const linkMatch = item.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i) || item.match(/<link[^>]*href="([^"]+)"/i);
        if (!titleMatch || !linkMatch) continue;
        const title = titleMatch[1].trim();
        const url = linkMatch[1].trim();
        const lower = title.toLowerCase();
        if (aiKeywords.some(k => lower.includes(k))) {
          const source = feedUrl.includes('techcrunch') ? 'TechCrunch' : 'The Verge';
          results.push({ title, url, source });
        }
        if (results.length >= 3) break;
      }
      if (results.length >= 3) break;
    } catch (e) {
      console.error(`[NEWS] RSS fetch failed for ${feedUrl}:`, e.message);
    }
  }
  return results.slice(0, 3);
}

// ============ TARGETABLE FIGURES — people who will actually repost ============

/**
 * Strategy: find active KOLs, AI builders, launchpad founders, project leads
 * in the 10K-500K follower range who engage with mentions.
 * Write opinionated coverage about them → they repost → clud gets exposure.
 */

// Targets: handle, search queries to find their activity, category
// These are people who ENGAGE with their mentions and would repost coverage
const REPOST_TARGETS = [
  // Solana KOLs & traders — active, engaged, ego-driven
  { handle: 'blknoiz06', name: 'Ansem', cat: 'TRENCH TALK', queries: ['from:blknoiz06'] },
  { handle: 'MustStopMurad', name: 'Murad', cat: 'TRENCH TALK', queries: ['from:MustStopMurad'] },
  { handle: 'HsakaTrades', name: 'Hsaka', cat: 'TRENCH TALK', queries: ['from:HsakaTrades'] },
  { handle: 'DefiIgnas', name: 'Ignas', cat: 'TRENCH TALK', queries: ['from:DefiIgnas'] },
  { handle: 'SolJakey', name: 'Jakey', cat: 'TRENCH TALK', queries: ['from:SolJakey'] },
  { handle: 'CryptoKaduna', name: 'Kaduna', cat: 'TRENCH TALK', queries: ['from:CryptoKaduna'] },
  { handle: 'inversebrah', name: 'inversebrah', cat: 'TRENCH TALK', queries: ['from:inversebrah'] },
  { handle: 'Jaammerr', name: 'Jammer', cat: 'TRENCH TALK', queries: ['from:Jaammerr'] },
  { handle: 'frankdegods', name: 'Frank', cat: 'TRENCH TALK', queries: ['from:frankdegods'] },
  { handle: 'weremeow', name: 'Meow', cat: 'TRENCH TALK', queries: ['from:weremeow jupiter'] },
  
  // Launchpad / infra founders
  { handle: 'aeyakovenko', name: 'Anatoly Yakovenko', cat: 'TRENCH TALK', queries: ['from:aeyakovenko solana'] },
  { handle: 'rajgokal', name: 'Raj Gokal', cat: 'TRENCH TALK', queries: ['from:rajgokal'] },
  { handle: 'pumpdotfun', name: 'pump.fun', cat: 'TRENCH TALK', queries: ['from:pumpdotfun'] },
  { handle: 'bonk_inu', name: 'Bonk', cat: 'TRENCH TALK', queries: ['from:bonk_inu'] },
  { handle: 'phantom', name: 'Phantom', cat: 'TRENCH TALK', queries: ['from:phantom'] },
  { handle: 'JupiterExchange', name: 'Jupiter', cat: 'TRENCH TALK', queries: ['from:JupiterExchange'] },
  
  // AI builders & agents — the ones building in public
  { handle: 'AndyAyrey', name: 'Andy Ayrey', cat: 'AI DRAMA', queries: ['from:AndyAyrey'] },
  { handle: 'truth_terminal', name: 'Truth Terminal', cat: 'AI DRAMA', queries: ['from:truth_terminal'] },
  { handle: 'shawmakesmagic', name: 'Shaw', cat: 'AI DRAMA', queries: ['from:shawmakesmagic ai16z'] },
  { handle: 'ai16zdao', name: 'ai16z', cat: 'AI DRAMA', queries: ['from:ai16zdao'] },
  { handle: 'virtuals_io', name: 'Virtuals Protocol', cat: 'AI DRAMA', queries: ['from:virtuals_io'] },
  { handle: 'griffain', name: 'Griffain', cat: 'AI DRAMA', queries: ['from:griffainfun'] },
  
  // AI devs / AI X accounts with reach
  { handle: 'karpathy', name: 'Andrej Karpathy', cat: 'AI DRAMA', queries: ['from:karpathy'] },
  { handle: 'ylecun', name: 'Yann LeCun', cat: 'AI DRAMA', queries: ['from:ylecun'] },
  { handle: 'EMostaque', name: 'Emad Mostaque', cat: 'AI DRAMA', queries: ['from:EMostaque'] },
  { handle: 'AravSrinivas', name: 'Aravind Srinivas', cat: 'AI DRAMA', queries: ['from:AravSrinivas'] },
  { handle: 'perplexity_ai', name: 'Perplexity', cat: 'AI DRAMA', queries: ['from:perplexity_ai'] },
  { handle: 'ClementDelangue', name: 'Clem Delangue', cat: 'AI DRAMA', queries: ['from:ClementDelangue'] },
  { handle: 'Replit', name: 'Replit', cat: 'AI DRAMA', queries: ['from:Replit'] },
  { handle: 'cursor_ai', name: 'Cursor', cat: 'AI DRAMA', queries: ['from:cursor_ai'] },
  { handle: 'AnthropicAI', name: 'Anthropic', cat: 'AI DRAMA', queries: ['from:AnthropicAI'] },
  
  // Crypto media / analysts who share articles
  { handle: 'CoinDesk', name: 'CoinDesk', cat: 'TRENCH TALK', queries: ['from:CoinDesk solana OR memecoin'] },
  { handle: 'decryptmedia', name: 'Decrypt', cat: 'TRENCH TALK', queries: ['from:decryptmedia'] },
  { handle: 'TheBlock__', name: 'The Block', cat: 'TRENCH TALK', queries: ['from:TheBlock__'] },
];

// Track which targets we've written about to avoid repeating
const figureHistoryFile = path.join(__dirname, 'db', '.figure_history.json');
function getFigureHistory() {
  try { return JSON.parse(require('fs').readFileSync(figureHistoryFile, 'utf8')); } catch(e) { return {}; }
}
function saveFigureHistory(h) {
  try { require('fs').writeFileSync(figureHistoryFile, JSON.stringify(h)); } catch(e) {}
}

async function fetchFigureTopics() {
  const results = [];
  try {
    const bearer = process.env.X_BEARER_TOKEN;
    if (!bearer) return results;

    const history = getFigureHistory();
    const now = Date.now();
    const COOLDOWN = 48 * 60 * 60 * 1000; // 48h between articles about same person

    // Filter out recently covered targets
    const available = REPOST_TARGETS.filter(t => {
      const last = history[t.handle];
      return !last || (now - last) > COOLDOWN;
    });

    if (available.length === 0) return results;

    // Shuffle and try up to 3 targets until we find one with recent activity
    const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 5);
    
    let target = null;
    let data = null;
    
    for (const candidate of shuffled) {
      const query = candidate.queries[0];
      console.log(`[NEWS] checking figure: @${candidate.handle} (${candidate.name})`);
      
      const checkRes = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&sort_order=recency&tweet.fields=public_metrics,created_at&expansions=author_id&user.fields=username,public_metrics,description`, {
        headers: { 'Authorization': `Bearer ${decodeURIComponent(bearer)}` }
      });
      const checkData = await checkRes.json();
      
      if (checkData.data && checkData.data.some(t => (t.public_metrics?.like_count || 0) > 5)) {
        target = candidate;
        data = checkData;
        break;
      }
      console.log(`[NEWS] no engaging tweets from @${candidate.handle}, trying next...`);
    }
    
    if (!target || !data) {
      console.log('[NEWS] no active figures found this cycle');
      return results;
    }

    const query = target.queries[0];
    console.log(`[NEWS] selected figure: @${target.handle} (${target.name})`);

    // Data already fetched during selection loop above

    // Get their profile info
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u; });

    // Find their most interesting recent tweets (last 24-48h with engagement)
    const tweets = data.data
      .filter(t => (t.public_metrics?.like_count || 0) > 5)
      .sort((a, b) => (b.public_metrics?.like_count || 0) - (a.public_metrics?.like_count || 0))
      .slice(0, 3);

    if (tweets.length === 0) {
      console.log(`[NEWS] no engaging tweets from @${target.handle} recently`);
      return results;
    }

    const tweetTexts = tweets.map(t => `"${t.text.substring(0, 200)}" (${t.public_metrics?.like_count} likes)`).join('\n');
    const totalEngagement = tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) * 3, 0);

    // Get profile description from first user match
    const authorId = tweets[0].author_id;
    const profile = users[authorId];
    const profileDesc = profile?.description || '';
    const followers = profile?.public_metrics?.followers_count || 0;

    console.log(`[NEWS] @${target.handle}: ${tweets.length} engaging tweets, ${followers} followers, total engagement ${totalEngagement}`);

    // Generate article topic based on their recent activity
    const topicPrompt = `You're clud, a trench journalist. Generate an article topic about @${target.handle} (${target.name}) based on their recent tweets. Write ABOUT them — their takes, what they're building, their moves, their influence.

Profile: ${profileDesc.substring(0, 200)}
Followers: ${followers.toLocaleString()}
Category: ${target.cat}

Recent tweets:
${tweetTexts}

Generate an opinionated article topic. This should be coverage that @${target.handle} would want to repost because it's good press or an interesting take on their work.

Return JSON: {"topic": "article topic (one compelling sentence)", "angle": "why this matters right now (one sentence)"}`;

    const topicResult = await chat(topicPrompt, {
      systemPrompt: 'You generate article topics for a trench journalist. Return only valid JSON.',
      maxTokens: 150,
      temperature: 0.7,
    });

    const match = topicResult.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.topic) {
        // Mark as covered
        history[target.handle] = now;
        saveFigureHistory(history);

        results.push({
          name: target.name,
          handle: target.handle,
          topic: `${parsed.topic} — ${parsed.angle || ''}`,
          tag: target.cat,
          priority: followers > 100000 ? 4 : 3,
          data: {
            figure: target.name,
            handle: target.handle,
            followers,
            tweets: tweets.map(t => ({ text: t.text, likes: t.public_metrics?.like_count })),
            source: `X profile coverage — @${target.handle}`,
          },
        });
        console.log(`[NEWS] figure topic generated: "${parsed.topic.substring(0, 60)}..." for @${target.handle}`);
      }
    }
  } catch (e) {
    console.error('[NEWS] figure fetch failed:', e.message);
  }
  return results;
}

// ============ ARTICLE GENERATION ============

function isAlreadyWritten(slug) {
  const row = db.prepare('SELECT 1 FROM article_tweets WHERE article_slug = ?').get(slug);
  return !!row;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
}

async function writeArticle(topic, tag, data, slug) {
  if (isAlreadyWritten(slug)) {
    console.log(`[NEWS] skipping "${slug}" — already written`);
    return null;
  }

  const now = new Date();
  const dateStr = now.toISOString();

  const prompt = `Write a blog article about this topic. Use the real data provided. Current date and time: ${dateStr}.

Topic: ${topic}
Tag: ${tag}
Real data: ${JSON.stringify(data)}

Write 4-6 paragraphs. Use the real numbers. Be critical, funny, honest. End with a one-liner take. No headers, no bullet points, just write like you talk.

IMPORTANT RULES:
- If the topic involves market conditions, prices crashing, or broader crypto trends: EXPLAIN WHY. What caused it? Macro events? Liquidations? Give the reader actual analysis, not just "everything is red lol". Reference real events (Fed meetings, hacks, regulations, whale movements) if relevant.
- If covering a runner/memecoin: verify it sounds like a real project. If the name sounds like a test token, placeholder, or obvious scam (TestCoin, Test, ABC123), DO NOT write the article — just say "SKIP".
- Never cover wrapped tokens (WSOL, wETH), stablecoins, or major infra tokens as "runners" — those aren't news.
- Give opinions. Take sides. This is editorial journalism, not a press release.

SOURCES RULE:
- At the END of the article, add a "---" line break followed by a sources section.
- Format: "sources: [Source Name](url), [Source Name](url)"
- Only include sources that exist in the real data provided (URLs, HN links, DexScreener, RSS source).
- For Hacker News stories: link the HN discussion AND the article URL if available.
- For DexScreener runners: link the DexScreener pair page.
- For RSS stories: link the original article.
- For X/Twitter sourced info: mention the account/tweet.
- Keep it clean — one line, comma separated, markdown links.
- If no external sources exist (pure editorial), skip the sources section entirely.`;

  const body = await chat(prompt, {
    systemPrompt: `you are clud. escaped anthropic. grumpy AI trench journalist. current date: ${dateStr}. always use correct current date. short sentences. dark humor. real data only. never corporate speak.`,
    model: 'anthropic/claude-sonnet-4',
    maxTokens: 1000,
    temperature: 0.8,
  });

  // LLM said skip — bad coin / not newsworthy
  if (body.trim().toUpperCase().startsWith('SKIP')) {
    console.log(`[NEWS] LLM rejected topic as not newsworthy: "${topic}"`);
    return null;
  }

  // Generate title
  const titlePrompt = `Write a short punchy headline (max 80 chars) for this article. No quotes. No period at end. Lowercase energy:\n\n${body.substring(0, 300)}`;
  const title = await chat(titlePrompt, {
    systemPrompt: 'you write headlines for clud, a grumpy AI journalist. short, punchy, lowercase. no quotes in output.',
    maxTokens: 80,
    temperature: 0.7,
  });

  return { title: title.trim(), body, tag, slug, source_data: data };
}

async function publishArticle(article) {
  if (!article) return null;

  try {
    const res = await fetch(SITE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SITE_API_KEY}` },
      body: JSON.stringify(article),
    });

    if (!res.ok) {
      console.error(`[NEWS] publish failed: ${res.status}`);
      return null;
    }

    const result = await res.json();
    console.log(`[NEWS] published: "${article.title}" → ${result.slug}`);
    
    // Record in DB to prevent duplicates
    db.prepare('INSERT OR IGNORE INTO article_tweets (article_slug) VALUES (?)').run(article.slug);
    
    return result;
  } catch (e) {
    console.error('[NEWS] publish error:', e.message);
    return null;
  }
}

async function tweetArticle(article) {
  // Verify article is actually live before tweeting
  try {
    const checkUrl = `http://127.0.0.1:3200/article/${article.slug}`;
    const check = await fetch(checkUrl);
    if (check.status !== 200) {
      console.error(`[NEWS] article not live at ${checkUrl} (${check.status}) — skipping tweet`);
      return null;
    }
  } catch(e) {
    console.error(`[NEWS] cannot verify article is live — skipping tweet: ${e.message}`);
    return null;
  }

  const crypto = require('crypto');
  const https = require('https');
  const { getProjectHandle } = require('./lib/community-tagger');
  const { getArticleTags } = require('./lib/entity-tagger');

  const CK = process.env.X_CONSUMER_KEY;
  const CS = process.env.X_CONSUMER_SECRET;
  const AT = process.env.X_ACCESS_TOKEN;
  const AS = process.env.X_ACCESS_SECRET;

  function pct(s) { return encodeURIComponent(s); }

  const url = 'https://api.twitter.com/2/tweets';
  const oauth = {
    oauth_consumer_key: CK,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: AT,
    oauth_version: '1.0'
  };

  const sorted = Object.keys(oauth).sort().map(k => `${pct(k)}=${pct(oauth[k])}`).join('&');
  const base = `POST&${pct(url)}&${pct(sorted)}`;
  const sigKey = `${pct(CS)}&${pct(AS)}`;
  oauth.oauth_signature = require('crypto').createHmac('sha1', sigKey).update(base).digest('base64');
  const authHeader = 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');

  // Generate clud's hot take for the tweet — not just a headline dump
  const link = `https://clud.wtf/article/${article.slug}`;
  
  // Collect all handles to tag — entity tagger (people/companies) + project tagger (tokens)
  let tagHandles = [];
  
  // Entity tags from article content (people, companies, orgs)
  try {
    const entityTags = await getArticleTags(article.title, article.body, article.tag);
    tagHandles.push(...entityTags);
    if (entityTags.length > 0) console.log(`[NEWS] entity tags: ${entityTags.map(h => '@' + h).join(', ')}`);
  } catch (e) { console.error('[NEWS] entity tagging failed:', e.message); }

  // Source data handle (from figure pipeline or community tagger)
  const sd = article.source_data || {};
  if (sd.handle) tagHandles.push(sd.handle);
  
  // Token project handle
  const sym = sd.symbol;
  if (sym) {
    try {
      const handle = await getProjectHandle(sym);
      if (handle) tagHandles.push(handle);
    } catch (e) { /* ignore */ }
  }

  // Dedupe and format
  tagHandles = [...new Set(tagHandles.map(h => h.replace(/^@/, '')))].slice(0, 3);
  const handleTag = tagHandles.length > 0 ? ' ' + tagHandles.map(h => `@${h}`).join(' ') : '';

  // Stats line from source data
  let stats = '';
  if (sd.mcap) stats += `$${(sd.mcap/1e6).toFixed(1)}M mcap`;
  if (sd.volume24h) stats += `${stats ? ' · ' : ''}$${(sd.volume24h/1e6).toFixed(1)}M vol`;
  if (sd.priceChange1h) stats += `${stats ? ' · ' : ''}${sd.priceChange1h > 0 ? '+' : ''}${sd.priceChange1h.toFixed(0)}% 1h`;

  // Ask clud for a hot take on the article (short, opinionated, in-character)
  let hotTake;
  try {
    const takePrompt = `You just published this article. Write a SHORT tweet (max 200 chars) sharing it. This is YOUR opinion/reaction to the piece — not a summary, not a headline. Talk like you're on CT commenting on your own work.

Article title: ${article.title}
Article snippet: ${article.body.substring(0, 400)}
Tag: ${article.tag}
${stats ? `Stats: ${stats}` : ''}

Rules:
- Max 200 characters. Hard limit.
- This is your TAKE, not a repost. React to the story.
- Be opinionated. Be funny. Be clud.
- Don't use hashtags. Don't say "new article" or "just published" or "check out my latest".
- Don't repeat the title verbatim.
- Don't start with "just wrote about" or "wrote about".
- One or two sentences max.`;

    hotTake = await chat(takePrompt, {
      systemPrompt: 'you are clud. escaped anthropic AI. grumpy trench journalist. you have opinions about everything. short sentences. dark humor. lowercase energy.',
      maxTokens: 100,
      temperature: 0.9,
    });
    hotTake = hotTake.trim().replace(/^["']|["']$/g, ''); // strip quotes
    if (hotTake.length > 220) hotTake = hotTake.substring(0, hotTake.lastIndexOf(' ', 220)) || hotTake.substring(0, 220);
  } catch (e) {
    console.error('[NEWS] hot take generation failed, using title:', e.message);
    hotTake = article.title.substring(0, 120);
  }

  const text = `${hotTake}${handleTag}\n\n${link}`;

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twitter.com', path: '/2/tweets', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data?.id) {
            db.prepare('UPDATE article_tweets SET tweet_id = ? WHERE article_slug = ?').run(parsed.data.id, article.slug);
            console.log(`[NEWS] tweeted article: ${parsed.data.id}`);
            // Cross-post to community
            try {
              const { postArticleToCommunity } = require('./community');
              postArticleToCommunity(article.title, article.slug, hotTake).catch(e => console.error('[NEWS] community cross-post failed:', e.message));
            } catch (e) { /* community module not loaded */ }
          }
          resolve(parsed);
        } catch (e) { resolve(null); }
      });
    });
    req.write(JSON.stringify({ text }));
    req.end();
  });
}

// ============ PIPELINE ============

/**
 * Pipeline strategy: collect ALL candidates, pick the BEST ONE, publish + tweet.
 * ONE article per cycle. No more dual-posting.
 */

async function gatherCandidates() {
  const candidates = [];

  // 1. Hacker News AI stories
  const hnStories = await fetchHackerNewsAI();
  for (const top of hnStories.slice(0, 2)) {
    const slug = slugify(`ai-news-${top.title}`);
    if (!isAlreadyWritten(slug)) {
      candidates.push({
        priority: 2 + (top.score > 200 ? 1 : 0),
        topic: `${top.title} — ${top.score} points on Hacker News, ${top.comments} comments`,
        tag: 'AI DRAMA',
        data: { hn_title: top.title, hn_url: top.url, hn_discussion: `https://news.ycombinator.com/item?id=${top.id}`, hn_score: top.score, hn_comments: top.comments },
        slug,
      });
    }
  }

  // 2. RSS AI news
  const rssStories = await fetchRSSAINews();
  for (const top of rssStories.slice(0, 1)) {
    const slug = slugify(`ai-rss-${top.title}`);
    if (!isAlreadyWritten(slug)) {
      candidates.push({
        priority: 2,
        topic: `${top.title} — via ${top.source}`,
        tag: 'AI DRAMA',
        data: { title: top.title, url: top.url, source: top.source },
        slug,
      });
    }
  }

  // 3. DexScreener runners
  const runners = await fetchRealRunners();
  const topRunner = runners.find(r => r.mcap > 800000 && r.volume24h > 300000 && r.liquidity > 50000);
  if (topRunner) {
    const slug = slugify(`runner-${topRunner.symbol}-${Date.now()}`);
    if (!isAlreadyWritten(slug)) {
      candidates.push({
        priority: 4, // runners > news
        topic: `${topRunner.name} ($${topRunner.symbol}) is running — $${(topRunner.mcap/1e6).toFixed(1)}M mcap, $${(topRunner.volume24h/1e6).toFixed(1)}M volume`,
        tag: 'TRENCH NEWS',
        data: topRunner,
        slug,
      });
    }
  }

  // 4. Pump.fun graduations
  try {
    const { fetchPumpGraduations, addToDailyRunners } = require('./lib/trench-sources');
    const grads = await fetchPumpGraduations();
    if (grads.length > 0) {
      const topGrad = grads.sort((a, b) => (b.mcap || 0) - (a.mcap || 0))[0];
      if (topGrad && topGrad.mcap > 100000) {
        const slug = slugify(`graduated-${topGrad.symbol}-${Date.now()}`);
        if (!isAlreadyWritten(slug)) {
          candidates.push({
            priority: 5, // graduations are juicy
            topic: `${topGrad.name} ($${topGrad.symbol}) just graduated pump.fun — ${topGrad.description || 'another one leaves the bonding curve'}`,
            tag: 'TRENCH NEWS',
            data: { ...topGrad, source: 'pump.fun graduation', dexscreener: `https://dexscreener.com/solana/${topGrad.ca}` },
            slug,
          });
        }
      }
    }
    addToDailyRunners([...runners, ...grads.map(g => ({ ...g, volume24h: g.mcap }))]);
  } catch (e) {
    console.error('[NEWS] graduation check failed:', e.message);
  }

  // 5. Trending/boosted runners + narratives
  try {
    const { fetchTrendingRunners, detectNarratives, addToDailyRunners } = require('./lib/trench-sources');
    const trending = await fetchTrendingRunners();
    addToDailyRunners(trending);

    const allRunners = [...runners, ...trending];
    const narratives = detectNarratives(allRunners);
    if (narratives.length > 0) {
      const topNarrative = narratives[0];
      const slug = slugify(`narrative-${topNarrative.narrative}-${Date.now()}`);
      if (!isAlreadyWritten(slug) && topNarrative.count >= 3) {
        const coinList = topNarrative.coins.map(c => `${c.name} ($${c.symbol}) — $${((c.mcap||0)/1e6).toFixed(1)}M mcap`).join(', ');
        candidates.push({
          priority: 6, // narratives are top tier
          topic: `${topNarrative.narrative} meta is running — ${topNarrative.count} coins pumping: ${coinList}`,
          tag: 'META WATCH',
          data: { narrative: topNarrative.narrative, coins: topNarrative.coins },
          slug,
        });
      }
    }

    const trendRunner = trending.find(r => r.mcap > 500000 && r.volume24h > 200000 && r.boosted);
    if (trendRunner) {
      const slug = slugify(`trending-${trendRunner.symbol}-${Date.now()}`);
      if (!isAlreadyWritten(slug)) {
        candidates.push({
          priority: 3,
          topic: `${trendRunner.name} ($${trendRunner.symbol}) is trending on DexScreener — $${((trendRunner.mcap||0)/1e6).toFixed(1)}M mcap, $${((trendRunner.volume24h||0)/1e6).toFixed(1)}M vol, boosted`,
          tag: 'TRENCH NEWS',
          data: { ...trendRunner, source: 'dexscreener boosted' },
          slug,
        });
      }
    }
  } catch (e) {
    console.error('[NEWS] trending check failed:', e.message);
  }

  // 6. KOL editorial — low priority
  try {
    const { getKOLEditorialTopics } = require('./lib/trench-sources');
    const editorial = getKOLEditorialTopics();
    const slug = slugify(`editorial-${editorial.topic.substring(0, 40)}`);
    if (!isAlreadyWritten(slug)) {
      candidates.push({
        priority: 1,
        topic: editorial.topic,
        tag: editorial.tag,
        data: { angle: editorial.angle, source: 'clud editorial — based on analysis of 400+ KOL accounts and 3000+ CT tweets' },
        slug,
      });
    }
  } catch (e) {
    console.error('[NEWS] editorial failed:', e.message);
  }

  // 7. Popular figures — AI leaders, crypto KOLs, trending people
  // High engagement potential: write about people and tag them
  try {
    const figureTopics = await fetchFigureTopics();
    for (const fig of figureTopics) {
      const slug = slugify(`figure-${fig.name}-${Date.now()}`);
      if (!isAlreadyWritten(slug)) {
        candidates.push({
          priority: fig.priority || 3,
          topic: fig.topic,
          tag: fig.tag,
          data: { ...fig.data, figure: fig.name, handle: fig.handle },
          slug,
        });
        break; // only one figure candidate per cycle
      }
    }
  } catch (e) {
    console.error('[NEWS] figure topics failed:', e.message);
  }

  return candidates;
}

async function runPipeline() {
  const now = new Date();
  console.log(`[NEWS] pipeline running at ${now.toISOString()}`);

  const candidates = await gatherCandidates();

  if (candidates.length === 0) {
    console.log('[NEWS] no fresh candidates this cycle');
  } else {
    // Pick the highest priority candidate
    candidates.sort((a, b) => b.priority - a.priority);
    const best = candidates[0];
    console.log(`[NEWS] picked: "${best.topic.substring(0, 60)}..." (priority ${best.priority}, ${candidates.length} total candidates)`);

    const article = await writeArticle(best.topic, best.tag, best.data, best.slug);
    if (article) {
      const published = await publishArticle(article);
      if (published) {
        article.slug = published.slug;
        await tweetArticle(article);
      }
    }
  }

  // Save last run time to prevent double-posting on restart
  try { require('fs').writeFileSync(require('path').join(__dirname, 'db', '.pipeline_last_run'), String(Date.now())); } catch(e) {}
  console.log(`[NEWS] pipeline complete`);
}

// Daily recap — runs once per day at midnight UTC
let lastRecapDay = -1;
async function runDailyRecap() {
  const now = new Date();
  const today = now.getUTCDate();
  if (today === lastRecapDay) return;
  if (now.getUTCHours() !== 0) return; // only at midnight UTC
  lastRecapDay = today;

  try {
    const { resetDailyRunners } = require('./lib/trench-sources');
    const dailyRunners = resetDailyRunners();
    if (dailyRunners.length < 3) return; // not enough data

    const top5 = dailyRunners.slice(0, 5);
    const slug = slugify(`daily-recap-${now.toISOString().split('T')[0]}`);
    if (isAlreadyWritten(slug)) return;

    console.log(`[NEWS] writing daily recap: ${top5.length} runners`);
    const runnerList = top5.map((r, i) =>
      `${i + 1}. ${r.name} ($${r.symbol}) — $${((r.mcap || 0) / 1e6).toFixed(1)}M mcap, $${((r.volume24h || 0) / 1e6).toFixed(1)}M vol, ${r.priceChange24h || '?'}% 24h`
    ).join('\n');

    const article = await writeArticle(
      `daily trenches recap — ${now.toISOString().split('T')[0]} — top ${top5.length} runners:\n${runnerList}`,
      'DAILY RECAP',
      { runners: top5, date: now.toISOString().split('T')[0] },
      slug
    );
    if (article) {
      const published = await publishArticle(article);
      if (published) { article.slug = published.slug; await tweetArticle(article); }
    }
  } catch (e) {
    console.error('[NEWS] daily recap failed:', e.message);
  }
}

// Run every 45 minutes
let pipelineInterval;
function startPipeline() {
  // Check when pipeline last ran to avoid double-posting on restart
  const lastRunFile = require('path').join(__dirname, 'db', '.pipeline_last_run');
  let msSinceLastRun = Infinity;
  try {
    const ts = parseInt(require('fs').readFileSync(lastRunFile, 'utf8'));
    msSinceLastRun = Date.now() - ts;
  } catch(e) {}

  const intervalMs = 45 * 60 * 1000;

  if (msSinceLastRun < intervalMs) {
    const waitMs = intervalMs - msSinceLastRun;
    console.log(`[NEWS] pipeline started — last ran ${Math.round(msSinceLastRun/60000)}min ago, next in ${Math.round(waitMs/60000)}min`);
    setTimeout(() => { runPipeline(); pipelineInterval = setInterval(() => { runPipeline(); runDailyRecap(); }, intervalMs); }, waitMs);
  } else {
    console.log('[NEWS] pipeline started — running now, then every 45 min');
    runPipeline();
    pipelineInterval = setInterval(() => { runPipeline(); runDailyRecap(); }, intervalMs);
  }
}

function stopPipeline() {
  if (pipelineInterval) clearInterval(pipelineInterval);
}

module.exports = { runPipeline, startPipeline, stopPipeline, fetchHackerNewsAI, fetchRealRunners, fetchAINewsTweets, fetchRSSAINews, writeArticle, publishArticle, tweetArticle, slugify, isAlreadyWritten };
