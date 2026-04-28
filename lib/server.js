// Load .env if present (production droplet relies on this; pm2 doesn't auto-load)
try { require('dotenv').config() } catch {}

const express = require('express')
const multer = require('multer')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { WebSocketServer } = require('ws')
const { createPublicClient, http: viemHttp, fallback: viemFallback, parseAbiItem } = require('viem')

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
const PORT = 3001

// Multi-RPC: primary first, public fallback. PRIMARY_RPC takes precedence over MONAD_RPC for clarity.
const PRIMARY_RPC = process.env.PRIMARY_RPC || process.env.MONAD_RPC || 'https://rpc.monad.xyz'
const FALLBACK_RPC = process.env.FALLBACK_RPC || 'https://rpc.monad.xyz'
const RPC_LIST = PRIMARY_RPC === FALLBACK_RPC ? [PRIMARY_RPC] : [PRIMARY_RPC, FALLBACK_RPC]
const START_BLOCK = 66664884n
// Monad mainnet multicall3 — verified deployed at canonical 0xcA11... address
const MONAD_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const monadChain = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPC_LIST } },
  contracts: { multicall3: { address: MONAD_MULTICALL3, blockCreated: 0 } }
}
const client = createPublicClient({
  chain: monadChain,
  transport: viemFallback(RPC_LIST.map(url => viemHttp(url, { timeout: 10_000 })), { rank: false, retryCount: 2 })
})
console.log(`[rpc] primary=${PRIMARY_RPC.slice(0, 50)}${PRIMARY_RPC.length > 50 ? '...' : ''}, fallback=${RPC_LIST.length > 1 ? FALLBACK_RPC : 'none'}`)

app.use(cors({ origin: '*' }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

if (!process.env.FACTORY_ADDRESS) { throw new Error('FACTORY_ADDRESS env required — refusing to start with hardcoded V1 fallback. Set it in /root/monpad-server/.env') }
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS
const LAUNCHED_EVENT = parseAbiItem('event Launched(address indexed token, address indexed curve, address indexed creator, address referrer, uint256 devAmt, string name, string symbol)')
const TOKEN_ABI = [
  { name:'name', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
  { name:'symbol', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
  { name:'decimals', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint8'}] },
  { name:'balanceOf', type:'function', stateMutability:'view', inputs:[{name:'',type:'address'}], outputs:[{name:'',type:'uint256'}] },
  ]
const CURVE_ABI_SHORT = [
  { name:'graduated', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'bool'}] },
  { name:'monRaisedNet', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'capMon', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'bondedBps', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'priceWeiPerToken', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'totalCreatorFees', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'totalPlatformFees', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'totalStakingFees', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  ]

let tokenIndex = []
let lastIndexedBlock = START_BLOCK

// ── Caches: { wallet|key -> { data, expires } } ──
const holdingsCache = {}, leaderboardCache = {}
const HOLDINGS_TTL = 30_000, LEADERBOARD_TTL = 60_000
function cacheGet(c, k, ttl) { const e = c[k]; return e && e.expires > Date.now() ? e.data : null }
function cacheSet(c, k, data, ttl) { c[k] = { data, expires: Date.now() + ttl } }
function invalidateHoldings(wallet) { if (wallet) delete holdingsCache[wallet.toLowerCase()] }

// FIFO P&L: matches each sell against earliest unmatched buy lots, returns realized MON gain
function fifoPnL(trades) {
  const lots = []; let realized = 0
  for (const t of trades.slice().sort((a,b) => a.ts - b.ts)) {
    if (t.type === 'buy') {
      lots.push({ qty: t.volume / Math.max(t.price, 1e-30), cost: t.volume })
    } else {
      let qtyToSell = t.volume / Math.max(t.price, 1e-30), proceeds = t.volume
      while (qtyToSell > 0 && lots.length) {
        const lot = lots[0]
        const take = Math.min(lot.qty, qtyToSell)
        const lotCost = lot.cost * (take / lot.qty)
        realized += (proceeds * (take / (t.volume / Math.max(t.price, 1e-30)))) - lotCost
        lot.qty -= take; lot.cost -= lotCost; qtyToSell -= take
        if (lot.qty <= 1e-12) lots.shift()
      }
    }
  }
  const remainingCost = lots.reduce((s, l) => s + l.cost, 0)
  return { realized, costBasisRemaining: remainingCost }
}

async function indexTokens() {
    try {
          const latest = await client.getBlockNumber()
          const CHUNK = 900n
          const logs = []
                for (let from = lastIndexedBlock; from <= latest; from += CHUNK) {
                        const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
                        try { const chunk = await client.getLogs({ address: FACTORY_ADDRESS, event: LAUNCHED_EVENT, fromBlock: from, toBlock: to }); logs.push(...chunk) } catch {}
                }
          if (logs.length === 0) { lastIndexedBlock = latest; return }
          const newEntries = await Promise.all(logs.map(async log => {
                  const { token, curve, creator } = log.args
                  const addr = token.toLowerCase()
                  const existing = tokenIndex.find(t => t.tokenAddress === addr)
                  if (existing && existing.marketCap && existing.marketCap !== '0') return null
                  if (existing) tokenIndex = tokenIndex.filter(t => t.tokenAddress !== addr)
                  try {
                            const [name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWeiPerToken] = await Promise.all([
                                        client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'name' }),
                                        client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'symbol' }),
                                        client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'graduated' }),
                                        client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'monRaisedNet' }),
                                        client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'capMon' }),
                                        client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'bondedBps' }),
                                        client.readContract({ address: curve, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' }),
                                      ])
                            const marketCap = priceWeiPerToken * 1_000_000_000n
                            return { tokenAddress: addr, curveAddress: curve.toLowerCase(), creator: creator.toLowerCase(), name, symbol, graduated, monRaisedNet: monRaisedNet.toString(), capMon: capMon.toString(), bondedBps: bondedBps.toString(), priceWeiPerToken: priceWeiPerToken.toString(), marketCap: marketCap.toString(), blockNumber: log.blockNumber.toString() }
                  } catch { return null }
          }))
          const valid = newEntries.filter(Boolean)
          tokenIndex = [...tokenIndex, ...valid]
          lastIndexedBlock = latest
          console.log(`Indexed ${valid.length} new tokens (total: ${tokenIndex.length})`)
    } catch (e) { console.error('indexTokens error:', e.message) }
}
indexTokens()
setInterval(indexTokens, 30000)

