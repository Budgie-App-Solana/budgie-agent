# budgie-agent

Pay x402 APIs on Solana from an on-chain USDC budget. CLI, SDK and MCP server.

The agent key is an SPL delegate on your USDC account. It can spend the allowance you set and nothing else, and you can revoke it from your wallet at any time. Your USDC stays in your wallet until it is spent.

## Start

```bash
npm i -g github:ernesthayken/budgie-agent
budgie init                 # makes the agent key, prints its address
budgie owner <your wallet>  # the wallet that holds the USDC
budgie limit 0.10           # the most it signs for one call
budgie resources
budgie call token-risk mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

Set the budget on the [Budgie site](https://budgieapp.fun): connect your wallet, paste the agent address and sign once.

## MCP

```json
{ "mcpServers": { "budgie": { "command": "npx", "args": ["-y", "github:ernesthayken/budgie-agent", "mcp"] } } }
```

Tools: `budgie_resources`, `budgie_budget`, `budgie_call`, `budgie_pay`.

## Limits

- The allowance is a total, not a daily limit.
- A USDC account has one delegate. Setting a budget replaces any delegate already on it.
- The key is stored unencrypted in `~/.budgie/agent.json`. If it leaks, the most it can lose is the allowance left. Revoke it from your wallet.
- "A failed call costs nothing" is the server's promise. The allowance is what the chain enforces.

## Proof

`proof/delegate-payment.mjs` sets a delegate, pays an x402 quote through the PayAI facilitator with the agent key alone, then tries to go past the allowance. Example run on mainnet: [transaction](https://solscan.io/tx/58ahMJhYo7GuM5nHkboT8z1fbodQJjdWFRHFDtW1hpWfsgbaPdEUmvQPHDg2uA46zpwho7ZvqsCf2wyyMEJoFSoe).
