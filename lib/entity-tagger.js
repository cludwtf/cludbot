/**
 * Entity Tagger — finds X handles for people, companies, and projects in articles
 * 
 * Strategy:
 * 1. LLM extracts named entities from article (people, companies, projects)
 * 2. Known handles DB checked first (hardcoded + cached)
 * 3. X API user lookup for verification
 * 4. Only returns verified handles
 */

const Database = require('better-sqlite3');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');
const { chat } = require('./openrouter');

const db = new Database(path.join(__dirname, '..', 'db', 'clud.db'));

// Ensure cache table exists
db.exec(`CREATE TABLE IF NOT EXISTS entity_handles (
  entity TEXT PRIMARY KEY,
  handle TEXT,
  verified INTEGER DEFAULT 0,
  updated_at INTEGER
)`);

const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days

// Known handles — high-confidence mappings (no API call needed)
const KNOWN_HANDLES = {
  // AI companies & leaders
  'sam altman': 'sama',
  'openai': 'OpenAI',
  'anthropic': 'AnthropicAI',
  'dario amodei': 'DarioAmodei',
  'elon musk': 'elonmusk',
  'grok': 'xai',
  'xai': 'xai',
  'deepseek': 'deepseek_ai',
  'google': 'Google',
  'google ai': 'GoogleAI',
  'sundar pichai': 'sundarpichai',
  'meta': 'Meta',
  'meta ai': 'AIatMeta',
  'mark zuckerberg': 'finkd',
  // AI agents & builders
  'andy ayrey': 'AndyAyrey',
  'truth terminal': 'truth_terminal',
  'shaw': 'shawmakesmagic',
  'ai16z': 'ai16zdao',
  'virtuals': 'virtuals_io',
  'griffain': 'griffainfun',
  // Solana KOLs
  'ansem': 'blknoiz06',
  'murad': 'MustStopMurad',
  'hsaka': 'HsakaTrades',
  'ignas': 'DefiIgnas',
  'frank degods': 'frankdegods',
  'inversebrah': 'inversebrah',
  'mistral': 'MistralAI',
  'nvidia': 'nvidia',
  'jensen huang': 'nvidia',
  'hugging face': 'huggingface',
  'stability ai': 'StabilityAI',
  'midjourney': 'midjourney',
  'andrej karpathy': 'karpathy',
  'yann lecun': 'ylecun',
  'demis hassabis': 'demishassabis',
  'google deepmind': 'GoogleDeepMind',
  'perplexity': 'perplexity_ai',
  'aravind srinivas': 'AravSrinivas',
  'cursor': 'cursor_ai',
  'replit': 'Replit',
  'amjad masad': 'amasad',
  'windsurf': 'codeiumdev',
  'codeium': 'codeiumdev',
  'clem delangue': 'ClementDelangue',
  'hugging face': 'huggingface',
  'groq': 'GroqInc',
  'together ai': 'togethercompute',
  'a16z': 'a16z',
  'marc andreessen': 'pmarca',
  'sequoia': 'sequoia',
  // Crypto / Meme figures
  'vitalik buterin': 'VitalikButerin',
  'vitalik': 'VitalikButerin',
  'cz': 'cz_binance',
  'binance': 'binance',
  'solana': 'solana',
  'anatoly yakovenko': 'aeyakovenko',
  'raj gokal': 'rajgokal',
  'jupiter': 'JupiterExchange',
  'raydium': 'RaydiumProtocol',
  'pump.fun': 'pumpdotfun',
  'pumpfun': 'pumpdotfun',
  'bonk': 'bonk_inu',
  'coinbase': 'coinbase',
  'brian armstrong': 'brian_armstrong',
  'phantom': 'phantom',
  'ansem': 'blknoiz06',
  'murad': 'MustStopMurad',
  'hsaka': 'HsakaTrades',
  'cobie': 'cobie',
  'emad mostaque': 'EMostaque',
  'arthur hayes': 'CryptoHayes',
  'bitboy': 'Bitboy_Crypto',
  'michael saylor': 'saylor',
  'microstrategy': 'saylor',
  'hacker news': 'ycombinator',
  'y combinator': 'ycombinator',
  'paul graham': 'paulg',
  'techcrunch': 'TechCrunch',
  'the verge': 'verge',
  'coindesk': 'CoinDesk',
  'decrypt': 'decryptmedia',
};

function getCached(entity) {
  const row = db.prepare('SELECT handle, verified, updated_at FROM entity_handles WHERE entity = ?').get(entity.toLowerCase());
  if (row && (Date.now() - row.updated_at) < CACHE_TTL) return row.handle || null;
  return undefined;
}