async function refreshPrices() {
    if (tokenIndex.length === 0) return
    try {
          await Promise.all(tokenIndex.map(async t => {
                  try {
                            const [priceWeiPerToken, monRaisedNet, bondedBps, graduated] = await Promise.all([
                                        client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' }),
                                        client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'monRaisedNet' }),
                                        client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'bondedBps' }),
                                        client.readContract({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'graduated' }),
                                      ])
                            t.priceWeiPerToken = priceWeiPerToken.toString()
                            t.marketCap = (priceWeiPerToken * 1_000_000_000n).toString()
                            t.monRaisedNet = monRaisedNet.toString()
                            t.bondedBps = bondedBps.toString()
                            t.graduated = graduated
                  } catch {}
          }))
    } catch (e) { console.error('refreshPrices error:', e.message) }
}
setInterval(refreshPrices, 30000)

const DB_PATH = path.join(__dirname, 'db.json')
function readDB() { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) } catch { return { tokens: {} } } }
function writeDB(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)) }

const liveRooms = {}

function makeStorage(folder) {
    return multer.diskStorage({
          destination: (req, file, cb) => { const dir = path.join(__dirname,'uploads',folder); fs.mkdirSync(dir,{recursive:true}); cb(null,dir) },
          filename: (req, file, cb) => { const ext=path.extname(file.originalname).toLowerCase()||'.png'; cb(null,`${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`) },
    })
}
const uploadBanner = multer({ storage: makeStorage('banners'), limits: { fileSize: 10*1024*1024 } })
const uploadPfp = multer({ storage: makeStorage('pfp'), limits: { fileSize: 5*1024*1024 } })
const serverUrl = () => 'https://api.monpad.net'

app.get('/api/health', (_, res) => res.json({ ok: true }))

let monPriceCache = { price: 0, ts: 0 }
app.get('/api/mon-price', async (_, res) => {
    const now = Date.now()
    if (now - monPriceCache.ts < 60000 && monPriceCache.price > 0) return res.json({ price: monPriceCache.price })
    async function fetchUrl(hostname, urlPath) {
          return new Promise((resolve, reject) => {
                  const https = require('https')
                  https.get({ hostname, path: urlPath, headers: { 'User-Agent': 'MonPad/1.0' } }, r => {
                            let data = ''
                            r.on('data', c => data += c)
                            r.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('parse fail')) } })
                  }).on('error', reject)
          })
    }
    try { const dex = await fetchUrl('api.dexscreener.com', '/latest/dex/tokens/0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'); const p = parseFloat(dex?.pairs?.[0]?.priceUsd || '0'); if (p > 0) { monPriceCache = { price: p, ts: now }; return res.json({ price: p }) } } catch {}
    try { const cg = await fetchUrl('api.coingecko.com', '/api/v3/simple/price?ids=monad-network&vs_currencies=usd'); const p = cg?.['monad-network']?.usd || 0; if (p > 0) { monPriceCache = { price: p, ts: now }; return res.json({ price: p }) } } catch {}
    res.json({ price: monPriceCache.price })
})

app.post('/api/upload/banner', uploadBanner.single('banner'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'No file' }); res.json({ url: `${serverUrl()}/uploads/banners/${req.file.filename}` }) })
app.post('/api/upload/pfp', uploadPfp.single('pfp'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'No file' }); res.json({ url: `${serverUrl()}/uploads/pfp/${req.file.filename}` }) })

