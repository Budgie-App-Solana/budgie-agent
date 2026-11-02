// Proves on devnet that an SPL delegate can pay an x402 `exact` quote through the PayAI facilitator,
// and that the chain refuses to go past the allowance. Run: node delegate-devnet.mjs <keys.json>
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram,
  TransactionInstruction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, approve, getAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const MAINNET = process.argv[3] === 'mainnet';
const RPC = MAINNET ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com';
const FACILITATOR = 'https://facilitator.payai.network';
const NETWORK = MAINNET ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' : 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const FEE_PAYER = new PublicKey(MAINNET ? 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww' : '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DECIMALS = 6;
const ALLOWANCE = 10_000n; // 0.01
const PRICE = 4_000n; // 0.004

const conn = new Connection(RPC, 'confirmed');
const keysFile = process.argv[2];
if (!keysFile) throw new Error('pass a path for the throwaway keys');

const saved = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, 'utf8')) : {};
const load = (name) => {
  if (saved[name]) return Keypair.fromSecretKey(Uint8Array.from(saved[name]));
  const kp = Keypair.generate();
  saved[name] = [...kp.secretKey];
  return kp;
};
const owner = load('owner');
const agent = load('agent');
const merchant = load('merchant');
fs.writeFileSync(keysFile, JSON.stringify(saved));
console.log('owner   ', owner.publicKey.toBase58());
console.log('agent   ', agent.publicKey.toBase58());
console.log('merchant', merchant.publicKey.toBase58());

if (MAINNET) console.log('SOL', (await conn.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL);
else if ((await conn.getBalance(owner.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
  console.log('airdrop...');
  const sig = await conn.requestAirdrop(owner.publicKey, LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig);
}

let mint = MAINNET ? USDC : saved.mint && new PublicKey(saved.mint);
if (!mint) {
  mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS);
  saved.mint = mint.toBase58();
  fs.writeFileSync(keysFile, JSON.stringify(saved));
}
console.log('mint    ', mint.toBase58());

const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
const merchantAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, merchant.publicKey);
if (!MAINNET) await mintTo(conn, owner, mint, ownerAta.address, owner, 1_000_000n);
await approve(conn, owner, ownerAta.address, agent.publicKey, owner, ALLOWANCE);
const allowance = async () => (await getAccount(conn, ownerAta.address)).delegatedAmount;
console.log('allowance', await allowance());

const requirement = (amount) => ({
  scheme: 'exact', network: NETWORK, amount: String(amount), asset: mint.toBase58(),
  payTo: merchant.publicKey.toBase58(), maxTimeoutSeconds: 60, extra: { feePayer: FEE_PAYER.toBase58() },
});

// The agent key signs as the transfer authority. The owner never signs anything here.
async function buildPayment(amount) {
  const { blockhash } = await conn.getLatestBlockhash();
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(ownerAta.address, mint, merchantAta.address, agent.publicKey, amount, DECIMALS),
    new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(crypto.randomBytes(16).toString('hex')) }),
  ];
  const message = new TransactionMessage({ payerKey: FEE_PAYER, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([agent]);
  return Buffer.from(tx.serialize()).toString('base64');
}

async function facilitator(path, amount, transaction) {
  const accepted = requirement(amount);
  const paymentPayload = {
    x402Version: 2, accepted, payload: { transaction },
    resource: { url: 'https://budgie.test/v1/devnet', description: 'delegate test', mimeType: 'application/json' },
  };
  const res = await fetch(FACILITATOR + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: accepted }),
  });
  const body = await res.text();
  console.log(path, res.status, body.slice(0, 400));
  try { return JSON.parse(body); } catch { return {}; }
}

console.log('\n1. payment inside the allowance');
const inside = await buildPayment(PRICE);
const v = await facilitator('/verify', PRICE, inside);
if (v.isValid) {
  const s = await facilitator('/settle', PRICE, inside);
  console.log('settled tx', s.transaction);
  console.log('allowance now', await allowance());
  console.log('merchant balance', (await getAccount(conn, merchantAta.address)).amount);
}

console.log('\n2. payment above what is left of the allowance');
const over = await buildPayment(ALLOWANCE);
await facilitator('/verify', ALLOWANCE, over);

console.log('\n3. owner revokes nothing, chain state');
console.log('allowance', await allowance(), 'owner balance', (await getAccount(conn, ownerAta.address)).amount);
