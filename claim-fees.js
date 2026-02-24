/**
 * Claim pump.fun creator fees via distribute_creator_fees
 * 
 * The bonding curve creator is a sharing_config PDA on the fee program.
 * Our wallet is the sole shareholder (100%). distribute_creator_fees
 * sends accumulated fees from the creator vault to shareholders.
 */

const { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
require('dotenv').config();

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const MINT = new PublicKey('EEidPrkMeU5hcbTqnNbv3JEkvCiVDCx1NWuk4EQpump');
const BC = new PublicKey('CKNXE3jNbvHN8e8L7YC11mqwbXNiXBzccuZvZFDECVqr');
const BC_CREATOR = new PublicKey('89n7KhdVZwvUSMYTZFsJmHWYUGxSrNGv2YUH3cQp3Jak'); // sharing_config PDA

const RPC = 'https://api.mainnet-beta.solana.com';

const [VAULT] = PublicKey.findProgramAddressSync(
  [Buffer.from('creator-vault'), BC_CREATOR.toBuffer()],
  PUMP
);
const [EVENT_AUTH] = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  PUMP
);

async function checkFees() {
  const conn = new Connection(RPC);
  const vaultInfo = await conn.getAccountInfo(VAULT);
  if (!vaultInfo) return 0;
  const rent = await conn.getMinimumBalanceForRentExemption(vaultInfo.data.length);
  return (vaultInfo.lamports - rent) / 1e9;
}

async function claimFees() {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) { console.error('[FEES] no private key'); return null; }
  
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  const conn = new Connection(RPC);
  
  const claimable = await checkFees();
  if (claimable < 0.5) {
    console.log(`[FEES] ${claimable.toFixed(4)} SOL claimable (need 0.5+ for burn), accumulating...`);
    return null;
  }
  
  console.log(`[FEES] claiming ${claimable.toFixed(4)} SOL...`);
  
  // distribute_creator_fees discriminator
  const disc = Buffer.from([165, 114, 103, 0, 121, 206, 247, 81]);
  
  const ix = new TransactionInstruction({
    programId: PUMP,
    keys: [
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: BC, isSigner: false, isWritable: false },
      { pubkey: BC_CREATOR, isSigner: false, isWritable: false }, // sharing_config
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTH, isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
      // remaining: shareholders (our wallet is sole shareholder)
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
    ],
    data: disc,
  });
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
  tx.add(ix);
  tx.feePayer = wallet.publicKey;
  
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet);
    
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    
    if (conf.value.err) {
      console.error(`[FEES] tx failed:`, JSON.stringify(conf.value.err));
      return null;
    }
    
    console.log(`[FEES] ✅ claimed ${claimable.toFixed(4)} SOL — tx: ${sig}`);
    return { sig, amount: claimable };
  } catch(e) {
    console.error(`[FEES] error:`, e.message);
    return null;
  }
}

if (require.main === module) {
  claimFees().then(r => { if (r) console.log('Done:', r); process.exit(); });
}

module.exports = { claimFees, checkFees };
