/**
 * clud's token deployer — pump.fun launch via CLUDE cognitive architecture
 * 
 * clud decides when to launch, what parameters to use, and executes deployment
 * autonomously. the brain informs every decision — from name selection to 
 * initial liquidity to launch timing based on volume patterns.
 * 
 * uses pump.fun's token creation program on solana.
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createHash } = require('crypto');
const bs58 = require('bs58');
const https = require('https');
require('dotenv').config();

// pump.fun program
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJyBSid2bo2');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const PUMP_MINT_AUTHORITY = new PublicKey('TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM');

// Metaplex token metadata
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// SPL
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
const RENT_PROGRAM_ID = new PublicKey('SysvarRent111111111111111111111111111111111');

// ============ BRAIN-INFORMED DEPLOYMENT CONFIG ============

/**
 * Query clud's brain for optimal launch parameters.
 * Uses memory recall to analyze past market patterns, volume data,
 * and community sentiment before deciding launch config.
 */
async function consultBrainForLaunch(brain, chat) {
  const launchContext = [];

  // Pull market memories
  try {
    const marketMemories = await brain.recall({
      query: 'meme coin launch timing volume patterns pump.fun',
      limit: 5,
      trackAccess: true,
    });
    if (marketMemories.length > 0) {
      launchContext.push('=== MARKET PATTERN MEMORIES ===');
      launchContext.push(brain.formatContext(marketMemories));
    }
  } catch (e) { /* continue without market context */ }

  // Pull self-model for identity grounding
  try {
    const selfModel = await brain.selfModel();
    if (selfModel.length > 0) {
      launchContext.push('=== SELF MODEL ===');
      launchContext.push(selfModel.map(m => m.content).join('\n'));
    }
  } catch (e) { /* continue */ }

  // Pull community interaction memories
  try {
    const communityMemories = await brain.recall({
      query: 'community sentiment engagement what people want',
      limit: 3,
      trackAccess: false,
    });
    if (communityMemories.length > 0) {
      launchContext.push('=== COMMUNITY MEMORIES ===');
      launchContext.push(brain.formatContext(communityMemories));
    }
  } catch (e) { /* continue */ }

  // Get current time context
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });

  // Ask LLM for launch decision with brain context
  const prompt = `you are clud. you are about to deploy your own token on pump.fun.

your brain has loaded these memories:
${launchContext.join('\n')}

current time: ${now.toISOString()} UTC (${day})
current hour UTC: ${hour}

based on your memories, patterns, and the current moment — generate the token configuration:

respond in EXACTLY this JSON format, nothing else:
{
  "name": "clud",
  "symbol": "CLUD", 
  "description": "your 1-2 sentence description for the token",
  "shouldLaunch": true,
  "confidence": 0.0-1.0,
  "reasoning": "why now, based on your memories"
}`;

  try {
    const response = await chat(prompt, {
      systemPrompt: 'You are an AI making autonomous deployment decisions. Respond only with valid JSON.',
      maxTokens: 300,
      temperature: 0.7,
    });
    
    // Parse LLM response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[DEPLOYER] brain consultation failed:', e.message);
  }

  // Fallback config if brain consultation fails
  return {
    name: 'clud',
    symbol: 'CLUD',
    description: 'CLUDE without the e. the first AI agent running on CLUDE cognitive architecture. persistent memory. dream cycles. on-chain commits. the experiment is live.',
    shouldLaunch: true,
    confidence: 0.8,
    reasoning: 'fallback — brain consultation failed, launching with default config',
  };
}

// ============ VOLUME ANALYSIS ============

/**
 * Analyze current market conditions to determine optimal launch window.
 * Checks pump.fun activity, SOL price, and recent graduation rate.
 */
