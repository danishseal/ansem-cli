#!/usr/bin/env node
// npx ansem — ANSEMCHAIN terminal explorer.
// No args: full-screen arrow-key TUI. `ansem status [--json]`: one-shot for scripts.

import { runTui } from '../src/app.js'
import {
  fetchStatus, fetchValidators, fetchNetInfo, fetchSupply, fetchStakingParams,
  fetchBridgeMintedSupply, timeAgo, fmtNum, fmtAmount, EXPECTED_CHAIN_ID,
} from '../src/rpc.js'
import { bold, green, red, yellow, gray } from '../src/ansi.js'

const argv = process.argv.slice(2)

function flag(name) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i === -1) return undefined
  const a = argv[i]
  if (a.includes('=')) return a.split('=').slice(1).join('=')
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true
}

// Public ANSEM testnet validator (val1). Endpoints are IP-pinned, so they keep
// working across chain restarts / re-genesis. Use --rpc/--rest for a localnet.
const DEFAULT_RPC = 'http://195.72.61.234:26657'
const DEFAULT_REST = 'http://195.72.61.234:1317'

const cfg = {
  // Comma-separated list; first entry is the primary node.
  rpcs: String(flag('rpc') || process.env.ANSEM_RPC || DEFAULT_RPC)
    .split(',').map((s) => s.trim()).filter(Boolean),
  rest: String(flag('rest') || process.env.ANSEM_REST || DEFAULT_REST),
  expectedChainId: String(flag('chain-id') || process.env.ANSEM_CHAIN_ID || EXPECTED_CHAIN_ID),
}

const HELP = `${bold('ansem')} — ANSEMCHAIN terminal explorer

  ${bold('npx ansem')}              launch the explorer (arrow keys, no commands)
  ${bold('npx ansem status')}       one-shot chain summary
  ${bold('npx ansem status --json')} machine-readable summary

  --rpc <url[,url…]>     CometBFT RPC endpoint(s)   (default: ANSEM testnet val1, env ANSEM_RPC)
  --rest <url>           Cosmos REST endpoint       (default: ANSEM testnet val1, env ANSEM_REST)
  --chain-id <id>        expected chain id          (default ${EXPECTED_CHAIN_ID})

  Inside the explorer: ←/→ switch tabs · ↑/↓ scroll · r refresh · q quit
`

async function oneShot(json) {
  const primary = cfg.rpcs[0]
  const [st, vals, net, sup, sp, br] = await Promise.all([
    fetchStatus(primary),
    fetchValidators(primary),
    fetchNetInfo(primary),
    fetchSupply(cfg.rest),
    fetchStakingParams(cfg.rest),
    fetchBridgeMintedSupply(cfg.rest),
  ])
  const pings = await Promise.all(
    cfg.rpcs.map(async (url) => {
      const r = url === primary ? st : await fetchStatus(url)
      return { url, ok: r.ok, ms: r.ms, error: r.error ?? null,
        height: r.ok ? Number(r.data?.sync_info?.latest_block_height) : null }
    })
  )

  if (json) {
    const bondDenom = sp.ok ? sp.data?.params?.bond_denom : null
    console.log(JSON.stringify({
      ok: st.ok,
      rpc: primary,
      latency_ms: st.ms,
      error: st.error ?? null,
      chain_id: st.ok ? st.data.node_info?.network : null,
      expected_chain_id: cfg.expectedChainId,
      height: st.ok ? Number(st.data.sync_info?.latest_block_height) : null,
      block_time: st.ok ? st.data.sync_info?.latest_block_time : null,
      catching_up: st.ok ? st.data.sync_info?.catching_up : null,
      validators: vals.ok ? Number(vals.data?.total ?? vals.data?.count) : null,
      peers: net.ok ? Number(net.data?.n_peers) : null,
      bond_denom: bondDenom,
      supply: sup.ok ? sup.data?.supply : null,
      bridge_minted: br.ok ? br.data?.amount ?? null : null,
      endpoints: pings,
    }, null, 2))
    process.exit(st.ok ? 0 : 1)
  }

  if (!st.ok) {
    console.log(`${red('●')} ${bold('ansemchain unreachable')} at ${primary} ${gray('(' + st.error + ')')}`)
    console.log(gray(`  the chain may be restarting; for a local node: ansem --rpc http://127.0.0.1:26657`))
    process.exit(1)
  }
  const s = st.data
  const id = s.node_info?.network
  const idStr = id === cfg.expectedChainId
    ? green(id)
    : yellow(`${id} (expected ${cfg.expectedChainId})`)
  console.log(`${green('●')} ${bold(idStr)}  ${gray(primary)}  ${gray(st.ms + 'ms')}`)
  console.log(`  height     ${bold('#' + fmtNum(s.sync_info?.latest_block_height))}  ${gray(timeAgo(s.sync_info?.latest_block_time))}${s.sync_info?.catching_up ? '  ' + yellow('catching up') : ''}`)
  if (vals.ok) console.log(`  validators ${vals.data?.total ?? vals.data?.count}`)
  if (net.ok) console.log(`  peers      ${net.data?.n_peers}`)
  if (sup.ok && sp.ok) {
    const bond = sp.data?.params?.bond_denom
    const c = (sup.data?.supply || []).find((x) => x.denom === bond)
    if (c) console.log(`  supply     ${fmtAmount(c.amount, 6)} ${bond?.replace(/^u/, '').toUpperCase()} ${gray('(' + bond + ')')}`)
    const vouchers = (sup.data?.supply || []).filter((x) => x.denom !== sp.data?.params?.bond_denom)
    for (const v of vouchers)
      console.log(`  bridged    ${fmtAmount(v.amount, 6)} ${v.denom.replace(/^u/, '').toUpperCase()} ${gray('(' + v.denom + ' vouchers)')}`)
  }
  if (br.ok && br.data?.amount != null)
    console.log(`  bridge     ${fmtAmount(br.data.amount, 6)} ${gray('minted by x/bridge')}`)
  for (const p of pings.slice(1)) {
    console.log(`  ${p.ok ? green('●') : red('●')} ${p.url}  ${p.ok ? gray(p.ms + 'ms · #' + fmtNum(p.height)) : red(p.error)}`)
  }
  process.exit(0)
}

const cmd = argv.find((a) => !a.startsWith('--') && a !== String(flag('rpc')) &&
  a !== String(flag('rest')) && a !== String(flag('chain-id')))

if (flag('help') || cmd === 'help') {
  console.log(HELP)
  process.exit(0)
} else if (cmd === 'status' || flag('json') ||
  (!process.env.ANSEM_FORCE_TUI && (!process.stdout.isTTY || !process.stdin.isTTY))) {
  oneShot(Boolean(flag('json')))
} else {
  runTui(cfg)
}