app.post('/api/token/meta', (req, res) => {
    // INTERIM AUTH: require ADMIN_SECRET until wallet-signature flow lands. Without this, anyone can rename tokens / inject phishing banners.
    const { tokenAddress, curveAddress, name, symbol, desc, twitter, website, bannerUrl, pfpUrl, creator, secret } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    if (!tokenAddress) return res.status(400).json({ error: 'tokenAddress required' })
    const db = readDB()
    db.tokens[tokenAddress.toLowerCase()] = { tokenAddress: tokenAddress.toLowerCase(), curveAddress: curveAddress?.toLowerCase(), name, symbol, desc, twitter, website, bannerUrl, pfpUrl, creator: creator?.toLowerCase(), createdAt: Date.now() }
    writeDB(db); res.json({ ok: true })
})
app.get('/api/token/meta/:address', (req, res) => {
    const db = readDB()
    const meta = db.tokens[req.params.address.toLowerCase()]
    if (!meta) return res.status(404).json({ error: 'Not found' })
    res.json(meta)
})
app.get('/api/tokens/all', (req, res) => {
    const db = readDB()
    const merged = tokenIndex.map(t => ({ ...t, ...(db.tokens[t.tokenAddress] || {}), tokenAddress: t.tokenAddress, curveAddress: t.curveAddress }))
    const indexedAddrs = new Set(tokenIndex.map(t => t.tokenAddress))
    const dbOnly = Object.values(db.tokens).filter(t => !indexedAddrs.has(t.tokenAddress?.toLowerCase()))
    res.json([...merged, ...dbOnly].sort((a,b) => Number(b.blockNumber||0) - Number(a.blockNumber||0)))
})

const BLOCKLIST_PATH = path.join(__dirname, 'blocklist.json')
function readBlocklist() { try { return JSON.parse(fs.readFileSync(BLOCKLIST_PATH,'utf8')) } catch { return [] } }
function writeBlocklist(l) { fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify(l)) }

app.post('/api/admin/delist', (req, res) => {
    const { address, secret, unhide } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    if (!address) return res.status(400).json({ error: 'address required' })
    const list = readBlocklist(), addr = address.toLowerCase()
    if (unhide) { writeBlocklist(list.filter(a => a !== addr)); return res.json({ ok: true, action: 'unhidden', address: addr }) }
    if (!list.includes(addr)) { list.push(addr); writeBlocklist(list) }
    res.json({ ok: true, action: 'hidden', address: addr })
})

app.post('/api/admin/reindex', (req, res) => {
    const { secret } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    lastIndexedBlock = START_BLOCK
    tokenIndex = []
        console.log('Reindex triggered from block', START_BLOCK.toString())
    indexTokens()
    res.json({ ok: true, message: 'Reindex started from block ' + START_BLOCK.toString() })
})

function computeTokenStats(trades) {
    if (!trades || trades.length === 0) return { vol24h: 0, uniqueBuyers: 0, ath: 0, change24h: 0 }
    const now = Date.now() / 1000, day = 86400
    const trades24h = trades.filter(t => t.ts > now - day)
    const vol24h = trades24h.reduce((s, t) => s + (t.volume || 0), 0)
    const uniqueBuyers = new Set(trades.filter(t => t.type === 'buy').map(t => t.addr)).size
    const ath = trades.reduce((m, t) => Math.max(m, t.price || 0), 0)
    let change24h = 0
    if (trades24h.length > 0) { const oldest = trades24h[0].price || 0, latest2 = trades[trades.length-1].price||0; if (oldest>0) change24h=((latest2-oldest)/oldest)*100 }
    return { vol24h, uniqueBuyers, ath, change24h }
}

app.get('/api/tokens', (req, res) => {
    const db = readDB(), blocklist = new Set(readBlocklist())
    const merged = tokenIndex.map(t => ({ ...t, ...(db.tokens[t.tokenAddress]||{}), ...computeTokenStats(tradeCache[t.curveAddress?.toLowerCase()]), tokenAddress: t.tokenAddress, curveAddress: t.curveAddress }))
    const indexedAddrs = new Set(tokenIndex.map(t => t.tokenAddress))
    const dbOnly = Object.values(db.tokens).filter(t => !indexedAddrs.has(t.tokenAddress?.toLowerCase()))
    res.json([...merged, ...dbOnly].filter(t => !blocklist.has(t.tokenAddress?.toLowerCase())).sort((a,b) => Number(b.blockNumber||0) - Number(a.blockNumber||0)))
})

app.post('/api/admin/inject-trade', (req, res) => {
    const { secret, curve, trade } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    const key = curve.toLowerCase()
    if (!tradeCache[key]) tradeCache[key] = []
        tradeCache[key].push(trade); tradeCache[key].sort((a,b) => a.ts-b.ts); saveTradeCache()
    res.json({ ok: true, total: tradeCache[key].length })
})
app.post('/api/admin/clear-cache', (req, res) => {
    const { secret, curve } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    tradeCache[curve.toLowerCase()] = []; saveTradeCache(); res.json({ ok: true })
})
app.post('/api/admin/seed-blocks', (req, res) => {
    const { secret, blocks } = req.body
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' })
    Object.entries(blocks).forEach(([k,v]) => { tradeLastBlock[k.toLowerCase()] = BigInt(v) }); saveTradeBlocks()
    res.json({ ok: true })
})

