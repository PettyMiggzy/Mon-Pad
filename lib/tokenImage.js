// Generic token image resolver.
// Resolution chain:
//   1. on-chain tokenURI() -> JSON -> image field
//   2. server meta endpoint (pad-launched tokens)
//   3. Monad token-list (cached in localStorage, 24h TTL, weekly key bump)
//   4. Monshi-scoped hardcoded asset
//   5. null (caller falls back to initials gradient)
//
// Returns a Promise<string|null>.

import { createPublicClient, http } from 'viem'
import { monad } from './wagmi'
import { MONSHI_TOKEN } from './constants'

const TOKENURI_ABI = [{
  name: 'tokenURI',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'string' }],
}]

const IMAGE_FIELDS = ['image', 'image_uri', 'imageUrl', 'logo', 'logoURI', 'logo_uri']

const TOKENLIST_PRIMARY = 'https://unpkg.com/@monad-crypto/token-list@latest/dist/cjs/mainnet.js'
const TOKENLIST_FALLBACK = 'https://raw.githubusercontent.com/monad-crypto/token-list/main/npm/dist/cjs/mainnet.js'

const FETCH_TIMEOUT_MS = 5000

// Weekly cache key bump: forces a hard refresh once per ISO week even within the 24h TTL.
function weekKey() {
  const d = new Date()
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d - start) / 86400000) + start.getUTCDay() + 1) / 7)
  return d.getUTCFullYear() + 'w' + week
}
const CACHE_KEY = 'monad-tokenlist-v1-' + weekKey()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const NEG_CACHE_TTL_MS = 60 * 60 * 1000

function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    const ttl = obj.tokens && obj.tokens.length ? CACHE_TTL_MS : NEG_CACHE_TTL_MS
    if (Date.now() - obj.fetchedAt > ttl) return null
    return obj
  } catch { return null }
}
function writeCache(tokens) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), tokens })) } catch {}
}

// fetch with timeout via AbortController.
async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

// unpkg may serve as application/javascript with a `module.exports = {...}` wrapper.
// raw.githubusercontent serves plain text. Try strict JSON first, then strip a CommonJS wrapper.
function parseTokenListBody(text) {
  try { return JSON.parse(text) } catch {}
  const stripped = text
    .replace(/^[\s\S]*?module\.exports\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .trim()
  try { return JSON.parse(stripped) } catch {}
  return null
}

async function fetchTokenList() {
  const cached = readCache()
  if (cached) return cached.tokens
  for (const url of [TOKENLIST_PRIMARY, TOKENLIST_FALLBACK]) {
    try {
      const r = await fetchWithTimeout(url, { cache: 'no-store' })
      if (!r.ok) continue
      const text = await r.text()
      const parsed = parseTokenListBody(text)
      const tokens = parsed && Array.isArray(parsed.tokens) ? parsed.tokens : null
      if (tokens) {
        writeCache(tokens)
        return tokens
      }
    } catch {}
  }
  // Negative cache: empty array, short TTL.
  writeCache([])
  return []
}

function pickImageField(obj) {
  if (!obj || typeof obj !== 'object') return null
  for (const k of IMAGE_FIELDS) {
    const v = obj[k]
    if (typeof v === 'string' && v.length) return v
  }
  return null
}

// Normalize ipfs:// URIs to a public gateway so <img src> can load them.
function normalizeUri(uri) {
  if (typeof uri !== 'string') return uri
  return uri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/')
}

let _client = null
function getClient() {
  if (!_client) _client = createPublicClient({ chain: monad, transport: http() })
  return _client
}

async function probeTokenURI(tokenAddress) {
  try {
    const client = getClient()
    const uri = await client.readContract({
      address: tokenAddress,
      abi: TOKENURI_ABI,
      functionName: 'tokenURI',
    })
    if (typeof uri !== 'string' || !uri) return null
    const r = await fetchWithTimeout(normalizeUri(uri))
    if (!r.ok) return null
    const json = await r.json()
    return normalizeUri(pickImageField(json))
  } catch { return null }
}

async function fetchPadMeta(serverUrl, tokenAddress) {
  if (!serverUrl) return null
  try {
    const r = await fetchWithTimeout(serverUrl + '/api/token/' + tokenAddress + '/meta')
    if (!r.ok) return null
    const m = await r.json()
    return normalizeUri(pickImageField(m))
  } catch { return null }
}

async function fetchFromTokenList(tokenAddress) {
  const tokens = await fetchTokenList()
  const lc = tokenAddress.toLowerCase()
  const hit = tokens.find(t => typeof t.address === 'string' && t.address.toLowerCase() === lc)
  return hit ? normalizeUri(pickImageField(hit)) : null
}

export async function resolveTokenImage(tokenAddress, opts = {}) {
  if (!tokenAddress) return null
  const serverUrl = opts.serverUrl || ''

  const onChain = await probeTokenURI(tokenAddress)
  if (onChain) return onChain

  const padMeta = await fetchPadMeta(serverUrl, tokenAddress)
  if (padMeta) return padMeta

  const fromList = await fetchFromTokenList(tokenAddress)
  if (fromList) return fromList

  if (tokenAddress.toLowerCase() === MONSHI_TOKEN.toLowerCase()) return '/monshi-pfp.png'

  return null
}
