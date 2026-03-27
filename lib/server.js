const express    = require('express')
const multer     = require('multer')
const cors       = require('cors')
const path       = require('path')
const fs         = require('fs')
const http       = require('http')
const { WebSocketServer } = require('ws')
const { createPublicClient, http: viemHttp, parseAbiItem } = require('viem')

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })
const PORT   = 3001

// ── Monad ─────────────────────────────────────────────────────
const MONAD_RPC   = 'https://attentive-magical-sanctuary.monad-mainnet.quiknode.pro/63002c717b0ee2930197c2d560150d561db9ed7f/'
const START_BLOCK = 59737219n
const monadChain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
}
const client = createPublicClient({ chain: monadChain, transport: viemHttp(MONAD_RPC) })

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: '*' }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ── ABIs ──────────────────────────────────────────────────────
const FACTORY_ADDRESS = '0xfEdC5df2F34Ec01Ac9cbc0c557a4BFD3de6C5c45'
const LAUNCHED_EVENT  = parseAbiItem('event Launched(address indexed token, address indexed curve, address indexed graduator, address creator)')
const TOKEN_ABI = [
  { name:'name',     type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
  { name:'symbol',   type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
]
const CURVE_ABI_SHORT = [
  { name:'graduated',        type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'bool'}] },
  { name:'monRaisedNet',     type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'capMon',           type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'bondedBps',        type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'priceWeiPerToken', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
]

// ── On-chain token index (in-memory cache) ───────────────────
let tokenIndex = []   // array of on-chain token data
let lastIndexedBlock = START_BLOCK

async function indexTokens() {
  try {
    const latest = await client.getBlockNumber()
    const CHUNK  = 900n
    const logs   = []
    for (let from = lastIndexedBlock; from <= latest; from += CHUNK) {
      const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
      try {
        const chunk = await client.getLogs({ address: FACTORY_ADDRESS, event: LAUNCHED_EVENT, fromBlock: from, toBlock: to })
        logs.push(...chunk)
      } catch {}
    }
    if (logs.length === 0) { lastIndexedBlock = latest; return }

    const newEntries = await Promise.all(logs.map(async log => {
      const { token, curve, creator } = log.args
      const addr = token.toLowerCase()
      // skip only if already indexed WITH marketCap
      const existing = tokenIndex.find(t => t.tokenAddress === addr)
      if (existing && existing.marketCap && existing.marketCap !== '0') return null
      // remove stale entry so we re-fetch
      if (existing) tokenIndex = tokenIndex.filter(t => t.tokenAddress !== addr)
      try {
        const [name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWeiPerToken] = await Promise.all([
          client.readContract({ address: token, abi: TOKEN_ABI,       functionName: 'name' }),
          client.readContract({ address: token, abi: TOKEN_ABI,       functionName: 'symbol' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'graduated' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'monRaisedNet' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'capMon' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'bondedBps' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' }),
        ])
        // MC = price * 1B supply (priceWeiPerToken is wei per 1 token, supply is 1B tokens)
        const SUPPLY = 1_000_000_000n
        const marketCap = priceWeiPerToken * SUPPLY
        return { tokenAddress: addr, curveAddress: curve.toLowerCase(), creator: creator.toLowerCase(), name, symbol, graduated, monRaisedNet: monRaisedNet.toString(), capMon: capMon.toString(), bondedBps: bondedBps.toString(), priceWeiPerToken: priceWeiPerToken.toString(), marketCap: marketCap.toString(), blockNumber: log.blockNumber.toString() }
      } catch { return null }
    }))

    const valid = newEntries.filter(Boolean)
    tokenIndex = [...tokenIndex, ...valid]
    lastIndexedBlock = latest
    console.log(`📦 Indexed ${valid.length} new tokens (total: ${tokenIndex.length})`)
  } catch (e) {
    console.error('indexTokens error:', e.message)
  }
}

// run on startup then every 30s
indexTokens()
setInterval(indexTokens, 30000)

// refresh prices on all indexed tokens every 30s
async function refreshPrices() {
  if (tokenIndex.length === 0) return
  try {
    await Promise.all(tokenIndex.map(async t => {
      try {
        const curve = t.curveAddress
        const [priceWeiPerToken, monRaisedNet, bondedBps, graduated] = await Promise.all([
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'monRaisedNet' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'bondedBps' }),
          client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'graduated' }),
        ])
        const marketCap = priceWeiPerToken * 1_000_000_000n
        t.priceWeiPerToken = priceWeiPerToken.toString()
        t.marketCap        = marketCap.toString()
        t.monRaisedNet     = monRaisedNet.toString()
        t.bondedBps        = bondedBps.toString()
        t.graduated        = graduated
      } catch {}
    }))
  } catch (e) { console.error('refreshPrices error:', e.message) }
}
setInterval(refreshPrices, 30000)


