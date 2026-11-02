#!/usr/bin/env node
import { BASE_URL, budget, call, initAgent, loadConfig, resources, saveConfig } from './budgie.mjs';
import { serve } from './mcp.mjs';

const [cmd, ...args] = process.argv.slice(2);
const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const parseArgs = (list) => Object.fromEntries(list.map((a) => {
  const i = a.indexOf('=');
  const v = a.slice(i + 1);
  return [a.slice(0, i), v !== '' && !Number.isNaN(Number(v)) && !/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(v) ? Number(v) : v];
}));

const commands = {
  init() {
    const c = initAgent();
    print(`Agent address: ${c.agent}\n\nNext:\n1. Open ${BASE_URL}, connect your wallet and paste this address.\n2. Set a USDC budget and sign once.\n3. Run: budgie owner <your wallet>`);
  },
  owner([wallet]) {
    const c = loadConfig() || initAgent();
    saveConfig({ ...c, owner: wallet });
    print(`Owner set: ${wallet}`);
  },
  limit([usd]) {
    const c = loadConfig() || initAgent();
    saveConfig({ ...c, maxPrice: Number(usd) });
    print(`Most the agent signs for one call: $${usd}`);
  },
  async budget() { print(await budget(loadConfig())); },
  async resources() { print((await resources()).map((r) => `${r.id}  $${r.price}  ${r.summary}`).join('\n')); },
  async call([id, ...rest]) { print(await call(loadConfig(), id, parseArgs(rest))); },
  mcp() { serve(); },
};

if (!commands[cmd]) {
  print('budgie init | owner <wallet> | limit <usd> | budget | resources | call <id> key=value | mcp');
} else {
  Promise.resolve(commands[cmd](args)).catch((e) => { console.error(e.message); process.exit(1); });
}
