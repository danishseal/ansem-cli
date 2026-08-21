# ansem

ANSEMCHAIN in your terminal.

```
npx ansem
```

Launches a full-screen explorer. No commands to memorize:

- **←/→** switch tabs (Overview · Validators · Blocks · Txs · Holders · Bridge · Supply)
- **↑/↓** scroll
- **r** refresh now (everything also auto-refreshes)
- **q** quit

For scripts and CI there is a one-shot mode:

```
npx ansem status          # human summary, exit 1 if the chain is unreachable
npx ansem status --json   # machine-readable
```

## Endpoints

| flag | env | default |
|---|---|---|
| `--rpc <url[,url…]>` | `ANSEM_RPC` | `http://195.72.61.234:26657` (testnet val1) |
| `--rest <url>` | `ANSEM_REST` | `http://195.72.61.234:1317` (testnet val1) |
| `--chain-id <id>` | `ANSEM_CHAIN_ID` | `ansem-1` |

Defaults point at the public ANSEM testnet, so `npx ansem` works out of the box
and keeps working across chain restarts/re-genesis (the endpoints are IP-pinned
and every denom is read live from the chain). val2 is IPv6-only:
`http://[2a07:e043:1:19d::1]:26657` if you want a second endpoint on `--rpc`.
For a localnet: `ansem --rpc http://127.0.0.1:26657 --rest http://127.0.0.1:1317`.

`--rpc` accepts a comma-separated list; every endpoint is pinged (latency +
height) on the Validators tab, the first one is used for chain data. The tool
verifies the reported chain id and warns if the endpoint serves a different
chain (memechain's localnet uses the same ports).

Nothing is hardcoded about denoms: the native/gas token is read from the
staking bond denom and bank denom metadata on the live chain.

- **Txs** comes from CometBFT `tx_search` (actions + transfer amounts parsed
  from events, no proto decoding needed).
- **Holders** is `bank/denom_owners` per denom (top holders + share bars).
- **Bridge** reads the x/bridge REST routes (`/bridge/v1/bridge_minted_supply`,
  `mint_records`, `burn_records`) and falls back to voucher-denom bank supply
  for "total bridged" if the module isn't queryable.

> If validator IPs ever change, update `DEFAULT_RPC`/`DEFAULT_REST` in
> `bin/ansem.js`, bump the version, and republish.

## Dev

Zero runtime dependencies, Node >= 18.

```
node bin/ansem.js                 # run from the repo
node bin/ansem.js --rpc http://127.0.0.1:26657
```