const DB_PATH = path.join(__dirname, 'db.json')
function readDB()    { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) } catch { return { tokens: {} } } }
function writeDB(d)  { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)) }

// ── Live rooms (in-memory) ────────────────────────────────────
// { [tokenAddress]: { roomId, host, startedAt, viewers: Set<ws> } }
const liveRooms = {}

// ── Multer ────────────────────────────────────────────────────
function makeStorage(folder) {
  return multer.diskStorage({
    destination: (req, file, cb) => { const dir = path.join(__dirname,'uploads',folder); fs.mkdirSync(dir,{recursive:true}); cb(null,dir) },
    filename:    (req, file, cb) => { const ext=path.extname(file.originalname).toLowerCase()||'.png'; cb(null,`${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`) },
  })
}
const uploadBanner = multer({ storage: makeStorage('banners'), limits: { fileSize: 10*1024*1024 } })
const uploadPfp    = multer({ storage: makeStorage('pfp'),     limits: { fileSize: 5*1024*1024  } })
const serverUrl = req => `https://api.monpad.net`

// ═════════════════════════════════════════════════════════════
// REST ROUTES
// ═════════════════════════════════════════════════════════════

app.get('/api/health', (_, res) => res.json({ ok: true }))

// ── MON price in USD (cached 60s) ────────────────────────────
let monPriceCache = { price: 0, ts: 0 }
app.get('/api/mon-price', async (_, res) => {
  const now = Date.now()
  if (now - monPriceCache.ts < 60000 && monPriceCache.price > 0) return res.json({ price: monPriceCache.price })

  async function fetchUrl(hostname, path) {
    return new Promise((resolve, reject) => {
      const https = require('https')
      https.get({ hostname, path, headers: { 'User-Agent': 'MonPad/1.0' } }, r => {
        let data = ''
        r.on('data', c => data += c)
        r.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('parse fail')) } })
      }).on('error', reject)
    })
  }

  try {
    // Try DexScreener first
    const dex = await fetchUrl('api.dexscreener.com', '/latest/dex/tokens/0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A')
    const p = parseFloat(dex?.pairs?.[0]?.priceUsd || '0')
    if (p > 0) { monPriceCache = { price: p, ts: now }; return res.json({ price: p }) }
  } catch {}

  try {
    // Fallback: CoinGecko
    const cg = await fetchUrl('api.coingecko.com', '/api/v3/simple/price?ids=monad-network&vs_currencies=usd')
    const p = cg?.['monad-network']?.usd || 0
    if (p > 0) { monPriceCache = { price: p, ts: now }; return res.json({ price: p }) }
  } catch {}

  res.json({ price: monPriceCache.price })
})

// ── Image uploads ─────────────────────────────────────────────
app.post('/api/upload/banner', uploadBanner.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ url: `${serverUrl(req)}/uploads/banners/${req.file.filename}` })
})
app.post('/api/upload/pfp', uploadPfp.single('pfp'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ url: `${serverUrl(req)}/uploads/pfp/${req.file.filename}` })
})