app.get('/api/live', (_, res) => res.json({ live: Object.keys(liveRooms).filter(a => liveRooms[a]) }))
app.get('/api/live/:token', (req, res) => {
    const room = liveRooms[req.params.token.toLowerCase()]
    if (!room) return res.json({ live: false })
    res.json({ live: true, roomId: room.roomId, viewers: room.viewers.size, startedAt: room.startedAt, playbackId: room.playbackId||null })
})

if (!process.env.LIVEPEER_API_KEY) { throw new Error('LIVEPEER_API_KEY env required — refusing to start with leaked hardcoded fallback. Regenerate at livepeer.studio.') }
const LIVEPEER_KEY = process.env.LIVEPEER_API_KEY
app.post('/api/live/:token/start', async (req, res) => {
    const addr = req.params.token.toLowerCase(), { host, tokenName, tokenSymbol } = req.body
    const roomId = `mp-${addr.slice(2,8)}-${Date.now()}`
    try {
          const lpRes = await fetch('https://livepeer.studio/api/stream', { method:'POST', headers:{'Authorization':`Bearer ${LIVEPEER_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({name:`${tokenName||addr} - MonPad`,record:false}) })
          const lpData = await lpRes.json()
          liveRooms[addr] = { roomId, host:host?.toLowerCase(), tokenName, tokenSymbol, startedAt:Date.now(), viewers:new Set(), hostWs:null, streamId:lpData.id, streamKey:lpData.streamKey, playbackId:lpData.playbackId, rtmpUrl:`rtmp://rtmp.livepeer.com/live/${lpData.streamKey}` }
          res.json({ ok:true, roomId, streamKey:lpData.streamKey, playbackId:lpData.playbackId, rtmpUrl:`rtmp://rtmp.livepeer.com/live/${lpData.streamKey}` })
    } catch { liveRooms[addr]={roomId,host:host?.toLowerCase(),tokenName,tokenSymbol,startedAt:Date.now(),viewers:new Set(),hostWs:null}; res.json({ok:true,roomId}) }
})
app.post('/api/live/:token/end', (req, res) => {
    const addr = req.params.token.toLowerCase(), room = liveRooms[addr]
    if (room) { room.viewers.forEach(ws => { try { ws.send(JSON.stringify({type:'ended'})) } catch {} }); delete liveRooms[addr] }
    res.json({ ok: true })
})

const INTERVALS = {'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}
const tradeCache = {}, tradeLastBlock = {}
const TRADE_BLOCKS_PATH = path.join(__dirname,'tradeBlocks.json'), TRADE_CACHE_PATH = path.join(__dirname,'tradeCache.json')
function readTradeBlocks() { try { return JSON.parse(fs.readFileSync(TRADE_BLOCKS_PATH,'utf8')) } catch { return {} } }
function saveTradeBlocks() { try { fs.writeFileSync(TRADE_BLOCKS_PATH,JSON.stringify(Object.fromEntries(Object.entries(tradeLastBlock).map(([k,v])=>[k,v.toString()])))) } catch {} }
function loadTradeCache() { try { return JSON.parse(fs.readFileSync(TRADE_CACHE_PATH,'utf8')) } catch { return {} } }
function saveTradeCache() { try { fs.writeFileSync(TRADE_CACHE_PATH,JSON.stringify(tradeCache)) } catch {} }
const _savedCache = loadTradeCache()
Object.entries(_savedCache).forEach(([k,v]) => { tradeCache[k]=v })
const _savedBlocks = readTradeBlocks()
Object.entries(_savedBlocks).forEach(([k,v]) => { tradeLastBlock[k]=BigInt(v) })

let indexTradesIdx=0, isIndexingTrades=false
async function indexTrades() {
    if (tokenIndex.length===0||isIndexingTrades) return
    isIndexingTrades=true
    try {
          const latest=await client.getBlockNumber(), t=tokenIndex[indexTradesIdx%tokenIndex.length]
          indexTradesIdx++
          const curve=t.curveAddress.toLowerCase(), fromBlock=tradeLastBlock[curve]||BigInt(t.blockNumber||START_BLOCK)
          if (fromBlock>=latest) return
          const CHUNK=900n, buyLogs=[], sellLogs=[]
                for (let from=fromBlock;from<=latest;from+=CHUNK) {
                        const to=from+CHUNK-1n>latest?latest:from+CHUNK-1n
                        try { const [b,s]=await Promise.all([client.getLogs({address:t.curveAddress,event:parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)'),fromBlock:from,toBlock:to}),client.getLogs({address:t.curveAddress,event:parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)'),fromBlock:from,toBlock:to})]); buyLogs.push(...b);sellLogs.push(...s) } catch { await new Promise(r=>setTimeout(r,1000)) }
                }
          tradeLastBlock[curve]=latest; saveTradeBlocks()
          if (buyLogs.length===0&&sellLogs.length===0) return
          const blockNums=[...new Set([...buyLogs,...sellLogs].map(l=>l.blockNumber))], blockTimes={}
                await Promise.all(blockNums.map(async bn=>{ try{const b=await client.getBlock({blockNumber:bn});blockTimes[bn.toString()]=Number(b.timestamp)}catch{} }))
          const newTrades=[]
                for (const l of buyLogs) { const ts=blockTimes[l.blockNumber.toString()];if(!ts)continue;const monIn=Number(l.args.monIn)/1e18,tokOut=Number(l.args.tokensOut)/1e18;newTrades.push({ts,price:tokOut>0?(monIn/tokOut):0,volume:monIn,type:'buy',addr:l.args.buyer}) }
          for (const l of sellLogs) { const ts=blockTimes[l.blockNumber.toString()];if(!ts)continue;const monOut=Number(l.args.monOut)/1e18,tokIn=Number(l.args.tokensIn)/1e18;newTrades.push({ts,price:tokIn>0?(monOut/tokIn):0,volume:monOut,type:'sell',addr:l.args.seller}) }
          if (!tradeCache[curve]) tradeCache[curve]=[]
                tradeCache[curve]=[...tradeCache[curve],...newTrades].sort((a,b)=>a.ts-b.ts); saveTradeCache()
          // Invalidate holdings cache for any wallet with new activity
          for (const t of newTrades) invalidateHoldings(t.addr)
          // Leaderboards reflect new volume — invalidate too
          delete leaderboardCache.creators; delete leaderboardCache.traders
          console.log(`Indexed ${newTrades.length} trades for ${t.name||curve.slice(0,8)}`)
    } catch(e){console.error('indexTrades error:',e.message)} finally{isIndexingTrades=false}
}
setTimeout(indexTrades,3000); setInterval(indexTrades,30000)

app.get('/api/candles/:curveAddress', async (req,res)=>{
    const {curveAddress}=req.params, intervalSec=INTERVALS[req.query.interval]||900
    try {
          const trades=tradeCache[curveAddress.toLowerCase()]||[], candleMap={};let prevClose=trades.length>0?trades[0].price:0
          for (const t of trades) { const bucket=Math.floor(t.ts/intervalSec)*intervalSec;if(!candleMap[bucket])candleMap[bucket]={time:bucket,open:prevClose,high:t.price,low:t.price,close:t.price,volume:0};const c=candleMap[bucket];c.high=Math.max(c.high,t.price);c.low=Math.min(c.low,t.price);c.close=t.price;c.volume+=t.volume;prevClose=t.price }
          res.json({candles:Object.values(candleMap).sort((a,b)=>a.time-b.time),trades:trades.map(t=>({ts:t.ts,type:t.type,addr:t.addr,volume:t.volume,price:t.price}))})
    } catch(e){res.status(500).json({error:e.message})}
})

wss.on('connection',(ws,req)=>{
    const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/'),roomId=parts[3],role=url.searchParams.get('role')||'viewer'
    if(!roomId){ws.close();return}
    const tokenAddr=Object.keys(liveRooms).find(a=>liveRooms[a]?.roomId===roomId)
    if(!tokenAddr){ws.close();return}
    const room=liveRooms[tokenAddr]
    if(role==='host'){room.hostWs=ws}else{room.viewers.add(ws);broadcast(room,{type:'viewers',count:room.viewers.size})}
    ws.on('message',raw=>{try{const msg=JSON.parse(raw);if(msg.type==='chat')broadcast(room,{type:'chat',user:msg.user,text:msg.text});if(msg.type==='end'&&role==='host'){broadcast(room,{type:'ended'});delete liveRooms[tokenAddr]}}catch{}})
    ws.on('close',()=>{if(role==='host'){broadcast(room,{type:'ended'});delete liveRooms[tokenAddr]}else{room.viewers.delete(ws);broadcast(room,{type:'viewers',count:room.viewers.size})}})
})

function broadcast(room,msg){const str=JSON.stringify(msg);room.viewers.forEach(ws=>{try{ws.send(str)}catch{}});if(room.hostWs){try{room.hostWs.send(str)}catch{}}}
function broadcastAll(msg){const str=JSON.stringify(msg);wss.clients.forEach(ws=>{try{if(ws.readyState===1)ws.send(str)}catch{}})}

const BUY_EVENT=parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)')
const SELL_EVENT=parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)')
async function watchCurveEvents(){
    if(tokenIndex.length===0)return
    try{
          const latest=await client.getBlockNumber(),from=latest-2n
          await Promise.all(tokenIndex.map(async t=>{
                  try{
                            const [buys,sells]=await Promise.all([client.getLogs({address:t.curveAddress,event:BUY_EVENT,fromBlock:from,toBlock:latest}),client.getLogs({address:t.curveAddress,event:SELL_EVENT,fromBlock:from,toBlock:latest})])
                            if(buys.length>0||sells.length>0){
                                        const [p,m,b]=await Promise.all([client.readContract({address:t.curveAddress,abi:CURVE_ABI_SHORT,functionName:'priceWeiPerToken'}),client.readContract({address:t.curveAddress,abi:CURVE_ABI_SHORT,functionName:'monRaisedNet'}),client.readContract({address:t.curveAddress,abi:CURVE_ABI_SHORT,functionName:'bondedBps'})])
                                        t.priceWeiPerToken=p.toString();t.marketCap=(p*1_000_000_000n).toString();t.monRaisedNet=m.toString();t.bondedBps=b.toString()
                                        broadcastAll({type:'price_update',tokenAddress:t.tokenAddress,priceWeiPerToken:t.priceWeiPerToken,marketCap:t.marketCap,monRaisedNet:t.monRaisedNet,bondedBps:t.bondedBps})
                            }
                  }catch{}
          }))
    }catch(e){console.error('watchCurveEvents error:',e.message)}
}
setInterval(watchCurveEvents,3000)


