# Publishing `ansem` to npm (handoff)

State: code complete, verified live against the ansem-1 testnet on 2026-08-20
(all tabs, both validators, real bridge activity). The npm package name `ansem`
was still unclaimed on 2026-08-20 - first publish wins, so do this soon.

## Steps

```
npm login                # any account with publish rights you want to own it
cd cli/
npm publish              # unscoped public package, no build step needed
```

Then anyone can run:

```
npx ansem
```

## What this is

- Zero runtime dependencies, Node >= 18 (uses built-in fetch). Nothing to
  build or bundle; `bin/ansem.js` + `src/*.js` ship as-is (see `files` in
  package.json).
- Defaults connect to the live testnet: val1 195.72.61.234 (RPC 26657,
  REST 1317). Both ports are publicly reachable. val2 is IPv6-only
  ([2a07:e043:1:19d::1]:26657), documented in README for `--rpc` lists.
- Chain restarts / re-genesis need NO republish: endpoints are IP-pinned and
  all denoms/tickers are read live from chain params.
- Only if validator IPs change: edit DEFAULT_RPC / DEFAULT_REST at the top of
  `bin/ansem.js`, bump `version` in package.json, `npm publish` again.

## Sanity checks before publishing

```
node bin/ansem.js status       # should print ansem-1, height, supply, bridged
node bin/ansem.js              # full TUI: arrows switch tabs, q quits
npm pack --dry-run             # should list 8 files, ~12 kB tarball
```

`ansem status --json` exists for scripts/monitoring (exit 1 when unreachable).