// ── Token metadata ────────────────────────────────────────────
app.post('/api/token/meta', (req, res) => {
  const { tokenAddress, curveAddress, name, symbol, desc, twitter, website, bannerUrl, pfpUrl, creator } = req.body
  if (!tokenAddress) return res.status(400).json({ error: 'tokenAddress required' })
  const db = readDB()
  db.tokens[tokenAddress.toLowerCase()] = { tokenAddress: tokenAddress.toLowerCase(), curveAddress: curveAddress?.toLowerCase(), name, symbol, desc, twitter, website, bannerUrl, pfpUrl, creator: creator?.toLowerCase(), createdAt: Date.now() }
  writeDB(db)
  res.json({ ok: true })
})
app.get('/api/token/meta/:address', (req, res) => {
  const db   = readDB()
  const meta = db.tokens[req.params.address.toLowerCase()]
  if (!meta) return res.status(404).json({ error: 'Not found' })
  res.json(meta)
})
// GET /api/tokens/all — returns all tokens including blocklisted (for portfolio)
app.get('/api/tokens/all', (req, res) => {
  const db = readDB()
  const merged = tokenIndex.map(t => {
    const meta = db.tokens[t.tokenAddress] || {}
    return { ...t, ...meta, tokenAddress: t.tokenAddress, curveAddress: t.curveAddress }
  })
  const indexedAddrs = new Set(tokenIndex.map(t => t.tokenAddress))
  const dbOnly = Object.values(db.tokens).filter(t => !indexedAddrs.has(t.tokenAddress?.toLowerCase()))
  const list = [...merged, ...dbOnly].sort((a,b) => Number(b.blockNumber||0) - Number(a.blockNumber||0))
  res.json(list)
})
const BLOCKLIST_PATH = path.join(__dirname, 'blocklist.json')
function readBlocklist() { try { return JSON.parse(fs.readFileSync(BLOCKLIST_PATH,'utf8')) } catch { return [] } }
function writeBlocklist(l) { fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify(l)) }

// POST /api/admin/delist { address, secret }
app.post('/api/admin/delist', (req, res) => {
  const { address, secret, unhide } = req.body
  if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
  if (!address) return res.status(400).json({ error: 'address required' })
  const list = readBlocklist()
  const addr = address.toLowerCase()
  if (unhide) {
    writeBlocklist(list.filter(a => a !== addr))
    return res.json({ ok: true, action: 'unhidden', address: addr })
  }
  if (!list.includes(addr)) { list.push(addr); writeBlocklist(list) }
  res.json({ ok: true, action: 'hidden', address: addr })
})

app.get('/api/tokens', (req, res) => {
  const db   = readDB()
  const blocklist = new Set(readBlocklist())
  // merge on-chain index with server metadata
  const merged = tokenIndex.map(t => {
    const meta = db.tokens[t.tokenAddress] || {}
    return { ...t, ...meta, tokenAddress: t.tokenAddress, curveAddress: t.curveAddress }
  })
  // also include any tokens in db not yet indexed (just launched)
  const indexedAddrs = new Set(tokenIndex.map(t => t.tokenAddress))
  const dbOnly = Object.values(db.tokens).filter(t => !indexedAddrs.has(t.tokenAddress?.toLowerCase()))
  const list = [...merged, ...dbOnly]
    .filter(t => !blocklist.has(t.tokenAddress?.toLowerCase()))
    .sort((a,b) => Number(b.blockNumber||0) - Number(a.blockNumber||0))
  res.json(list)
})

// ── Admin endpoints ──────────────────────────────────────────
app.post('/api/admin/inject-trade', (req, res) => {
  const { secret, curve, trade } = req.body
  if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
  const key = curve.toLowerCase()
  if (!tradeCache[key]) tradeCache[key] = []
  tradeCache[key].push(trade)
  tradeCache[key].sort((a,b) => a.ts - b.ts)
  saveTradeCache()
  console.log(`💉 Injected trade for ${key}: ${JSON.stringify(trade)}`)
  res.json({ ok: true, total: tradeCache[key].length })
})

app.post('/api/admin/clear-cache', (req, res) => {
  const { secret, curve } = req.body
  if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
  const key = curve.toLowerCase()
  tradeCache[key] = []
  saveTradeCache()
  console.log(`🗑️ Cleared trade cache for ${key}`)
  res.json({ ok: true })
})

app.post('/api/admin/seed-blocks', (req, res) => {
  const { secret, blocks } = req.body
  if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
  Object.entries(blocks).forEach(([k,v]) => { tradeLastBlock[k.toLowerCase()] = BigInt(v) })
  saveTradeBlocks()
  res.json({ ok: true, blocks: Object.fromEntries(Object.entries(tradeLastBlock).map(([k,v])=>[k,v.toString()])) })
})