function setCache(entity, handle, verified = false) {
  db.prepare('INSERT OR REPLACE INTO entity_handles (entity, handle, verified, updated_at) VALUES (?, ?, ?, ?)').run(entity.toLowerCase(), handle || '', verified ? 1 : 0, Date.now());
}

/**
 * Verify an X handle exists and get follower count
 */
async function verifyXHandle(handle) {
  try {
    const bearer = process.env.X_BEARER_TOKEN;
    if (!bearer) return null;
    const res = await fetch(`https://api.twitter.com/2/users/by/username/${handle}?user.fields=public_metrics,verified,description`, {
      headers: { 'Authorization': `Bearer ${decodeURIComponent(bearer)}` }
    });
    const data = await res.json();
    if (data.data) {
      return {
        username: data.data.username,
        followers: data.data.public_metrics?.followers_count || 0,
        verified: data.data.verified || false,
      };
    }
  } catch (e) {
    console.error(`[ENTITY] X verify failed for @${handle}:`, e.message);
  }
  return null;
}

/**
 * Extract taggable entities from an article using LLM
 */
async function extractEntities(title, body, tag) {
  try {
    const prompt = `From this article, extract the names of people, companies, projects, or organizations that are the MAIN SUBJECT and would have an official X/Twitter account. Only include entities that are central to the story — not passing mentions.

Title: ${title}
Tag: ${tag}
Content: ${body.substring(0, 800)}

Return a JSON array of objects: [{"name": "entity name", "handle_guess": "their likely X handle or null"}]
Return max 3 entities. Only return entities you're fairly confident about. If none are taggable, return [].`;

    const result = await chat(prompt, {
      systemPrompt: 'You extract named entities from articles. Return only valid JSON arrays. No markdown wrapping.',
      maxTokens: 200,
      temperature: 0.2,
    });

    // Parse JSON from response
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      const entities = JSON.parse(match[0]);
      return entities.filter(e => e.name && typeof e.name === 'string');
    }
  } catch (e) {
    console.error('[ENTITY] extraction failed:', e.message);
  }
  return [];
}

/**
 * Main function: get verified X handles for article entities
 * Returns array of verified handles to tag
 */
async function getArticleTags(title, body, tag) {
  const handles = [];
  
  try {
    const entities = await extractEntities(title, body, tag);
    console.log(`[ENTITY] extracted ${entities.length} entities from "${title.substring(0, 40)}..."`);

    for (const entity of entities.slice(0, 3)) {
      const name = entity.name.toLowerCase().trim();
      
      // 1. Check known handles
      if (KNOWN_HANDLES[name]) {
        const handle = KNOWN_HANDLES[name];
        console.log(`[ENTITY] known handle: ${entity.name} → @${handle}`);
        handles.push(handle);
        continue;
      }

      // 2. Check cache
      const cached = getCached(name);
      if (cached !== undefined) {
        if (cached) handles.push(cached);
        continue;
      }

      // 3. Try LLM's guess and verify via X API
      if (entity.handle_guess) {
        const clean = entity.handle_guess.replace(/^@/, '');
        const verified = await verifyXHandle(clean);
        if (verified && verified.followers > 500) {
          console.log(`[ENTITY] verified: ${entity.name} → @${clean} (${verified.followers} followers)`);
          setCache(name, clean, true);
          handles.push(clean);
          continue;
        }
      }

      // 4. Search X for the entity
      try {
        const bearer = process.env.X_BEARER_TOKEN;
        if (bearer) {
          const query = encodeURIComponent(`"${entity.name}"`);
          const res = await fetch(`https://api.twitter.com/2/users/by/username/${(entity.handle_guess || entity.name).replace(/[^a-zA-Z0-9_]/g, '')}?user.fields=public_metrics`, {
            headers: { 'Authorization': `Bearer ${decodeURIComponent(bearer)}` }
          });
          const data = await res.json();
          if (data.data && data.data.public_metrics?.followers_count > 1000) {
            const h = data.data.username;
            console.log(`[ENTITY] found: ${entity.name} → @${h} (${data.data.public_metrics.followers_count} followers)`);
            setCache(name, h, true);
            handles.push(h);
            continue;
          }
        }
      } catch (e) { /* skip */ }

      // Cache miss
      setCache(name, null, false);
    }
  } catch (e) {
    console.error('[ENTITY] tagging failed:', e.message);
  }

  // Dedupe
  return [...new Set(handles)];
}

module.exports = { getArticleTags, verifyXHandle, KNOWN_HANDLES };