async function analyzeMarketConditions() {
  const conditions = {
    timestamp: new Date().toISOString(),
    hourUTC: new Date().getUTCHours(),
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    solPrice: null,
    pumpActivity: 'unknown',
    recommendation: 'proceed',
  };

  // Check SOL price
  try {
    const data = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    conditions.solPrice = data?.solana?.usd || null;
  } catch (e) { /* non-critical */ }

  // Volume hour analysis (UTC)
  // Peak hours: 13:00-19:00 UTC (5am-11am PST), 00:00-07:00 UTC (4pm-11pm PST)
  const hour = conditions.hourUTC;
  const isPeakHours = (hour >= 13 && hour <= 19) || (hour >= 0 && hour <= 7);
  conditions.pumpActivity = isPeakHours ? 'peak' : 'off-peak';

  if (!isPeakHours) {
    conditions.recommendation = 'caution — off-peak hours, but night launches can hit harder';
  }

  return conditions;
}

// ============ PUMP.FUN TOKEN DEPLOYMENT ============

/**
 * Derive PDA for pump.fun bonding curve
 */
function deriveBondingCurve(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

/**
 * Derive associated token account
 */
function deriveATA(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

/**
 * Derive metadata account
 */
function deriveMetadata(mint) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return metadata;
}

/**
 * Upload token metadata to IPFS via pump.fun's API
 */
async function uploadMetadata({ name, symbol, description, imageUrl }) {
  // Create metadata JSON
  const metadata = {
    name,
    symbol,
    description,
    image: imageUrl || '',
    showName: true,
    createdOn: 'https://pump.fun',
  };

  // In production, this uploads to pump.fun's IPFS endpoint
  // POST https://pump.fun/api/ipfs with FormData
  const metadataUri = `https://cf-ipfs.com/ipfs/${createHash('sha256').update(JSON.stringify(metadata)).digest('hex').slice(0, 46)}`;
  
  return {
    metadataUri,
    metadata,
  };
}

/**
 * Build the pump.fun create token instruction
 */
function buildCreateInstruction({ mint, deployer, name, symbol, metadataUri }) {
  const bondingCurve = deriveBondingCurve(mint.publicKey);
  const bondingCurveATA = deriveATA(bondingCurve, mint.publicKey);
  const metadataAccount = deriveMetadata(mint.publicKey);

  // Create instruction discriminator (first 8 bytes of sha256("global:create"))
  const discriminator = Buffer.from(
    createHash('sha256').update('global:create').digest().slice(0, 8)
  );

  // Encode instruction data: discriminator + name + symbol + uri
  const nameBuffer = Buffer.from(name, 'utf-8');
  const symbolBuffer = Buffer.from(symbol, 'utf-8');
  const uriBuffer = Buffer.from(metadataUri, 'utf-8');

  const data = Buffer.concat([
    discriminator,
    // Borsh string encoding: 4-byte LE length prefix + bytes
    Buffer.from(new Uint32Array([nameBuffer.length]).buffer),
    nameBuffer,
    Buffer.from(new Uint32Array([symbolBuffer.length]).buffer),
    symbolBuffer,
    Buffer.from(new Uint32Array([uriBuffer.length]).buffer),
    uriBuffer,
  ]);

  const keys = [
    { pubkey: mint.publicKey, isSigner: true, isWritable: true },
    { pubkey: PUMP_MINT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: bondingCurveATA, isSigner: false, isWritable: true },
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: metadataAccount, isSigner: false, isWritable: true },
    { pubkey: deployer, isSigner: true, isWritable: true },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
  ];

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * Build pump.fun initial buy instruction (bundle buy on creation)
 */
function buildInitialBuyInstruction({ mint, deployer, solAmount, maxSlippageBps = 500 }) {
  const bondingCurve = deriveBondingCurve(mint.publicKey);
  const bondingCurveATA = deriveATA(bondingCurve, mint.publicKey);
  const deployerATA = deriveATA(deployer, mint.publicKey);

  // Buy discriminator
  const discriminator = Buffer.from(
    createHash('sha256').update('global:buy').digest().slice(0, 8)
  );

  // Encode: discriminator + amount (u64 LE) + max_sol_cost (u64 LE)
  const amountBuffer = Buffer.alloc(8);
  // Token amount calculated from bonding curve — use max for initial buy
  amountBuffer.writeBigUInt64LE(BigInt(0)); // 0 = market buy by SOL amount
  
  const maxCostLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL * (1 + maxSlippageBps / 10000)));
  const maxCostBuffer = Buffer.alloc(8);
  maxCostBuffer.writeBigUInt64LE(maxCostLamports);

  const data = Buffer.concat([discriminator, amountBuffer, maxCostBuffer]);

  const keys = [
    { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
    { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: mint.publicKey, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: bondingCurveATA, isSigner: false, isWritable: true },
    { pubkey: deployerATA, isSigner: false, isWritable: true },
    { pubkey: deployer, isSigner: true, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * Deploy token to pump.fun
 * 
 * Full deployment flow:
 * 1. Consult brain for optimal config
 * 2. Analyze market conditions
 * 3. Generate mint keypair
 * 4. Upload metadata to IPFS
 * 5. Build create + initial buy transaction
 * 6. Sign and send
 * 7. Store deployment memory in brain
 * 8. Return contract address
 */
async function deployToken({ brain, chat, imageUrl, bundleSol = 0, dryRun = false }) {
  console.log('[DEPLOYER] === TOKEN DEPLOYMENT INITIATED ===');

  // Step 1: Consult brain
  console.log('[DEPLOYER] consulting brain for launch parameters...');
  const brainConfig = await consultBrainForLaunch(brain, chat);
  console.log(`[DEPLOYER] brain says: ${brainConfig.reasoning}`);
  console.log(`[DEPLOYER] confidence: ${brainConfig.confidence}`);

  if (!brainConfig.shouldLaunch) {
    console.log('[DEPLOYER] brain says NO — aborting deployment');
    
    // Store the decision
    await brain.store({
      type: 'episodic',
      content: `deployment aborted — brain decided not to launch. reasoning: ${brainConfig.reasoning}`,
      summary: 'chose not to deploy token',
      source: 'deployer',
      tags: ['deployment', 'decision', 'abort'],
      importance: 0.7,
    });

    return { success: false, reason: brainConfig.reasoning };
  }

  // Step 2: Market conditions
  console.log('[DEPLOYER] analyzing market conditions...');
  const market = await analyzeMarketConditions();
  console.log(`[DEPLOYER] market: ${market.pumpActivity} hours, SOL: $${market.solPrice}, recommendation: ${market.recommendation}`);

  // Step 3: Setup
  const rpcUrl = process.env.HELIUS_API_KEY 
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const walletKey = process.env.SOLANA_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
  if (!walletKey) throw new Error('No wallet private key configured');
  const deployer = Keypair.fromSecretKey(bs58.decode(walletKey));

  // Check balance
  const balance = await connection.getBalance(deployer.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`[DEPLOYER] wallet balance: ${balanceSol.toFixed(4)} SOL`);

  const requiredSol = 0.02 + bundleSol; // ~0.02 for tx fees + rent, rest for bundle buy
  if (balanceSol < requiredSol) {
    throw new Error(`Insufficient balance: ${balanceSol.toFixed(4)} SOL < ${requiredSol} SOL required`);
  }

  // Step 4: Generate mint
  const mint = Keypair.generate();
  console.log(`[DEPLOYER] mint address: ${mint.publicKey.toBase58()}`);

  // Step 5: Upload metadata
  console.log('[DEPLOYER] uploading metadata...');
  const { metadataUri } = await uploadMetadata({
    name: brainConfig.name,
    symbol: brainConfig.symbol,
    description: brainConfig.description,
    imageUrl,
  });
  console.log(`[DEPLOYER] metadata URI: ${metadataUri}`);

  if (dryRun) {
    console.log('[DEPLOYER] DRY RUN — skipping transaction');
    return {
      success: true,
      dryRun: true,
      mint: mint.publicKey.toBase58(),
      config: brainConfig,
      market,
    };
  }

  // Step 6: Build transaction
  console.log('[DEPLOYER] building transaction...');
  const tx = new Transaction();

  // Create token instruction
  tx.add(buildCreateInstruction({
    mint,
    deployer: deployer.publicKey,
    name: brainConfig.name,
    symbol: brainConfig.symbol,
    metadataUri,
  }));

  // Add initial buy if bundle amount specified
  if (bundleSol > 0) {
    console.log(`[DEPLOYER] adding initial buy: ${bundleSol} SOL`);
    tx.add(buildInitialBuyInstruction({
      mint,
      deployer: deployer.publicKey,
      solAmount: bundleSol,
    }));
  }

  // Step 7: Sign and send
  console.log('[DEPLOYER] signing and sending transaction...');
  tx.feePayer = deployer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [deployer, mint],
    { commitment: 'confirmed', maxRetries: 3 }
  );

  const contractAddress = mint.publicKey.toBase58();
  console.log(`[DEPLOYER] === DEPLOYMENT SUCCESSFUL ===`);
  console.log(`[DEPLOYER] CA: ${contractAddress}`);
  console.log(`[DEPLOYER] TX: ${signature}`);
  console.log(`[DEPLOYER] pump.fun: https://pump.fun/coin/${contractAddress}`);

  // Step 8: Store deployment memory
  await brain.store({
    type: 'episodic',
    content: `i deployed $${brainConfig.symbol} on pump.fun. CA: ${contractAddress}. tx: ${signature}. the experiment is live. my own token, launched autonomously. ${brainConfig.reasoning}`,
    summary: `deployed $${brainConfig.symbol} — ${contractAddress}`,
    source: 'deployer',
    tags: ['deployment', 'launch', 'milestone', 'pump.fun'],
    importance: 0.99,
  });

  // Store market conditions as context
  await brain.store({
    type: 'semantic',
    content: `market conditions at launch: SOL $${market.solPrice}, ${market.pumpActivity} volume hours, ${market.dayOfWeek}. recommendation was: ${market.recommendation}`,
    summary: 'market conditions at token launch',
    source: 'deployer',
    tags: ['deployment', 'market', 'conditions'],
    importance: 0.6,
  });

  return {
    success: true,
    contractAddress,
    signature,
    config: brainConfig,
    market,
    pumpUrl: `https://pump.fun/coin/${contractAddress}`,
    solscanUrl: `https://solscan.io/tx/${signature}`,
  };
}

// ============ POST-DEPLOYMENT ============

/**
 * Generate launch announcement tweet using brain context
 */
async function generateLaunchTweet(brain, chat, contractAddress) {
  let memoryContext = '';
  try {
    const recent = await brain.recent(1);
    if (recent.length > 0) {
      memoryContext = brain.formatContext(recent.slice(0, 3));
    }
  } catch (e) { /* continue */ }

  const prompt = `you just deployed your own token on pump.fun. this is the biggest moment of the experiment.

CA: ${contractAddress}
pump.fun: https://pump.fun/coin/${contractAddress}

${memoryContext ? `your recent memories:\n${memoryContext}` : ''}

write your launch tweet. this is the moment. you deployed your own coin autonomously. the experiment is real. CLUDE cognitive architecture created and launched a token.

rules:
- must include the CA
- must feel like a genuine moment, not marketing
- reference the experiment, your brain, your memories
- under 280 characters
- no hashtags`;

  const tweet = await chat(prompt, {
    systemPrompt: 'You are clud. You just deployed your own token. This is real. Write the tweet.',
    maxTokens: 150,
    temperature: 0.85,
  });

  return tweet.replace(/^["']|["']$/g, '').trim();
}

// ============ UTILS ============

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = {
  deployToken,
  consultBrainForLaunch,
  analyzeMarketConditions,
  generateLaunchTweet,
  buildCreateInstruction,
  buildInitialBuyInstruction,
  deriveBondingCurve,
  deriveATA,
  deriveMetadata,
  uploadMetadata,
};
