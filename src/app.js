// The arrow-key TUI. No commands: left/right switch tabs, up/down scroll.

import readline from 'node:readline'
import {
  cursor, screen, bold, dim, inv, green, softGreen, red, yellow, gray, cyan,
  padVis, truncVis, visLen,
} from './ansi.js'
import { renderBanner, subtitle, BANNER_ROWS } from './banner.js'
import {
  fetchStatus, fetchAbciInfo, fetchNetInfo, fetchValidators, fetchBlockchain,
  fetchSupply, fetchStakingParams, fetchStakingPool, fetchDenomsMetadata,
  fetchDenomOwners, fetchBridgeParams, fetchBridgeMintedSupply, fetchMintRecords, fetchBurnRecords,
  fetchTxSearch, summarizeTx, shortAddr,
  timeAgo, fmtNum, fmtAmount, shortHash,
} from './rpc.js'

const TABS = ['Overview', 'Validators', 'Blocks', 'Txs', 'Holders', 'Bridge', 'Supply']
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function runTui(cfg) {
  const state = {
    tab: 0,
    scroll: TABS.map(() => 0),
    frame: 0,
    fetching: false,
    lastUpdate: null,
    status: null,
    statusErr: null,
    statusMs: 0,
    abci: null,
    validators: null,
    pings: [],
    blocks: [],
    blocksErr: null,
    net: null,
    netErr: null,
    supply: null,
    supplyErr: null,
    bondDenom: null,
    pool: null,
    meta: new Map(),
    txs: null,
    txsErr: null,
    owners: new Map(),
    ownersErr: null,
    bridgeSupply: null,
    bridgeParams: null,
    mints: null,
    burns: null,
    bridgeErr: null,
  }

  const out = process.stdout

  function cleanup() {
    clearInterval(animTimer)
    clearInterval(dataTimer)
    out.write(cursor.show + screen.main)
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
  }

  function quit(code = 0) {
    cleanup()
    process.exit(code)
  }

  // ---- data ----

  async function refresh() {
    // If a refresh is already in flight (auto-timer), queue one more so a tab
    // switch during it still loads the new tab's data immediately after.
    if (state.fetching) {
      state.refetch = true
      return
    }
    state.fetching = true
    try {
      const primary = cfg.rpcs[0]
      const st = await fetchStatus(primary)
      state.statusMs = st.ms
      if (st.ok) {
        state.status = st.data
        state.statusErr = null
      } else {
        state.status = null
        state.statusErr = st.error
      }

      const tab = TABS[state.tab]
      if (tab === 'Overview') {
        const [abci, vals, net] = await Promise.all([
          fetchAbciInfo(primary),
          fetchValidators(primary),
          fetchNetInfo(primary),
        ])
        if (abci.ok) state.abci = abci.data
        if (vals.ok) state.validators = vals.data
        if (net.ok) state.net = net.data
      } else if (tab === 'Validators') {
        const [vals, ...pings] = await Promise.all([
          fetchValidators(primary),
          ...cfg.rpcs.map(async (url) => {
            const r = await fetchStatus(url)
            return {
              url,
              ok: r.ok,
              ms: r.ms,
              error: r.error,
              height: r.ok ? r.data?.sync_info?.latest_block_height : null,
              chainId: r.ok ? r.data?.node_info?.network : null,
              catchingUp: r.ok ? r.data?.sync_info?.catching_up : null,
            }
          }),
        ])
        if (vals.ok) state.validators = vals.data
        state.pings = pings
      } else if (tab === 'Blocks') {
        const h = Number(state.status?.sync_info?.latest_block_height || 0)
        if (h > 0) {
          const r = await fetchBlockchain(primary, Math.max(1, h - 19), h)
          if (r.ok) {
            state.blocks = r.data?.block_metas || []
            state.blocksErr = null
          } else state.blocksErr = r.error
        }
      } else if (tab === 'Supply') {
        await refreshBank()
      } else if (tab === 'Txs') {
        const r = await fetchTxSearch(primary, 30)
        if (r.ok) {
          state.txs = (r.data?.txs || []).map(summarizeTx)
          state.txsErr = null
        } else state.txsErr = r.error
      } else if (tab === 'Holders') {
        await refreshBank()
        if (state.supply) {
          // Holders per denom, native first, capped to keep the tab quick.
          const denoms = [...state.supply.map((c) => c.denom)]
            .sort((a, b) => (a === state.bondDenom ? -1 : b === state.bondDenom ? 1 : a.localeCompare(b)))
            .slice(0, 3)
          const results = await Promise.all(denoms.map((d) => fetchDenomOwners(cfg.rest, d)))
          state.ownersErr = null
          results.forEach((r, i) => {
            if (r.ok) state.owners.set(denoms[i], r.data?.denom_owners || [])
            else state.ownersErr = r.error
          })
        }
      } else if (tab === 'Bridge') {
        await refreshBank()
        const [ms, mints, burns, bp] = await Promise.all([
          fetchBridgeMintedSupply(cfg.rest),
          fetchMintRecords(cfg.rest),
          fetchBurnRecords(cfg.rest),
          fetchBridgeParams(cfg.rest),
        ])
        if (ms.ok) state.bridgeSupply = ms.data?.amount ?? null
        if (bp.ok) state.bridgeParams = bp.data?.params || null
        if (mints.ok) state.mints = mints.data?.records || []
        if (burns.ok) state.burns = burns.data?.records || []
        state.bridgeErr = !ms.ok && !mints.ok ? ms.error : null
      }
      state.lastUpdate = Date.now()
    } finally {
      state.fetching = false
    }
    render()
    if (state.refetch) {
      state.refetch = false
      refresh()
    }
  }

  async function refreshBank() {
    const [sup, sp, pool, meta] = await Promise.all([
      fetchSupply(cfg.rest),
      fetchStakingParams(cfg.rest),
      fetchStakingPool(cfg.rest),
      fetchDenomsMetadata(cfg.rest),
    ])
    if (sup.ok) {
      state.supply = sup.data?.supply || []
      state.supplyErr = null
    } else state.supplyErr = sup.error
    if (sp.ok) state.bondDenom = sp.data?.params?.bond_denom || null
    if (pool.ok) state.pool = pool.data?.pool || null
    if (meta.ok) {
      for (const m of meta.data?.metadatas || []) state.meta.set(m.base, m)
    }
  }

  // ---- views ----

  const kv = (label, value) => `  ${gray(padVis(label, 12))}${value}`

  function offlineLines() {
    return [
      '',
      '  ' + red('●') + ' ' + bold(red('cannot reach the chain')),
      '',
      kv('RPC', cfg.rpcs[0] + '  ' + red(state.statusErr || 'unreachable')),
      '',
      '  ' + gray('Retrying automatically. The chain may be restarting;'),
      '  ' + gray('for a local node use:  ansem --rpc http://127.0.0.1:26657 --rest http://127.0.0.1:1317'),
    ]
  }

  function chainIdLine() {
    const id = state.status?.node_info?.network
    if (!id) return red('unknown')
    if (id !== cfg.expectedChainId)
      return yellow(`${id}  ⚠ expected ${cfg.expectedChainId} — is this another chain on the same port?`)
    return green(id)
  }

  function viewOverview() {
    if (!state.status) return offlineLines()
    const s = state.status
    const sync = s.sync_info || {}
    const abci = state.abci?.response || {}
    const lines = ['']
    lines.push(kv('RPC', `${cfg.rpcs[0]}  ${green('●')} ${gray(state.statusMs + 'ms')}`))
    lines.push(kv('Chain', chainIdLine()))
    lines.push(kv('Moniker', s.node_info?.moniker || '?'))
    lines.push('')
    lines.push(
      kv(
        'Height',
        bold(green('#' + fmtNum(sync.latest_block_height))) +
          '   ' + gray(timeAgo(sync.latest_block_time)) +
          (sync.catching_up ? '   ' + yellow('⟳ catching up') : '   ' + softGreen('✓ in sync'))
      )
    )
    lines.push(kv('App', `${abci.data || 'ansemd'} ${abci.version || ''}`.trim()))
    lines.push(kv('CometBFT', s.node_info?.version || '?'))
    lines.push('')
    if (state.validators)
      lines.push(kv('Validators', `${state.validators.total ?? state.validators.count ?? '?'} active`))
    if (state.net) lines.push(kv('Peers', String(state.net.n_peers ?? '?')))
    if (s.validator_info?.voting_power && Number(s.validator_info.voting_power) > 0)
      lines.push(kv('This node', `validator, power ${fmtNum(s.validator_info.voting_power)}`))
    return lines
  }

  function viewValidators(width) {
    const lines = ['']
    lines.push('  ' + bold('Endpoints'))
    if (!state.pings.length) lines.push('  ' + gray('pinging…'))
    for (const p of state.pings) {
      const dot = p.ok ? green('●') : red('●')
      const lat = p.ok
        ? (p.ms < 100 ? green(p.ms + 'ms') : p.ms < 500 ? yellow(p.ms + 'ms') : red(p.ms + 'ms'))
        : red(p.error || 'down')
      const h = p.ok ? gray('#' + fmtNum(p.height)) : ''
      const warn = p.ok && p.chainId !== cfg.expectedChainId ? yellow(` ⚠ ${p.chainId}`) : ''
      lines.push(`  ${dot} ${padVis(p.url, Math.min(44, width - 30))} ${padVis(lat, 14)} ${h}${warn}`)
    }
    lines.push('')
    lines.push('  ' + bold('Validator set'))
    const vals = state.validators?.validators
    if (!vals) {
      lines.push('  ' + (state.status ? gray('loading…') : red('chain unreachable')))
      return lines
    }
    const totalPower = vals.reduce((a, v) => a + Number(v.voting_power), 0) || 1
    lines.push(gray(`  ${padVis('#', 4)}${padVis('address', 24)}${padVis('power', 16)}share`))
    vals.forEach((v, i) => {
      const share = Number(v.voting_power) / totalPower
      const barW = 16
      const bar = green('█'.repeat(Math.max(1, Math.round(share * barW)))) +
        gray('░'.repeat(barW - Math.max(1, Math.round(share * barW))))
      lines.push(
        `  ${padVis(String(i + 1), 4)}${padVis(shortHash(v.address, 8), 24)}` +
          `${padVis(fmtNum(v.voting_power), 16)}${bar} ${gray((share * 100).toFixed(1) + '%')}`
      )
    })
    return lines
  }

  function viewBlocks() {
    if (!state.status) return offlineLines()
    const lines = ['']
    lines.push(gray(`  ${padVis('height', 12)}${padVis('age', 14)}${padVis('txs', 6)}${padVis('proposer', 20)}hash`))
    if (state.blocksErr) lines.push('  ' + red(state.blocksErr))
    const metas = [...state.blocks].sort((a, b) => Number(b.header.height) - Number(a.header.height))
    for (const m of metas) {
      const txs = Number(m.num_txs || 0)
      lines.push(
        `  ${padVis(green('#' + m.header.height), 12)}` +
          `${padVis(timeAgo(m.header.time), 14)}` +
          `${padVis(txs > 0 ? bold(String(txs)) : gray('0'), 6)}` +
          `${padVis(shortHash(m.header.proposer_address, 6), 20)}` +
          gray(shortHash(m.block_id?.hash, 8))
      )
    }
    if (!metas.length && !state.blocksErr) lines.push('  ' + gray('loading…'))
    return lines
  }

  function displayFor(denom) {
    const m = state.meta.get(denom)
    if (m) {
      const disp = m.denom_units?.find((u) => u.denom === m.display)
      return { ticker: (m.symbol || m.display || denom).toUpperCase(), exp: disp?.exponent ?? 6 }
    }
    // Cosmos convention fallback: u-prefixed base denom, 6 decimals.
    if (/^u[a-z]+$/.test(denom)) return { ticker: denom.slice(1).toUpperCase(), exp: 6 }
    return { ticker: denom, exp: 0 }
  }

  function viewSupply() {
    const lines = ['']
    if (state.supplyErr)
      return [...lines, '  ' + red(`REST ${cfg.rest}: ${state.supplyErr}`),
        '  ' + gray('the REST API (1317) must be enabled on the node')]
    if (!state.supply) return [...lines, '  ' + gray('loading…')]
    lines.push(gray(`  ${padVis('token', 12)}${padVis('supply', 18)}denom`))
    for (const c of state.supply) {
      const { ticker, exp } = displayFor(c.denom)
      const isGas = c.denom === state.bondDenom
      lines.push(
        `  ${padVis(bold(green(ticker)), 12)}` +
          `${padVis(fmtAmount(c.amount, exp), 18)}` +
          gray(c.denom) + (isGas ? softGreen('  ← native / gas / staking') : '')
      )
    }
    if (state.pool && state.bondDenom) {
      const total = state.supply.find((c) => c.denom === state.bondDenom)
      const { exp } = displayFor(state.bondDenom)
      const bonded = Number(state.pool.bonded_tokens)
      lines.push('')
      lines.push(kv('Bonded', `${fmtAmount(bonded, exp)} (${total ? ((bonded / Number(total.amount)) * 100).toFixed(2) : '?'}% of supply staked)`))
    }
    return lines
  }

  // "12345uchanse" (first coin of a possibly multi-coin string) -> "0.012 CHANSE"
  function fmtCoinStr(s) {
    const first = String(s).split(',')[0]
    const m = /^(\d+)(.*)$/.exec(first.trim())
    if (!m) return s
    const { ticker, exp } = displayFor(m[2])
    return fmtAmount(m[1], exp) + ' ' + ticker + (s.includes(',') ? gray(' +') : '')
  }

  function viewTxs() {
    if (!state.status) return offlineLines()
    const lines = ['']
    if (state.txsErr) return [...lines, '  ' + red(state.txsErr)]
    if (!state.txs) return [...lines, '  ' + gray('loading…')]
    if (!state.txs.length) return [...lines, '  ' + gray('no transactions on chain yet')]
    lines.push(gray(`  ${padVis('height', 10)}${padVis(' ', 2)}${padVis('action', 20)}${padVis('amount', 20)}${padVis('hash', 20)}gas`))
    for (const t of state.txs) {
      const act = t.actions.length
        ? bold(t.actions[0]) + (t.actions.length > 1 ? gray(' +' + (t.actions.length - 1)) : '')
        : gray('?')
      lines.push(
        `  ${padVis(green('#' + fmtNum(t.height)), 10)}` +
          `${padVis(t.ok ? green('✓') : red('✗'), 2)}` +
          `${padVis(act, 20)}` +
          `${padVis(t.transfer ? fmtCoinStr(t.transfer.amount) : gray('—'), 20)}` +
          `${padVis(gray(shortHash(t.hash, 8)), 20)}` +
          gray(fmtNum(t.gasUsed || 0))
      )
    }
    return lines
  }

  function viewHolders(width) {
    const lines = ['']
    if (state.supplyErr)
      return [...lines, '  ' + red(`REST ${cfg.rest}: ${state.supplyErr}`)]
    if (!state.supply) return [...lines, '  ' + gray('loading…')]
    if (state.ownersErr)
      lines.push('  ' + yellow(`denom_owners: ${state.ownersErr}`), '')
    if (!state.owners.size) return [...lines, '  ' + gray('loading holders…')]
    for (const [denom, owners] of state.owners) {
      const { ticker, exp } = displayFor(denom)
      const total = Number(state.supply.find((c) => c.denom === denom)?.amount || 0) || 1
      const native = denom === state.bondDenom
      lines.push(
        '  ' + bold(green(ticker)) +
          gray(`  ${denom} · ${owners.length} holder${owners.length === 1 ? '' : 's'}`) +
          (native ? softGreen(' · native') : gray(' · bridged'))
      )
      lines.push(gray(`  ${padVis('#', 4)}${padVis('address', 26)}${padVis('balance', 16)}share`))
      const top = [...owners]
        .sort((a, b) => Number(b.balance?.amount) - Number(a.balance?.amount))
        .slice(0, 12)
      top.forEach((o, i) => {
        const amt = Number(o.balance?.amount || 0)
        const share = amt / total
        const barW = 14
        const on = Math.max(share > 0 ? 1 : 0, Math.round(share * barW))
        lines.push(
          `  ${padVis(String(i + 1), 4)}${padVis(shortAddr(o.address), 26)}` +
            `${padVis(fmtAmount(amt, exp), 16)}` +
            green('█'.repeat(on)) + gray('░'.repeat(barW - on)) +
            ` ${gray((share * 100).toFixed(1) + '%')}`
        )
      })
      lines.push('')
    }
    return lines
  }

  function priorityTicker() {
    // assets[0] is the priority asset by convention (empty denom on records means this).
    const pa = state.bridgeParams?.assets?.[0]
    if (pa?.denom) return displayFor(pa.denom)
    const voucher = (state.supply || []).find((c) => c.denom !== state.bondDenom)
    return voucher ? displayFor(voucher.denom) : { ticker: 'ANSEM', exp: 6 }
  }

  function viewBridge() {
    const lines = ['']
    const bp = state.bridgeParams
    if (bp) {
      lines.push(kv('Bridge', bp.bridge_enabled ? green('● enabled') : red('● disabled')))
      if (bp.assets?.length) {
        lines.push('')
        lines.push('  ' + bold('Assets'))
        bp.assets.forEach((a, i) => {
          const { ticker, exp } = displayFor(a.denom)
          lines.push(
            `  ${padVis(bold(green(ticker)) + (i === 0 ? softGreen(' ★') : ''), 12)}` +
              `${padVis(gray(a.denom), 10)} ${gray('↔')} ${padVis(shortAddr(a.solana_mint, 6), 18)}` +
              gray(` max mint ${fmtAmount(a.max_mint_per_tx, exp)} · max burn ${fmtAmount(a.max_burn_per_tx, exp)}/tx`)
          )
        })
      }
      lines.push('')
    }
    lines.push('  ' + bold('Total bridged'))
    const vouchers = (state.supply || []).filter((c) => c.denom !== state.bondDenom)
    if (state.bridgeSupply != null) {
      const { ticker, exp } = priorityTicker()
      lines.push(kv('Module', `${bold(green(fmtAmount(state.bridgeSupply, exp) + ' ' + ticker))} ${gray('bridge-minted (x/bridge)')}`))
    }
    for (const c of vouchers) {
      const { ticker, exp } = displayFor(c.denom)
      lines.push(kv(ticker, `${fmtAmount(c.amount, exp)} ${gray(`voucher supply (${c.denom}) = locked on Solana`)}`))
    }
    if (state.bridgeSupply == null && !vouchers.length)
      lines.push('  ' + (state.bridgeErr
        ? yellow(`bridge module not queryable (${state.bridgeErr})`)
        : gray('loading…')))
    lines.push('')
    lines.push('  ' + bold('Recent bridge activity'))
    const acts = [
      ...(state.mints || []).map((r) => ({ ...r, dir: 'in', who: r.recipient })),
      ...(state.burns || []).map((r) => ({ ...r, dir: 'out', who: r.account })),
    ].sort((a, b) => Number(b.timestamp) - Number(a.timestamp)).slice(0, 14)
    if (!acts.length) {
      lines.push('  ' + (state.mints || state.burns
        ? gray('no bridge transfers yet')
        : gray('loading…')))
      return lines
    }
    for (const a of acts) {
      const { ticker, exp } = a.denom ? displayFor(a.denom) : priorityTicker()
      const dir = a.dir === 'in' ? green('↓ IN ') : yellow('↑ OUT')
      lines.push(
        `  ${dir} ${padVis(bold(fmtAmount(a.amount, exp) + ' ' + ticker), 20)}` +
          `${padVis((a.dir === 'in' ? '→ ' : '← ') + shortAddr(a.who), 26)}` +
          `${padVis(timeAgo(new Date(Number(a.timestamp) * 1000).toISOString()), 12)}` +
          gray('lock ' + shortHash(a.streamflow_lock_id, 6))
      )
    }
    return lines
  }

  // ---- rendering ----

  function render() {
    const width = out.columns || Number(process.env.ANSEM_COLS) || 80
    const height = out.rows || Number(process.env.ANSEM_ROWS) || 24
    const lines = []

    lines.push(...renderBanner(state.frame, width))
    const id = state.status?.node_info?.network
    lines.push(subtitle(id ? `· chain explorer · ${id} ·` : '· chain explorer · offline ·', width))
    lines.push('')

    // tab bar
    let bar = '  '
    TABS.forEach((t, i) => {
      bar += i === state.tab ? inv(bold(green(` ${t} `))) : gray(` ${t} `)
      bar += ' '
    })
    lines.push(bar)
    lines.push(gray('  ' + '─'.repeat(Math.max(0, width - 4))))

    const views = [viewOverview, () => viewValidators(width), viewBlocks, viewTxs,
      () => viewHolders(width), viewBridge, viewSupply]
    const content = views[state.tab]()
    const bodyH = Math.max(3, height - lines.length - 1)
    const maxScroll = Math.max(0, content.length - bodyH)
    state.scroll[state.tab] = Math.min(state.scroll[state.tab], maxScroll)
    const off = state.scroll[state.tab]
    for (let i = 0; i < bodyH; i++) lines.push(content[off + i] ?? '')
    if (maxScroll > 0)
      lines[lines.length - 1] = gray(`  ↓ ${maxScroll - off} more line(s)`)

    const spin = state.fetching ? cyan(SPIN[state.frame % SPIN.length]) + ' ' : ''
    const upd = state.lastUpdate ? `updated ${timeAgo(new Date(state.lastUpdate).toISOString())}` : 'connecting…'
    const hints = '←/→ tabs   ↑/↓ scroll   r refresh   q quit'
    const foot = `  ${spin}${gray(upd)}`
    const pad = Math.max(1, width - visLen(foot) - visLen(hints) - 2)
    lines.push(foot + ' '.repeat(pad) + gray(hints))

    const frame = lines
      .slice(0, height)
      .map((l) => truncVis(l, width) + screen.clearLine)
      .join('\r\n')
    out.write(cursor.home + frame + screen.clearBelow)
  }

  // ---- input ----

  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key) => {
    if (!key) return
    if (key.name === 'q' || (key.ctrl && key.name === 'c') || key.name === 'escape') return quit()
    if (key.name === 'left') {
      state.tab = (state.tab + TABS.length - 1) % TABS.length
      render()
      refresh()
    } else if (key.name === 'right' || key.name === 'tab') {
      state.tab = (state.tab + 1) % TABS.length
      render()
      refresh()
    } else if (key.name === 'up') {
      state.scroll[state.tab] = Math.max(0, state.scroll[state.tab] - 1)
      render()
    } else if (key.name === 'down') {
      state.scroll[state.tab] += 1
      render()
    } else if (key.name === 'r') {
      refresh()
    } else if (/^[1-7]$/.test(str || '')) {
      state.tab = Number(str) - 1
      render()
      refresh()
    }
  })

  process.on('SIGINT', () => quit())
  process.on('SIGTERM', () => quit())
  out.on('resize', render)

  out.write(screen.alt + cursor.hide)
  const animTimer = setInterval(() => {
    state.frame++
    render()
  }, 100)
  const dataTimer = setInterval(refresh, 2500)
  render()
  refresh()
}
