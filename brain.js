/**
 * clud's brain — proper CLUDE SDK integration
 * Uses every method the SDK provides. No custom scoring overrides.
 * Let CLUDE's architecture do what it was built to do.
 */

const { Cortex } = require('clude-bot');
require('dotenv').config();

let brain = null;

async function initBrain() {
  const config = {
    supabase: {
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_KEY,
    },
  };

  // Anthropic — enables dream cycles + LLM importance scoring
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-5-20250929',
    };
  }

  // Embeddings — enables vector similarity search
  if (process.env.VOYAGE_API_KEY) {
    config.embedding = {
      provider: 'voyage',
      apiKey: process.env.VOYAGE_API_KEY,
      model: 'voyage-3',
      dimensions: 1024,
    };
  } else if (process.env.OPENAI_API_KEY) {
    config.embedding = {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }

  // Solana — on-chain memory commits
  if (process.env.SOLANA_PRIVATE_KEY) {
    config.solana = {
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      botWalletPrivateKey: process.env.SOLANA_PRIVATE_KEY,
    };
  }

  brain = new Cortex(config);
  await brain.init();
  console.log('[BRAIN] cortex online.');

  return brain;
}

// ============ STORE — let CLUDE handle importance scoring ============
async function remember(content, opts = {}) {
  if (!brain) return null;
  try {
    const storeOpts = {
      type: opts.type || 'episodic',
      content,
      summary: opts.summary || content.substring(0, 200),
      source: opts.source || 'clud-bot',
      tags: opts.tags || [],
      relatedUser: opts.user || undefined,
      sourceId: opts.sourceId || undefined,
      metadata: opts.metadata || {},
    };

    // Let CLUDE score importance via LLM if anthropic is configured
    // Only override if explicitly passed
    if (opts.importance !== undefined) {
      storeOpts.importance = opts.importance;
    }

    // Let CLUDE infer concepts automatically
    if (!opts.skipConcepts) {
      const concepts = brain.inferConcepts(
        storeOpts.summary,
        storeOpts.source,
        storeOpts.tags
      );
      if (concepts && concepts.length > 0) {
        storeOpts.concepts = concepts;
      }
    }

    // Emotional valence if provided
    if (opts.emotion !== undefined) storeOpts.emotionalValence = opts.emotion;

    // Evidence chain
    if (opts.evidenceIds) storeOpts.evidenceIds = opts.evidenceIds;

    const id = await brain.store(storeOpts);
    console.log(`[BRAIN] stored #${id}: "${content.substring(0, 50)}..." [${storeOpts.type}]`);
    return id;
  } catch (e) {
    console.error('[BRAIN] store failed:', e.message);
    return null;
  }
}

// ============ RECALL — use CLUDE's hybrid retrieval ============
async function recall(query, opts = {}) {
  if (!brain) return [];
  try {
    return await brain.recall({
      query,
      limit: opts.limit || 5,
      memoryTypes: opts.types || undefined,
      relatedUser: opts.user || undefined,
      minImportance: opts.minImportance || 0.1,
      tags: opts.tags || undefined,
      trackAccess: true, // hebbian reinforcement
    });
  } catch (e) {
    console.error('[BRAIN] recall failed:', e.message);
    return [];
  }
}

// ============ USE CLUDE's formatContext (not our own) ============
function formatMemoryContext(memories) {
  if (!brain || !memories || memories.length === 0) return '';
  try {
    return brain.formatContext(memories);
  } catch (e) {
    // Fallback
    return memories.map(m => `[${m.memory_type}] ${m.content}`).join('\n');
  }
}

// ============ RECENT — get last N hours of memories ============
async function getRecent(hours = 6, types = undefined, limit = 10) {
  if (!brain) return [];
  try {
    return await brain.recent(hours, types, limit);
  } catch (e) {
    console.error('[BRAIN] recent failed:', e.message);
    return [];
  }
}

// ============ SELF MODEL — who clud thinks he is ============
async function selfModel() {
  if (!brain) return [];
  try {
    return await brain.selfModel();
  } catch (e) { return []; }
}

// ============ LINK — association graph ============
async function link(sourceId, targetId, type = 'relates', strength = 0.5) {
  if (!brain) return;
  try {
    await brain.link(sourceId, targetId, type, strength);
    console.log(`[BRAIN] linked #${sourceId} → #${targetId} [${type}]`);
  } catch (e) {
    console.error('[BRAIN] link failed:', e.message);
  }
}

// ============ DREAM — let CLUDE consolidate ============
async function dream() {
  if (!brain) return null;
  console.log('[BRAIN] dream cycle starting...');
  try {
    let emergenceText = null;
    await brain.dream({
      onEmergence: async (text) => {
        emergenceText = text;
        console.log(`[BRAIN] emergence: "${text.substring(0, 100)}..."`);
      },
    });
    return emergenceText;
  } catch (e) {
    console.error('[BRAIN] dream failed:', e.message);
    return null;
  }
}

// ============ DREAM SCHEDULE ============
function startDreamSchedule() {
  if (!brain) return;
  try {
    brain.startDreamSchedule();
    console.log('[BRAIN] dream schedule started (6hr cycle with daily decay)');
  } catch (e) {
    console.error('[BRAIN] dream schedule failed:', e.message);
  }
}

// ============ DREAM CALLBACK ============
let dreamCallback = null;
function onDream(cb) {
  dreamCallback = cb;
  if (brain) {
    // Override the dream cycle's emergence callback
    const origDream = brain.dream.bind(brain);
    brain.dream = async (opts = {}) => {
      return origDream({
        ...opts,
        onEmergence: async (text) => {
          if (opts.onEmergence) await opts.onEmergence(text);
          if (dreamCallback) await dreamCallback(text);
        },
      });
    };
  }
}

// ============ STATS ============
async function brainStats() {
  if (!brain) return null;
  try { return await brain.stats(); } catch (e) { return null; }
}

// ============ SCORE IMPORTANCE ============
async function scoreImportance(text) {
  if (!brain) return 0.5;
  try { return await brain.scoreImportance(text); } catch (e) { return 0.5; }
}

// ============ SUMMARIES + HYDRATE ============
async function recallSummaries(query, opts = {}) {
  if (!brain) return [];
  try {
    return await brain.recallSummaries({
      query,
      limit: opts.limit || 10,
      relatedUser: opts.user || undefined,
    });
  } catch (e) { return []; }
}

async function hydrate(ids) {
  if (!brain) return [];
  try { return await brain.hydrate(ids); } catch (e) { return []; }
}

function getBrain() { return brain; }

module.exports = {
  initBrain,
  remember,
  recall,
  formatMemoryContext,
  getRecent,
  selfModel,
  link,
  dream,
  startDreamSchedule,
  onDream,
  brainStats,
  scoreImportance,
  recallSummaries,
  hydrate,
  getBrain,
};
