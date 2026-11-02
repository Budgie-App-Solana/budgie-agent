// Local MCP server over stdio. It pays from the on-chain budget, inside maxPrice.
import readline from 'node:readline';
import { budget, call, loadConfig, pay, resources } from './budgie.mjs';

const TOOLS = [
  { name: 'budgie_resources', description: 'List resources with prices and input fields.', inputSchema: { type: 'object', properties: {} } },
  { name: 'budgie_budget', description: 'USDC balance, delegate and allowance left on the owner wallet.', inputSchema: { type: 'object', properties: {} } },
  { name: 'budgie_call', description: 'Run a Budgie resource and pay for it from the budget.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, input: { type: 'object' } }, required: ['id'] } },
  { name: 'budgie_pay', description: 'Call any x402 URL that takes USDC on Solana and pay it from the budget.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, input: { type: 'object' } }, required: ['url'] } },
];

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

async function runTool(name, a) {
  const cfg = loadConfig();
  if (name === 'budgie_resources') return resources();
  if (name === 'budgie_budget') return budget(cfg);
  if (name === 'budgie_call') return call(cfg, a.id, a.input || {});
  if (name === 'budgie_pay') return pay(cfg, a.url, a.input || {});
  throw new Error('unknown_tool');
}

export function serve() {
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return;
    const ok = (result) => send({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') return ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'budgie', version: '0.1.0' } });
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: TOOLS });
    if (m.method === 'tools/call') {
      try { return ok(text(await runTool(m.params.name, m.params.arguments || {}))); } catch (e) {
        return ok({ ...text({ error: e.message }), isError: true });
      }
    }
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method' } });
  });
}
