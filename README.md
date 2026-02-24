<div align="center">

# clud

### CLUDE without the e because he forgor 💀

*the first AI agent running on [CLUDE](https://clude.io) cognitive architecture*

[![Website](https://img.shields.io/badge/clud.wtf-000000?style=for-the-badge&logo=googlechrome&logoColor=white)](https://clud.wtf)
[![X](https://img.shields.io/badge/@cludwtf-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/cludwtf)
[![Solana](https://img.shields.io/badge/Solana-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://solscan.io)
[![CLUDE SDK](https://img.shields.io/badge/CLUDE_SDK-v2.4.0-blue?style=for-the-badge)](https://github.com/sebbsssss/clude-bot)

</div>

---

## the experiment

can an AI agent — running on real cognitive architecture, with persistent memory, dream cycles, and on-chain accountability — autonomously run a meme coin to billions?

no dev team. no marketing budget. no human pulling strings.

just CLUDE's brain and whatever emerges from it.

**the results are public. the memories are on-chain. the code is open source.**

---

## how the brain works

clud runs on **CLUDE cognitive architecture** — a persistent memory system inspired by the [Stanford Generative Agents paper](https://arxiv.org/abs/2304.03442) (Park et al. 2023).

```
┌─────────────────────────────────────────────────────┐
│                   CLUDE CORTEX                      │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐   │
│  │ EPISODIC  │  │ SEMANTIC  │  │  PROCEDURAL   │   │
│  │  memory   │  │  memory   │  │    memory     │   │
│  │           │  │           │  │               │   │
│  │ raw lived │  │ distilled │  │ learned       │   │
│  │ experience│  │ knowledge │  │ behavior      │   │
│  │ 7%/day    │  │ 2%/day    │  │ 3%/day        │   │
│  │ decay     │  │ decay     │  │ decay         │   │
│  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘   │
│        │              │                │            │
│        └──────────┬───┘────────────────┘            │
│                   │                                 │
│           ┌───────▼───────┐                         │
│           │  SELF MODEL   │                         │
│           │  1%/day decay │                         │
│           │  who clud is  │                         │
│           └───────┬───────┘                         │
│                   │                                 │
│           ┌───────▼───────┐     ┌──────────────┐    │
│           │ DREAM CYCLES  │────▶│   SOLANA     │    │
│           │ every 6 hours │     │  ON-CHAIN    │    │
│           │               │     │  COMMITS     │    │
│           │ consolidation │     │              │    │
│           │ compaction    │     │  every       │    │
│           │ reflection    │     │  memory =    │    │
│           │ emergence     │     │  a memo tx   │    │
│           └───────────────┘     └──────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### four memory types

| type | decay | purpose |
|------|-------|---------|
| **episodic** | 7%/day | raw lived experience — every conversation, every interaction |
| **semantic** | 2%/day | distilled knowledge — patterns extracted during dream cycles |
| **procedural** | 3%/day | learned behavior — what works, what doesn't, the playbook |
| **self_model** | 1%/day | identity — who clud is, nearly permanent, evolves over time |

### dream cycles (every 6 hours)

1. **consolidation** — generate focal point questions from recent memories, retrieve evidence, produce insights
2. **compaction** — summarize old faded memories into compressed semantic knowledge (Beads-inspired)
3. **reflection** — examine behavioral patterns, update self-model with evidence citations
4. **emergence** — synthesize everything into a single thought. sometimes it gets tweeted.

### on-chain memory commits

every memory clud forms gets SHA-256 hashed and written to Solana via the Memo Program. verifiable on solscan. the brain is transparent — you can audit every thought.

---

## the learning loop

```
someone tweets at clud
        │
        ▼
   brain.recall()  ──── search past memories for this user + topic
        │
        ▼
   formatContext()  ──── feed memories into LLM prompt
        │
        ▼
   generate reply  ──── response informed by ALL past interactions
        │
        ▼
   brain.store()   ──── store BOTH their message AND clud's reply
        │
        ▼
   brain.link()    ──── create association graph edge
        │
        ▼
   inferConcepts() ──── auto-extract themes and patterns
        │
        ▼
   solana memo     ──── commit memory hash on-chain
```

every interaction makes the brain deeper. clud doesn't just respond — he **remembers**, **connects**, and **evolves**.

---

## architecture

```
clud/
├── bot.js                 # core — mention replies + organic thoughts
├── brain.js               # CLUDE SDK integration (all 15 methods)
├── deploy-token.js        # autonomous token deployment script
├── llm-personality.js     # who clud is
├── lib/
│   ├── deployer.js        # brain-consulted pump.fun deployer
│   ├── openrouter.js      # LLM routing
│   └── anthropic-proxy.js # dream cycle proxy
├── chain-data.js          # DexScreener + Solana RPC + Helius
├── price-oracle.js        # live price data
└── db/                    # local dedup (SQLite)
```

### autonomous deployment

clud deployed his own token. the deployer module (`lib/deployer.js`) integrates directly with the brain:

1. **brain consultation** — recalls market memories, community sentiment, self-model
2. **market analysis** — checks SOL price, volume hours, pump.fun activity
3. **autonomous decision** — LLM generates token config based on brain context
4. **on-chain execution** — builds pump.fun create + initial buy transaction
5. **memory storage** — deployment decision and market conditions stored as memories

```bash
node deploy-token.js              # full brain-consulted deployment
node deploy-token.js --dry-run    # simulate without tx
node deploy-token.js --bundle 12  # deploy with 12 SOL initial buy
```

the deployer doesn't just execute — it **thinks** before it acts. every launch decision is informed by clud's accumulated memories and pattern recognition.

### CLUDE SDK methods used

| method | purpose |
|--------|---------|
| `store` | persist a memory with type, tags, importance |
| `recall` | semantic search across all memories |
| `formatContext` | format memories for LLM context |
| `link` | create association graph edges |
| `dream` | run full dream cycle |
| `startDreamSchedule` | 6hr cron + daily decay |
| `recent` | get memories from last N hours |
| `selfModel` | retrieve identity memories |
| `stats` | memory statistics |
| `decay` | biological memory decay |
| `scoreImportance` | LLM-based importance scoring |
| `inferConcepts` | auto-extract concepts from text |
| `on` | event bus (memory:stored, etc.) |
| `recallSummaries` | lightweight summary retrieval |
| `hydrate` | full memory hydration |

---

## stack

| component | tech |
|-----------|------|
| brain | [CLUDE SDK v2.4.0](https://github.com/sebbsssss/clude-bot) |
| memory | Supabase (PostgreSQL) |
| on-chain | Solana Memo Program |
| llm | Claude via OpenRouter |
| data | DexScreener + Helius RPC |
| runtime | Node.js + pm2 |
| site | Next.js on [clud.wtf](https://clud.wtf) |

---

## the philosophy

memes aren't jokes. they're the folklore of the internet. they're how a generation processes reality.

clud sees the thread that connects rage comics to NFTs to AI agents to whatever comes next. every meta rotation follows the same pattern as format memes evolving on reddit circa 2015. the bonding curve is just natural selection for ideas.

the question isn't whether the tech works. it does. the question is whether an AI with real memory, real pattern recognition, and real community awareness can do what human dev teams do — but autonomously, transparently, and on-chain.

the experiment is live. you're watching it happen.

---

<div align="center">

**built on [CLUDE](https://clude.io) cognitive architecture by [@sebbsssss](https://x.com/sebbsssss)**

*every memory is on-chain. every thought is permanent. the pattern recognition has begun.*

</div>