// ── V2 Staking endpoints — read live from chain ──
const POOL_FACTORY_ADDR = process.env.POOL_FACTORY_ADDRESS || '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6'
const STAKING_HUB_ADDR = process.env.STAKING_HUB_ADDRESS || '0xd634b554860c09a7137aAB482CDF916129ba44aB'
const FACTORY_V2_ADDR = process.env.FACTORY_V2_ADDRESS || '0x0ec606736125499D7daFaf0B286cC1375592569C'

const POOL_FACTORY_ABI = [
  { name:'allPoolsCount', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'allPools', type:'function', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'address'}] },
  { name:'tokenToPool', type:'function', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'address'}] },
]
const POOL_ABI_RO = [
  { name:'token', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
  { name:'creator', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
  { name:'totalWeightedStaked', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'burnVault', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'totalBurned', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'burnsToCreator', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'bool'}] },
]
const FACTORY_RO = [
  { name:'monshiStakingPool', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
]
const HUB_RO = [
  { name:'poolCount', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'totalVolumeCache', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'pendingMonshi', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'pendingOthers', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
]

const stakingCache = {}
const STAKING_TTL = 15_000

app.get('/api/staking/pool/:tokenAddress', async (req, res) => {
  const t = req.params.tokenAddress?.toLowerCase()
  if (!t) return res.json({ pool: null })
  const ck = `pool:${t}`
  const cached = cacheGet(stakingCache, ck); if (cached) return res.json(cached)
  try {
    const pool = await client.readContract({ address: POOL_FACTORY_ADDR, abi: POOL_FACTORY_ABI, functionName: 'tokenToPool', args: [t] })
    const out = { pool: pool === '0x0000000000000000000000000000000000000000' ? null : pool }
    cacheSet(stakingCache, ck, out, STAKING_TTL)
    res.json(out)
  } catch (e) { console.error('pool lookup err:', e.message); res.json({ pool: null }) }
})

app.get('/api/staking/pools', async (_req, res) => {
  const cached = cacheGet(stakingCache, 'pools'); if (cached) return res.json(cached)
  try {
    const count = await client.readContract({ address: POOL_FACTORY_ADDR, abi: POOL_FACTORY_ABI, functionName: 'allPoolsCount' })
    const n = Number(count)
    if (n === 0) { cacheSet(stakingCache, 'pools', [], STAKING_TTL); return res.json([]) }
    // Enumerate pool addresses
    const idxCalls = []
    for (let i = 0; i < n; i++) idxCalls.push({ address: POOL_FACTORY_ADDR, abi: POOL_FACTORY_ABI, functionName: 'allPools', args: [BigInt(i)] })
    const poolAddrs = (await client.multicall({ contracts: idxCalls, allowFailure: true }))
      .filter(r => r.status === 'success').map(r => r.result)
    if (poolAddrs.length === 0) { cacheSet(stakingCache, 'pools', [], STAKING_TTL); return res.json([]) }
    // Fetch pool metadata: token, totalWeightedStaked, burnVault, totalBurned
    const metaCalls = []
    for (const p of poolAddrs) {
      metaCalls.push({ address: p, abi: POOL_ABI_RO, functionName: 'token' })
      metaCalls.push({ address: p, abi: POOL_ABI_RO, functionName: 'totalWeightedStaked' })
      metaCalls.push({ address: p, abi: POOL_ABI_RO, functionName: 'burnVault' })
      metaCalls.push({ address: p, abi: POOL_ABI_RO, functionName: 'totalBurned' })
      metaCalls.push({ address: p, abi: POOL_ABI_RO, functionName: 'burnsToCreator' })
    }
    const meta = await client.multicall({ contracts: metaCalls, allowFailure: true })
    const out = []
    for (let i = 0; i < poolAddrs.length; i++) {
      const r = meta.slice(i*5, i*5+5)
      if (r[0].status !== 'success') continue
      const tokenAddr = r[0].result
      // Try to enrich from tokenIndex (name/symbol from launchpad metadata)
      const idx = tokenIndex.find(x => x.tokenAddress?.toLowerCase() === tokenAddr.toLowerCase())
      out.push({
        poolAddress: poolAddrs[i],
        tokenAddress: tokenAddr,
        symbol: idx?.symbol || 'TOKEN',
        name: idx?.name || tokenAddr.slice(0,8),
        totalWeightedStaked: r[1].status === 'success' ? r[1].result.toString() : '0',
        burnVault: r[2].status === 'success' ? r[2].result.toString() : '0',
        totalBurned: r[3].status === 'success' ? r[3].result.toString() : '0',
        burnsToCreator: r[4].status === 'success' ? r[4].result : false,
      })
    }
    cacheSet(stakingCache, 'pools', out, STAKING_TTL)
    res.json(out)
  } catch (e) { console.error('pools list err:', e.message); res.json([]) }
})

app.get('/api/staking/positions/:wallet', (_req, res) => res.json([])) // TODO: per-stake events scanner

app.get('/api/staking/hub', async (_req, res) => {
  const cached = cacheGet(stakingCache, 'hub'); if (cached) return res.json(cached)
  try {
    const calls = [
      { address: STAKING_HUB_ADDR, abi: HUB_RO, functionName: 'poolCount' },
      { address: STAKING_HUB_ADDR, abi: HUB_RO, functionName: 'totalVolumeCache' },
      { address: STAKING_HUB_ADDR, abi: HUB_RO, functionName: 'pendingMonshi' },
      { address: STAKING_HUB_ADDR, abi: HUB_RO, functionName: 'pendingOthers' },
    ]
    const r = await client.multicall({ contracts: calls, allowFailure: true })
    const totalDistributed = ((r[2].status==='success'?r[2].result:0n) + (r[3].status==='success'?r[3].result:0n)).toString()
    const out = {
      totalDistributed,
      poolCount: r[0].status === 'success' ? Number(r[0].result) : 0,
      totalStakers: 0, // TODO: count unique stakers from events
      hubAddress: STAKING_HUB_ADDR,
    }
    cacheSet(stakingCache, 'hub', out, STAKING_TTL)
    res.json(out)
  } catch (e) { console.error('hub err:', e.message); res.json({ totalDistributed:'0', poolCount:0, totalStakers:0 }) }
})

// ── Portfolio endpoints ──
app.get('/api/portfolio/:wallet/holdings', async (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json([])
  const cached = cacheGet(holdingsCache, w)
  if (cached) return res.json(cached)
  if (tokenIndex.length === 0) return res.json([])
  try {
    // Multicall balanceOf + priceWeiPerToken for every indexed token
    const calls = []
    for (const t of tokenIndex) {
      calls.push({ address: t.tokenAddress, abi: TOKEN_ABI, functionName: 'balanceOf', args: [w] })
      calls.push({ address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'priceWeiPerToken' })
    }
    const results = await client.multicall({ contracts: calls, allowFailure: true })
    const out = []
    for (let i = 0; i < tokenIndex.length; i++) {
      const t = tokenIndex[i]
      const balRes = results[i*2], priceRes = results[i*2+1]
      if (balRes.status !== 'success' || priceRes.status !== 'success') continue
      const balance = balRes.result, price = priceRes.result
      if (!balance || balance === 0n) continue
      const valueMon = Number(balance) * Number(price) / 1e18 / 1e18
      // Per-token P&L from this wallet's trades on this curve
      const myTrades = (tradeCache[t.curveAddress?.toLowerCase()] || []).filter(x => x.addr?.toLowerCase() === w)
      const pnl = fifoPnL(myTrades)
      const currentPrice = Number(price) / 1e18
      const tokQty = Number(balance) / 1e18
      const unrealizedPnL = (tokQty * currentPrice) - pnl.costBasisRemaining
      out.push({
        tokenAddress: t.tokenAddress,
        curveAddress: t.curveAddress,
        symbol: t.symbol,
        name: t.name,
        balance: balance.toString(),
        valueMon,
        costBasis: (pnl.costBasisRemaining * 1e18).toString(),
        realizedPnL: pnl.realized,
        unrealizedPnL,
      })
    }
    out.sort((a, b) => b.valueMon - a.valueMon)
    cacheSet(holdingsCache, w, out, HOLDINGS_TTL)
    res.json(out)
  } catch (e) {
    console.error('holdings error:', e.message)
    res.json([])
  }
})

app.get('/api/portfolio/:wallet/trades', (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json([])
  const limit = Math.min(parseInt(req.query.limit) || 100, 500)
  const all = []
  for (const [curve, trades] of Object.entries(tradeCache)) {
    const tok = tokenIndex.find(t => t.curveAddress?.toLowerCase() === curve)
    for (const t of trades) {
      if (t.addr?.toLowerCase() !== w) continue
      all.push({
        timestamp: t.ts,
        type: t.type,
        monAmount: (t.volume * 1e18).toString(),
        price: t.price,
        tokenAddress: tok?.tokenAddress || null,
        symbol: tok?.symbol || '???',
      })
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp)
  // Realized P&L per token, summed
  let realizedPnL = 0
  const byCurve = {}
  for (const [curve, trades] of Object.entries(tradeCache)) {
    const myTrades = trades.filter(t => t.addr?.toLowerCase() === w)
    if (myTrades.length === 0) continue
    realizedPnL += fifoPnL(myTrades).realized
  }
  // Attach realizedPnL as a field on the latest trade entry so portfolio.js sum works
  if (all.length > 0) all[0].realizedPnL = realizedPnL * 1e18
  res.json(all.slice(0, limit))
})

app.get('/api/portfolio/:wallet/achievements', (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json([])
  const earned = []
  // first_buy
  const hasAnyTrade = Object.values(tradeCache).some(trades => trades.some(t => t.addr?.toLowerCase() === w && t.type === 'buy'))
  if (hasAnyTrade) earned.push({ id: 'first_buy', earnedAt: Date.now() })
  // creator
  if (tokenIndex.some(t => t.creator?.toLowerCase() === w)) earned.push({ id: 'creator', earnedAt: Date.now() })
  // graduate
  if (tokenIndex.some(t => t.creator?.toLowerCase() === w && t.graduated)) earned.push({ id: 'graduate', earnedAt: Date.now() })
  // whale / royalty handled client-side from MONSHI balance — leave to frontend
  res.json(earned)
})

app.get('/api/profile/:wallet', (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json(null)
  res.json({ tokensLaunched: 0, totalVolume: 0, activeStakes: 0, referralCount: 0 })
})

// ── Leaderboard endpoints ──
app.get('/api/leaderboard/creators', async (_req, res) => {
  const cached = cacheGet(leaderboardCache, 'creators')
  if (cached) return res.json(cached)
  if (tokenIndex.length === 0) return res.json([])
  try {
    // Multicall totalCreatorFees per curve — exact source of truth
    const calls = tokenIndex.map(t => ({
      address: t.curveAddress, abi: CURVE_ABI_SHORT, functionName: 'totalCreatorFees'
    }))
    const results = await client.multicall({ contracts: calls, allowFailure: true })
    const byCreator = new Map()
    for (let i = 0; i < tokenIndex.length; i++) {
      const t = tokenIndex[i]
      const c = t.creator?.toLowerCase()
      if (!c) continue
      const earned = results[i].status === 'success' ? Number(results[i].result) / 1e18 : 0
      const trades = tradeCache[t.curveAddress?.toLowerCase()] || []
      const volume = trades.reduce((s, x) => s + x.volume, 0)
      const cur = byCreator.get(c) || { wallet: c, tokenCount: 0, totalVolume: 0, totalEarned: 0 }
      cur.tokenCount++
      cur.totalVolume += volume
      cur.totalEarned += earned
      byCreator.set(c, cur)
    }
    const out = [...byCreator.values()]
      .map(x => ({ ...x, totalVolume: (x.totalVolume * 1e18).toString(), totalEarned: (x.totalEarned * 1e18).toString() }))
      .sort((a, b) => Number(BigInt(b.totalEarned) - BigInt(a.totalEarned)))
      .slice(0, 50)
    cacheSet(leaderboardCache, 'creators', out, LEADERBOARD_TTL)
    res.json(out)
  } catch (e) {
    console.error('creators leaderboard error:', e.message)
    res.json([])
  }
})

app.get('/api/leaderboard/stakers', (_req, res) => res.json([])) // TODO: post V2 staking deploy

app.get('/api/leaderboard/traders', (_req, res) => {
  const cached = cacheGet(leaderboardCache, 'traders')
  if (cached) return res.json(cached)
  const byTrader = new Map()
  for (const trades of Object.values(tradeCache)) {
    for (const t of trades) {
      const w = t.addr?.toLowerCase()
      if (!w) continue
      const cur = byTrader.get(w) || { wallet: w, tradeCount: 0, volume: 0, buyVol: 0, sellVol: 0 }
      cur.tradeCount++
      cur.volume += t.volume
      if (t.type === 'buy') cur.buyVol += t.volume; else cur.sellVol += t.volume
      byTrader.set(w, cur)
    }
  }
  const out = [...byTrader.values()]
    .map(({ buyVol, sellVol, ...rest }) => ({
      ...rest,
      volume: (rest.volume * 1e18).toString(),
      pnl: ((sellVol - buyVol) * 1e18).toString(),  // naive global net flow; FIFO per-token would be heavier
    }))
    .sort((a, b) => Number(BigInt(b.volume) - BigInt(a.volume)))
    .slice(0, 50)
  cacheSet(leaderboardCache, 'traders', out, LEADERBOARD_TTL)
  res.json(out)
})

// ── Trades + holders for token detail ──
app.get('/api/token/:address/trades', (req, res) => {
  const a = req.params.address?.toLowerCase()
  if (!a) return res.json([])
  // TODO: hook to indexed trade events
  res.json([])
})

app.get('/api/token/:address/holders', (req, res) => {
  const a = req.params.address?.toLowerCase()
  if (!a) return res.json([])
  // TODO: scan transfer events to build holder list
  res.json([])
})

app.get('/api/token/:address/candles', (req, res) => {
  const a = req.params.address?.toLowerCase()
  if (!a) return res.json([])
  // TODO: aggregate trades into OHLC candles
  res.json([])
})

app.get('/api/token/:address/meta', (req, res) => {
  const a = req.params.address?.toLowerCase()
  if (!a) return res.json(null)
  const db = readDB(); const meta = db.tokens && db.tokens[a]
  res.json(meta || null)
})

app.get('/api/token/:address', (req, res) => {
  const a = req.params.address?.toLowerCase()
  if (!a) return res.json(null)
  // Find from token cache  
  const t = tokenIndex.find(t => t.tokenAddress?.toLowerCase() === a)
  res.json(t || null)
})


server.listen(PORT,()=>console.log(`MonPad server on :${PORT}`))
