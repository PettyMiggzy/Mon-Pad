const express = require('express')
const multer = require('multer')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { WebSocketServer } = require('ws')
const { createPublicClient, http: viemHttp, parseAbiItem } = require('viem')

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
const PORT = 3001

const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz'
const START_BLOCK = 66664884n
const monadChain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC] } } }
const client = createPublicClient({ chain: monadChain, transport: viemHttp(MONAD_RPC) })

app.use(cors({ origin: '*' }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || '0xc1dF3c842C2e1Fb76656A8415D66B72A101366Bc'
const LAUNCHED_EVENT = parseAbiItem('event Launched(address indexed token, address indexed curve, address indexed graduator, address creator, address referrer, uint256 devAmt)')
const TOKEN_ABI = [
  { name:'name', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
  { name:'symbol', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'string'}] },
  ]
const CURVE_ABI_SHORT = [
  { name:'graduated', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'bool'}] },
  { name:'monRaisedNet', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'capMon', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'bondedBps', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  { name:'priceWeiPerToken', type:'function', stateMutability:'view', inputs:[], outputs:[{name:'',type:'uint256'}] },
  ]

let tokenIndex = []
let lastIndexedBlock = START_BLOCK

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
    const { tokenAddress, curveAddress, name, symbol, desc, twitter, website, bannerUrl, pfpUrl, creator } = req.body
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
    if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
    if (!address) return res.status(400).json({ error: 'address required' })
    const list = readBlocklist(), addr = address.toLowerCase()
    if (unhide) { writeBlocklist(list.filter(a => a !== addr)); return res.json({ ok: true, action: 'unhidden', address: addr }) }
    if (!list.includes(addr)) { list.push(addr); writeBlocklist(list) }
    res.json({ ok: true, action: 'hidden', address: addr })
})

app.post('/api/admin/reindex', (req, res) => {
    const { secret } = req.body
    if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
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
    if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
    const key = curve.toLowerCase()
    if (!tradeCache[key]) tradeCache[key] = []
        tradeCache[key].push(trade); tradeCache[key].sort((a,b) => a.ts-b.ts); saveTradeCache()
    res.json({ ok: true, total: tradeCache[key].length })
})
app.post('/api/admin/clear-cache', (req, res) => {
    const { secret, curve } = req.body
    if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
    tradeCache[curve.toLowerCase()] = []; saveTradeCache(); res.json({ ok: true })
})
app.post('/api/admin/seed-blocks', (req, res) => {
    const { secret, blocks } = req.body
    if (secret !== 'monpad_admin_2024') return res.status(401).json({ error: 'unauthorized' })
    Object.entries(blocks).forEach(([k,v]) => { tradeLastBlock[k.toLowerCase()] = BigInt(v) }); saveTradeBlocks()
    res.json({ ok: true })
})

app.get('/api/live', (_, res) => res.json({ live: Object.keys(liveRooms).filter(a => liveRooms[a]) }))
app.get('/api/live/:token', (req, res) => {
    const room = liveRooms[req.params.token.toLowerCase()]
    if (!room) return res.json({ live: false })
    res.json({ live: true, roomId: room.roomId, viewers: room.viewers.size, startedAt: room.startedAt, playbackId: room.playbackId||null })
})

const LIVEPEER_KEY = process.env.LIVEPEER_API_KEY || '8707accb-8b1c-4ec0-b82c-9bfb9d9015e4'
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


// ── V2 Staking endpoints (stubs until V2 deployed) ──
app.get('/api/staking/pool/:tokenAddress', (req, res) => {
  // Returns { pool: '0x...' } if pool exists for this token
  // TODO: read from PoolFactory contract OR from local cache once V2 is deployed
  res.json({ pool: null })
})

app.get('/api/staking/pools', (_req, res) => {
  // TODO: enumerate from PoolFactory.allPools when deployed
  res.json([])
})

app.get('/api/staking/positions/:wallet', (req, res) => {
  // TODO: scan stake events for wallet
  res.json([])
})

app.get('/api/staking/hub', (_req, res) => {
  // TODO: read totals from StakingHub when deployed
  res.json({ totalDistributed: '0', totalStakers: 0, poolCount: 0 })
})

// ── Portfolio endpoints ──
app.get('/api/portfolio/:wallet/holdings', (req, res) => {
  // Wallet's token balances across all MonPad tokens with values
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json([])
  // TODO: aggregate from token cache
  res.json([])
})

app.get('/api/portfolio/:wallet/trades', (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json([])
  // TODO: filter trades by user
  res.json([])
})

app.get('/api/portfolio/:wallet/achievements', (req, res) => {
  res.json([])
})

app.get('/api/profile/:wallet', (req, res) => {
  const w = req.params.wallet?.toLowerCase()
  if (!w) return res.json(null)
  res.json({ tokensLaunched: 0, totalVolume: 0, activeStakes: 0, referralCount: 0 })
})

// ── Leaderboard endpoints ──
app.get('/api/leaderboard/creators', (_req, res) => res.json([]))
app.get('/api/leaderboard/stakers', (_req, res) => res.json([]))
app.get('/api/leaderboard/traders', (_req, res) => res.json([]))

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
