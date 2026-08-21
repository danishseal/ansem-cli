// Fetch helpers for CometBFT RPC (26657) and Cosmos REST (1317).
// Every call returns { ok, ms, data | error } and never throws.

export const EXPECTED_CHAIN_ID = 'ansem-1'

export async function jget(url, timeoutMs = 2500) {
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` }
    return { ok: true, ms, data: await res.json() }
  } catch (e) {
    const ms = Date.now() - t0
    const error =
      e.name === 'AbortError'
        ? `timeout after ${timeoutMs}ms`
        : e.cause?.code || e.cause?.message || e.message
    return { ok: false, ms, error }
  } finally {
    clearTimeout(timer)
  }
}

// CometBFT RPC wraps payloads in { jsonrpc, id, result }.
async function rpc(base, path) {
  const r = await jget(base.replace(/\/$/, '') + path)
  if (r.ok) r.data = r.data.result ?? r.data
  return r
}

export const fetchStatus = (b) => rpc(b, '/status')
export const fetchAbciInfo = (b) => rpc(b, '/abci_info')
export const fetchNetInfo = (b) => rpc(b, '/net_info')
export const fetchValidators = (b) => rpc(b, '/validators?per_page=100')
export const fetchBlockchain = (b, min, max) =>
  rpc(b, `/blockchain?minHeight=${min}&maxHeight=${max}`)

const rest = (base, path) => jget(base.replace(/\/$/, '') + path)

export const fetchSupply = (b) =>
  rest(b, '/cosmos/bank/v1beta1/supply?pagination.limit=200')
export const fetchStakingParams = (b) => rest(b, '/cosmos/staking/v1beta1/params')
export const fetchStakingPool = (b) => rest(b, '/cosmos/staking/v1beta1/pool')
export const fetchDenomsMetadata = (b) =>
  rest(b, '/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=200')
export const fetchNodeInfo = (b) =>
  rest(b, '/cosmos/base/tendermint/v1beta1/node_info')
export const fetchDenomOwners = (b, denom) =>
  rest(b, `/cosmos/bank/v1beta1/denom_owners/${encodeURIComponent(denom)}?pagination.limit=200`)

// x/bridge module (grpc-gateway routes under /bridge/v1)
export const fetchBridgeParams = (b) => rest(b, '/bridge/v1/params')
export const fetchBridgeMintedSupply = (b) => rest(b, '/bridge/v1/bridge_minted_supply')
export const fetchMintRecords = (b) =>
  rest(b, '/bridge/v1/mint_records?pagination.limit=100&pagination.reverse=true')
export const fetchBurnRecords = (b) =>
  rest(b, '/bridge/v1/burn_records?pagination.limit=100&pagination.reverse=true')

// Recent txs via CometBFT tx_search (works without proto decoding: we read events).
export const fetchTxSearch = (b, perPage = 25) =>
  rpc(b, `/tx_search?query=${encodeURIComponent('"tx.height>=1"')}&per_page=${perPage}&order_by=${encodeURIComponent('"desc"')}`)

// Pull message action + first transfer out of tx_result.events.
export function summarizeTx(tx) {
  const events = tx.tx_result?.events || []
  const actions = []
  let transfer = null
  for (const ev of events) {
    const attrs = Object.fromEntries((ev.attributes || []).map((a) => [a.key, a.value]))
    if (ev.type === 'message' && attrs.action) actions.push(attrs.action)
    if (!transfer && ev.type === 'transfer' && attrs.amount)
      transfer = { amount: attrs.amount, recipient: attrs.recipient, sender: attrs.sender }
  }
  return {
    hash: tx.hash,
    height: tx.height,
    ok: Number(tx.tx_result?.code || 0) === 0,
    gasUsed: tx.tx_result?.gas_used,
    actions: [...new Set(actions.map((a) => a.split('.').pop().replace(/^Msg/, '')))],
    transfer,
  }
}

export function shortAddr(a, n = 8) {
  if (!a) return '?'
  return a.length > n * 2 + 4 ? a.slice(0, n + 6) + '…' + a.slice(-4) : a
}

// ---- formatting helpers ----

export function timeAgo(iso) {
  if (!iso) return '?'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(s)) return '?'
  if (s < 0) return 'now'
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtNum(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return String(n)
  return x.toLocaleString('en-US')
}

// Scale a base-denom integer amount by `exp` decimals, keep it readable.
export function fmtAmount(amount, exp = 6) {
  const x = Number(amount) / 10 ** exp
  if (!Number.isFinite(x)) return String(amount)
  if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B'
  if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M'
  if (x >= 1e3) return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return x.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export const shortHash = (h, n = 10) =>
  h && h.length > n * 2 ? h.slice(0, n) + '…' + h.slice(-4) : h || '?'