// ── Live rooms ────────────────────────────────────────────────
// GET /api/live — list all live token addresses
app.get('/api/live', (req, res) => {
  const live = Object.keys(liveRooms).filter(addr => liveRooms[addr])
  res.json({ live })
})

// GET /api/live/:tokenAddress — check if specific token is live
app.get('/api/live/:token', (req, res) => {
  const room = liveRooms[req.params.token.toLowerCase()]
  if (!room) return res.json({ live: false })
  res.json({ live: true, roomId: room.roomId, viewers: room.viewers.size, startedAt: room.startedAt, playbackId: room.playbackId || null })
})

const LIVEPEER_KEY = process.env.LIVEPEER_API_KEY || '8707accb-8b1c-4ec0-b82c-9bfb9d9015e4'

// POST /api/live/:token/start — creator starts stream, creates Livepeer stream
app.post('/api/live/:token/start', async (req, res) => {
  const addr = req.params.token.toLowerCase()
  const { host, tokenName, tokenSymbol } = req.body
  const roomId = `mp-${addr.slice(2,8)}-${Date.now()}`

  try {
    // Create Livepeer stream
    const lpRes = await fetch('https://livepeer.studio/api/stream', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LIVEPEER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${tokenName || addr} - MonPad`, record: false })
    })
    const lpData = await lpRes.json()

    liveRooms[addr] = {
      roomId,
      host: host?.toLowerCase(),
      tokenName, tokenSymbol,
      startedAt: Date.now(),
      viewers: new Set(),
      hostWs: null,
      streamId: lpData.id,
      streamKey: lpData.streamKey,
      playbackId: lpData.playbackId,
      rtmpUrl: `rtmp://rtmp.livepeer.com/live/${lpData.streamKey}`
    }
    console.log(`🔴 Live started: ${tokenName} (${addr})`)
    res.json({ ok: true, roomId, streamKey: lpData.streamKey, playbackId: lpData.playbackId, rtmpUrl: `rtmp://rtmp.livepeer.com/live/${lpData.streamKey}` })
  } catch (e) {
    console.error('Livepeer error:', e)
    // fallback — still allow going live without video
    liveRooms[addr] = { roomId, host: host?.toLowerCase(), tokenName, tokenSymbol, startedAt: Date.now(), viewers: new Set(), hostWs: null }
    res.json({ ok: true, roomId })
  }
})

// POST /api/live/:tokenAddress/end — creator ends stream
app.post('/api/live/:token/end', (req, res) => {
  const addr = req.params.token.toLowerCase()
  const room = liveRooms[addr]
  if (room) {
    // notify all viewers
    room.viewers.forEach(ws => {
      try { ws.send(JSON.stringify({ type: 'ended' })) } catch {}
    })
    delete liveRooms[addr]
    console.log(`⏹ Live ended: ${addr}`)
  }
  res.json({ ok: true })
})

