// The agent side. The key here is a delegate: it can only spend the allowance the owner set
// on their USDC account, and the owner can revoke it from their wallet at any time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

export const BASE_URL = process.env.BUDGIE_URL || 'https://budgieapp.fun';
const RPC = process.env.BUDGIE_RPC || 'https://solana-rpc.publicnode.com';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const HOME = process.env.BUDGIE_HOME || path.join(os.homedir(), '.budgie');
const CONFIG = path.join(HOME, 'agent.json');

export function loadConfig() {
  return fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')) : null;
}

export function saveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function initAgent() {
  const existing = loadConfig();
  if (existing) return existing;
  const kp = Keypair.generate();
  const cfg = { agent: kp.publicKey.toBase58(), secret: [...kp.secretKey], owner: null, maxPrice: 0.1 };
  saveConfig(cfg);
  return cfg;
}

const keypair = (cfg) => Keypair.fromSecretKey(Uint8Array.from(cfg.secret));

// Builds the transfer the x402 `exact` scheme expects, signed by the agent as the delegate.
// The owner does not sign. The facilitator signs last, as the fee payer.
export async function signPayment(cfg, req, conn) {
  const mint = new PublicKey(req.asset);
  const source = getAssociatedTokenAddressSync(mint, new PublicKey(cfg.owner));
  const destination = getAssociatedTokenAddressSync(mint, new PublicKey(req.payTo));
  const { blockhash } = await conn.getLatestBlockhash();
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(source, mint, destination, keypair(cfg).publicKey, BigInt(req.amount), 6),
    new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(crypto.randomBytes(16).toString('hex')) }),
  ];
  const message = new TransactionMessage({ payerKey: new PublicKey(req.extra.feePayer), recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([keypair(cfg)]);
  return Buffer.from(tx.serialize()).toString('base64');
}

// Pays any x402 endpoint that takes USDC on Solana. Refuses anything above maxPrice before signing.
export async function pay(cfg, url, body = {}, { confirm, headers = {} } = {}) {
  if (!cfg?.owner) throw new Error('no_owner: run `budgie owner <your wallet>` first');
  const init = { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
  let res = await fetch(url, init);
  if (res.status !== 402) return res.json();
  const quote = await res.json();
  const req = (quote.accepts || []).find((a) => a.scheme === 'exact' && a.network === NETWORK && a.asset === USDC);
  if (!req) throw new Error('no_solana_usdc: this endpoint does not take USDC on Solana');
  const usd = Number(req.amount) / 1e6;
  if (usd > cfg.maxPrice) throw new Error(`over_max_price: $${usd} is above your $${cfg.maxPrice} limit`);
  if (confirm && !await confirm({ usd, url, payTo: req.payTo })) throw new Error('declined');
  const conn = new Connection(RPC, 'confirmed');
  const transaction = await signPayment(cfg, req, conn);
  const payment = { x402Version: 2, resource: quote.resource, accepted: req, payload: { transaction } };
  init.headers['PAYMENT-SIGNATURE'] = Buffer.from(JSON.stringify(payment)).toString('base64');
  res = await fetch(url, init);
  return res.json();
}

// Only Budgie hears the owner wallet, for the holder price. Other x402 services never get it.
export const call = (cfg, id, input, opts) => pay(cfg, `${BASE_URL}/v1/${id}`, input, { ...opts, headers: { 'x-budgie-owner': cfg.owner } });
export const resources = async () => (await (await fetch(`${BASE_URL}/v1/resources`)).json()).data;
export const budget = async (cfg) => (await fetch(`${BASE_URL}/api/budget?owner=${cfg.owner}`)).json();
