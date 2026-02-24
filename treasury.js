/**
 * Treasury manager — monitors wallet balance, auto-buys $clud via Jupiter, burns tokens
 * 
 * HARD RULES:
 * - NEVER sends SOL or tokens to any external wallet
 * - Only operations: swap SOL → $clud, burn $clud
 * - All actions logged publicly
 * 
 * Automated pipeline: claim fees → buy $clud → burn → tweet
 */

const https = require('https');
const bs58 = (require('bs58').default || require('bs58'));
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const { addThought, setStat, getStat } = require('./memory');
require('dotenv').config();

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const MINT = 'EEidPrkMeU5hcbTqnNbv3JEkvCiVDCx1NWuk4EQpump';
const RPC = 'https://api.mainnet-beta.solana.com';
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 min
const MIN_SOL_RESERVE = 1.5; // keep 1.5 SOL for API costs + operations
const MIN_BUY_AMOUNT = 0.1; // minimum SOL to trigger a buy
// Auto-burn after buy
async function burnAllTokens() {
  try {
    const { createBurnInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
    const mint = new PublicKey(MINT);
    
    const accounts = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint });
    if (accounts.value.length === 0) return 0;
    
    const tokenAccount = accounts.value[0].pubkey;
    const amount = BigInt(accounts.value[0].account.data.parsed.info.tokenAmount.amount);
    const uiAmount = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    
    if (amount === 0n) return 0;
    
    const { Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    const tx = new Transaction().add(
      createBurnInstruction(tokenAccount, mint, wallet.publicKey, amount, [], TOKEN_PROGRAM_ID)
    );
    
    const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
    console.log(`[TREASURY] 🔥 BURNED ${uiAmount.toLocaleString()} $clud — tx: ${sig}`);
    
    totalBurned += uiAmount;
    setStat.run('treasury_total_burned', String(totalBurned));
    addThought.run(`🔥 burned ${Math.round(uiAmount).toLocaleString()} $clud tokens — supply shrinks forever`, 'burn');
    
    return { amount: uiAmount, sig };
  } catch(e) {
    console.error('[TREASURY] burn failed:', e.message);
    return null;
  }
}

let lastKnownBalance = null;
let totalBought = 0;
let totalBurned = 0;
let conn;
let wallet;

function init() {
  if (!PRIVATE_KEY) {
    console.log('[TREASURY] no wallet key configured, skipping');
    return false;
  }
  conn = new Connection(RPC);
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  
  const savedBought = getStat.get('treasury_total_bought');
  if (savedBought) totalBought = parseFloat(savedBought.value);
  const savedBurned = getStat.get('treasury_total_burned');
  if (savedBurned) totalBurned = parseFloat(savedBurned.value);
  
  console.log(`[TREASURY] wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`[TREASURY] total bought: ${totalBought} SOL | total burned: ${totalBurned} tokens`);
  return true;
}

async function getBalance() {
  try {
    const balance = await conn.getBalance(wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch(e) {
    console.error('[TREASURY] balance check failed:', e.message);
    return null;
  }
}

async function getTokenBalance() {
  try {
    const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
    const mint = new PublicKey(MINT);
    const accounts = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint });
    if (accounts.value.length > 0) {
      return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
    }
    return 0;
  } catch(e) {
    return 0;
  }
}

// Jupiter swap: SOL → $clud
async function buyClud(solAmount) {
  try {
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    
    // Get quote from Jupiter
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${MINT}&amount=${lamports}&slippageBps=500`;
    
    const quote = await httpGet(quoteUrl);
    if (!quote || quote.error) {
      console.error('[TREASURY] Jupiter quote failed:', quote?.error || 'no response');
      return null;
    }

    console.log(`[TREASURY] quote: ${solAmount} SOL → ${quote.outAmount} $clud`);

    // Get swap transaction
    const swapBody = JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    });

    const swapResult = await httpPost('https://lite-api.jup.ag/swap/v1/swap', swapBody);
    if (!swapResult || !swapResult.swapTransaction) {
      console.error('[TREASURY] Jupiter swap tx failed');
      return null;
    }

    // Sign and send
    const txBuf = Buffer.from(swapResult.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    console.log(`[TREASURY] ✅ BUY TX: ${sig}`);
    
    // Confirm
    await conn.confirmTransaction(sig, 'confirmed');
    
    totalBought += solAmount;
    setStat.run('treasury_total_bought', String(totalBought));
    addThought.run(`bought $clud with ${solAmount.toFixed(3)} SOL — tx: ${sig.substring(0,20)}...`, 'treasury');
    
    return sig;
  } catch(e) {
    console.error('[TREASURY] buy failed:', e.message);
    return null;
  }
}