// ── Candle data ───────────────────────────────────────────────
const INTERVALS = { '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 }

// trade cache per curve address
const tradeCache = {}
const tradeLastBlock = {}

// persist indexer progress to disk
const TRADE_BLOCKS_PATH = path.join(__dirname, 'tradeBlocks.json')
const TRADE_CACHE_PATH  = path.join(__dirname, 'tradeCache.json')

function readTradeBlocks() { try { return JSON.parse(fs.readFileSync(TRADE_BLOCKS_PATH,'utf8')) } catch { return {} } }
function saveTradeBlocks() {
  try { fs.writeFileSync(TRADE_BLOCKS_PATH, JSON.stringify(Object.fromEntries(Object.entries(tradeLastBlock).map(([k,v])=>[k,v.toString()])))) } catch {}
}
function loadTradeCache() { try { return JSON.parse(fs.readFileSync(TRADE_CACHE_PATH,'utf8')) } catch { return {} } }
function saveTradeCache() {
  try { fs.writeFileSync(TRADE_CACHE_PATH, JSON.stringify(tradeCache)) } catch {}
}

// load saved trade cache from disk
const _savedCache = loadTradeCache()
Object.entries(_savedCache).forEach(([k,v]) => { tradeCache[k] = v })
console.log(`📂 Loaded trade cache: ${Object.values(_savedCache).reduce((s,v)=>s+v.length,0)} trades across ${Object.keys(_savedCache).length} curves`)

const _savedBlocks = readTradeBlocks()
Object.entries(_savedBlocks).forEach(([k,v]) => { tradeLastBlock[k] = BigInt(v) })
console.log(`📂 Loaded trade progress for ${Object.keys(_savedBlocks).length} curves`)

let indexTradesIdx = 0
let isIndexingTrades = false
async function indexTrades() {
  if (tokenIndex.length === 0 || isIndexingTrades) return
  isIndexingTrades = true
  try {
    const latest = await client.getBlockNumber()
    const t = tokenIndex[indexTradesIdx % tokenIndex.length]
    indexTradesIdx++
    const curve = t.curveAddress.toLowerCase()
    const fromBlock = tradeLastBlock[curve] || BigInt(t.blockNumber || START_BLOCK)
    if (fromBlock >= latest) { return }
    const toBlock = latest
    const CHUNK = 900n
    const buyLogs = [], sellLogs = []
    for (let from = fromBlock; from <= toBlock; from += CHUNK) {
      const to = from + CHUNK - 1n > toBlock ? toBlock : from + CHUNK - 1n
      try {
        const [b, s] = await Promise.all([
          client.getLogs({ address: t.curveAddress, event: parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)'), fromBlock: from, toBlock: to }),
          client.getLogs({ address: t.curveAddress, event: parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)'), fromBlock: from, toBlock: to }),
        ])
        buyLogs.push(...b); sellLogs.push(...s)
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }
    tradeLastBlock[curve] = toBlock
    saveTradeBlocks()
    if (buyLogs.length === 0 && sellLogs.length === 0) return
    const blockNums = [...new Set([...buyLogs,...sellLogs].map(l=>l.blockNumber))]
    const blockTimes = {}
    await Promise.all(blockNums.map(async bn => {
      try { const b = await client.getBlock({ blockNumber: bn }); blockTimes[bn.toString()] = Number(b.timestamp) } catch {}
    }))
    const newTrades = []
    for (const l of buyLogs) {
      const ts = blockTimes[l.blockNumber.toString()]; if (!ts) continue
      const monIn = Number(l.args.monIn)/1e18, tokOut = Number(l.args.tokensOut)/1e18
      newTrades.push({ ts, price: tokOut>0?(monIn/tokOut):0, volume:monIn, type:'buy', addr:l.args.buyer })
    }
    for (const l of sellLogs) {
      const ts = blockTimes[l.blockNumber.toString()]; if (!ts) continue
      const monOut = Number(l.args.monOut)/1e18, tokIn = Number(l.args.tokensIn)/1e18
      newTrades.push({ ts, price: tokIn>0?(monOut/tokIn):0, volume:monOut, type:'sell', addr:l.args.seller })
    }
    if (!tradeCache[curve]) tradeCache[curve] = []
    tradeCache[curve] = [...tradeCache[curve], ...newTrades].sort((a,b)=>a.ts-b.ts)
    saveTradeCache()
    console.log(`📊 Indexed ${newTrades.length} trades for ${t.name||t.symbol||curve.slice(0,8)}`)
  } catch(e) { console.error('indexTrades error:', e.message) }
  finally { isIndexingTrades = false }
}
setTimeout(indexTrades, 3000)
setInterval(indexTrades, 30000)

app.get('/api/candles/:curveAddress', async (req, res) => {
  const { curveAddress } = req.params
  const intervalSec = INTERVALS[req.query.interval] || 900
  try {
    const trades = tradeCache[curveAddress.toLowerCase()] || []

    const candleMap = {}
    let prevClose = trades.length > 0 ? trades[0].price : 0
    for (const t of trades) {
      const bucket = Math.floor(t.ts/intervalSec)*intervalSec
      if (!candleMap[bucket]) candleMap[bucket] = { time:bucket, open:prevClose, high:t.price, low:t.price, close:t.price, volume:0 }
      const c = candleMap[bucket]
      c.high   = Math.max(c.high, t.price)
      c.low    = Math.min(c.low,  t.price)
      c.close  = t.price
      c.volume += t.volume
      prevClose = t.price
    }

    const candles = Object.values(candleMap).sort((a,b)=>a.time-b.time)
    res.json({ candles, trades: trades.map(t=>({ ts:t.ts, type:t.type, addr:t.addr, volume:t.volume, price:t.price })) })
  } catch (e) {
    console.error('candles error:', e)
    res.status(500).json({ error: e.message })
  }
})

// ═════════════════════════════════════════════════════════════
// WEBSOCKET — live room chat + viewer count
// ws://host/ws/live/:roomId?role=host|viewer
// ═════════════════════════════════════════════════════════════
wss.on('connection', (ws, req) => {
  const url   = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/')  // ['','ws','live',roomId]
  const roomId = parts[3]
  const role   = url.searchParams.get('role') || 'viewer'

  if (!roomId) { ws.close(); return }

  // find which token this room belongs to
  const tokenAddr = Object.keys(liveRooms).find(a => liveRooms[a]?.roomId === roomId)
  if (!tokenAddr) { ws.close(); return }
  const room = liveRooms[tokenAddr]

  if (role === 'host') {
    room.hostWs = ws
  } else {
    room.viewers.add(ws)
    // tell everyone new viewer count
    broadcast(room, { type: 'viewers', count: room.viewers.size })
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'chat') {
        broadcast(room, { type: 'chat', user: msg.user, text: msg.text })
      }
      if (msg.type === 'end' && role === 'host') {
        broadcast(room, { type: 'ended' })
        delete liveRooms[tokenAddr]
      }
    } catch {}
  })

  ws.on('close', () => {
    if (role === 'host') {
      broadcast(room, { type: 'ended' })
      delete liveRooms[tokenAddr]
    } else {
      room.viewers.delete(ws)
      broadcast(room, { type: 'viewers', count: room.viewers.size })
    }
  })
})

function broadcast(room, msg) {
  const str = JSON.stringify(msg)
  room.viewers.forEach(ws => { try { ws.send(str) } catch {} })
  if (room.hostWs) { try { room.hostWs.send(str) } catch {} }
}

function broadcastAll(msg) {
  const str = JSON.stringify(msg)
  wss.clients.forEach(ws => { try { if (ws.readyState === 1) ws.send(str) } catch {} })
}

// watch for Buy/Sell events on all indexed curves and push price updates
const BUY_EVENT  = parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)')
const SELL_EVENT = parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)')

async function watchCurveEvents() {
  if (tokenIndex.length === 0) return
  try {
    const curves = tokenIndex.map(t => t.curveAddress)
    const latest = await client.getBlockNumber()
    const from   = latest - 2n  // last 2 blocks
    await Promise.all(tokenIndex.map(async t => {
      try {
        const [buys, sells] = await Promise.all([
          client.getLogs({ address: t.curveAddress, event: BUY_EVENT,  fromBlock: from, toBlock: latest }),
          client.getLogs({ address: t.curveAddress, event: SELL_EVENT, fromBlock: from, toBlock: latest }),
        ])
        if (buys.length > 0 || sells.length > 0) {
          // refresh this token's price
          const [priceWeiPerToken, monRaisedNet, bondedBps] = await Promise.all([
            client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' }),
            client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'monRaisedNet' }),
            client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'bondedBps' }),
          ])
          t.priceWeiPerToken = priceWeiPerToken.toString()
          t.marketCap        = (priceWeiPerToken * 1_000_000_000n).toString()
          t.monRaisedNet     = monRaisedNet.toString()
          t.bondedBps        = bondedBps.toString()
          // broadcast to all connected clients
          broadcastAll({ type: 'price_update', tokenAddress: t.tokenAddress, priceWeiPerToken: t.priceWeiPerToken, marketCap: t.marketCap, monRaisedNet: t.monRaisedNet, bondedBps: t.bondedBps })
          console.log(`📈 Price update: ${t.name} (${t.symbol})`)
        }
      } catch {}
    }))
  } catch (e) { console.error('watchCurveEvents error:', e.message) }
}

// poll every 3 seconds for near-realtime updates
setInterval(watchCurveEvents, 3000)

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`✅ MonPad server on :${PORT}`))