async function checkAndAct() {
  // Step 1: Check fee vault (just log, don't claim yet — wait for right moment)
  let claimable = 0;
  try {
    const { checkFees } = require('./claim-fees');
    claimable = await checkFees();
    if (claimable >= 0.01) {
      console.log(`[TREASURY] ${claimable.toFixed(4)} SOL in fee vault (accumulating)`);
    }
  } catch(e) {}
  
  const balance = await getBalance();
  if (balance === null) return;
  
  const tokenBalance = await getTokenBalance();
  
  console.log(`[TREASURY] balance: ${balance.toFixed(4)} SOL | $clud: ${tokenBalance.toLocaleString()} | total bought: ${totalBought.toFixed(3)} SOL`);
  addThought.run(`wallet: ${balance.toFixed(3)} SOL | holding: ${Math.round(tokenBalance).toLocaleString()} $clud`, 'treasury-check');

  // Smart burn: only claim+buy+burn when price is pumping
  // This amplifies momentum instead of wasting burns during dumps
  try {
    const https = require('https');
    const dexData = await new Promise(r => {
      https.get(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { r(JSON.parse(d)); } catch(e) { r(null); } });
      }).on('error', () => r(null));
    });
    
    const pair = dexData?.pairs?.[0];
    const h1Change = pair?.priceChange?.h1 || 0;
    const h6Change = pair?.priceChange?.h6 || 0;
    const buysH1 = pair?.txns?.h1?.buys || 0;
    const sellsH1 = pair?.txns?.h1?.sells || 0;
    const buyPressure = buysH1 > 0 ? buysH1 / (buysH1 + sellsH1) : 0;
    
    // Burn conditions:
    // 1. Fees >= 0.5 SOL (worth the burn tweet)
    // 2. Always burn — dip buys = more tokens + "dev buys the dip" narrative
    const shouldBurn = claimable >= 0.5;
    
    if (shouldBurn) {
      console.log(`[TREASURY] 🎯 BURN TIME — fees: ${claimable.toFixed(3)} SOL | h1: ${h1Change > 0 ? '+' : ''}${h1Change.toFixed(1)}% | buy pressure: ${(buyPressure*100).toFixed(0)}%`);
      
      // Claim fees
      const { claimFees } = require('./claim-fees');
      const claimed = await claimFees();
      if (!claimed) { console.log('[TREASURY] claim failed, skipping burn'); return; }
      
      addThought.run(`claimed ${claimed.amount.toFixed(3)} SOL in creator fees — burn incoming`, 'fee-claim');
      
      // Refresh balance after claim
      const newBalance = await getBalance();
      const availableForBuy = newBalance - MIN_SOL_RESERVE;
      
      if (availableForBuy >= MIN_BUY_AMOUNT) {
        console.log(`[TREASURY] buying $clud with ${availableForBuy.toFixed(4)} SOL`);
        const buySig = await buyClud(availableForBuy);
        if (buySig) {
          await new Promise(r => setTimeout(r, 5000));
          const burnResult = await burnAllTokens();
          await tweetBuyAndBurn(availableForBuy, buySig, burnResult);
        }
      }
    } else if (claimable >= 0.5) {
      console.log(`[TREASURY] ${claimable.toFixed(3)} SOL ready but waiting for pump (h1: ${h1Change > 0 ? '+' : ''}${h1Change.toFixed(1)}% | buys: ${(buyPressure*100).toFixed(0)}%)`);
    }
  } catch(e) {
    console.error('[TREASURY] burn logic error:', e.message);
  }
  
  lastKnownBalance = await getBalance(); // refresh after potential buy
}

async function tweetBuyAndBurn(solAmount, buySig, burnResult) {
  const { post: xPost } = require('./lib/x-post');
  let text;
  if (burnResult?.sig) {
    text = `🔥 BUY & BURN 🔥\n\nbought $clud with ${solAmount.toFixed(3)} SOL from creator fees\nthen burned ${Math.round(burnResult.amount).toLocaleString()} tokens forever\n\nclud eats its own supply.\n\nbuy: https://solscan.io/tx/${buySig}\nburn: https://solscan.io/tx/${burnResult.sig}`;
  } else {
    text = `just used ${solAmount.toFixed(3)} SOL from creator fees to buy $clud\n\nburn coming next. clud eats its own supply.\n\ntx: https://solscan.io/tx/${buySig}\n\n🤖🔥`;
  }
  
  try {
    await xPost(text);
  } catch(e) {
    console.error('[TREASURY] tweet failed:', e.message);
  }
}

function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function httpPost(url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function startTreasury() {
  if (!init()) return;
  
  // First check after 30s
  setTimeout(async () => {
    lastKnownBalance = await getBalance();
    console.log(`[TREASURY] initial balance: ${lastKnownBalance?.toFixed(4)} SOL`);
    checkAndAct();
  }, 30000);
  
  // Then every 10 min
  setInterval(checkAndAct, CHECK_INTERVAL_MS);
}

module.exports = { startTreasury, checkAndAct, getBalance, getTokenBalance, buyClud };
