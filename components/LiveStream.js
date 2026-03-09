import { useState, useEffect, useRef } from 'react'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function LiveStream({ tokenAddress, isCreator, userAddr, tokenName, tokenSymbol }) {
  const [status, setStatus]       = useState('idle')   // idle | starting | live | available | watching
  const [roomId, setRoomId]       = useState(null)
  const [playbackId, setPlaybackId] = useState(null)
  const [streamKey, setStreamKey] = useState(null)
  const [rtmpUrl, setRtmpUrl]     = useState(null)
  const [viewerCount, setViewers] = useState(0)
  const [isChecking, setChecking] = useState(true)
  const [chatMsgs, setChat]       = useState([])
  const [chatInput, setChatInput] = useState('')
  const [copied, setCopied]       = useState('')
  const wsRef   = useRef(null)
  const pollRef = useRef(null)
  const statusRef = useRef('idle')

  function setStatusBoth(s) { statusRef.current = s; setStatus(s) }

  useEffect(() => {
    if (!tokenAddress || !SERVER) { setChecking(false); return }
    checkLive()
    pollRef.current = setInterval(checkLive, 8000)
    return () => { clearInterval(pollRef.current); wsRef.current?.close() }
  }, [tokenAddress])

  async function checkLive() {
    try {
      const res  = await fetch(`${SERVER}/api/live/${tokenAddress}`)
      const data = await res.json()
      const cur  = statusRef.current
      if (data.live && (cur === 'idle')) {
        setRoomId(data.roomId)
        setPlaybackId(data.playbackId || null)
        setViewers(data.viewers || 0)
        setStatusBoth('available')
      } else if (!data.live && cur === 'available') {
        setStatusBoth('idle')
        setRoomId(null)
        setPlaybackId(null)
      }
    } catch {}
    setChecking(false)
  }

  async function goLive() {
    if (!userAddr) return
    setStatusBoth('starting')
    try {
      const res  = await fetch(`${SERVER}/api/live/${tokenAddress}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: userAddr, tokenName, tokenSymbol }),
      })
      const data = await res.json()
      setRoomId(data.roomId)
      setStreamKey(data.streamKey || null)
      setRtmpUrl(data.rtmpUrl || null)
      setPlaybackId(data.playbackId || null)
      setStatusBoth('live')
      openWS(data.roomId, 'host')
    } catch (e) {
      console.error('goLive error:', e)
      setStatusBoth('idle')
    }
  }

  async function watchLive() {
    if (!roomId) return
    setStatusBoth('watching')
    openWS(roomId, 'viewer')
  }

  function openWS(rid, role) {
    if (typeof window === 'undefined') return
    const wsUrl = SERVER.replace('http://', 'ws://').replace('https://', 'wss://')
    const ws = new WebSocket(`${wsUrl}/ws/live/${rid}?role=${role}`)
    wsRef.current = ws
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'viewers') setViewers(msg.count)
        if (msg.type === 'chat')    setChat(p => [...p.slice(-49), { user: msg.user, text: msg.text }])
        if (msg.type === 'ended')   { setStatusBoth('idle'); setPlaybackId(null) }
      } catch {}
    }
  }

  function sendChat() {
    if (!chatInput.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type:'chat', user: userAddr ? userAddr.slice(0,8)+'…' : 'anon', text: chatInput.trim() }))
    setChat(p => [...p.slice(-49), { user:'You', text: chatInput.trim() }])
    setChatInput('')
  }

  async function endStream() {
    fetch(`${SERVER}/api/live/${tokenAddress}/end`, { method:'POST' }).catch(()=>{})
    wsRef.current?.send(JSON.stringify({ type:'end' }))
    wsRef.current?.close()
    setStatusBoth('idle')
    setRoomId(null); setStreamKey(null); setRtmpUrl(null); setPlaybackId(null)
  }

  function copy(text, label) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }

  if (isChecking) return null
  if (status === 'idle' && !isCreator) return null

  // ── IDLE: creator sees Go Live button ─────────────────────
  if (status === 'idle' && isCreator) return (
    <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'16px 18px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:'rgba(239,68,68,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📡</div>
        <div>
          <div style={{ fontSize:14, fontWeight:800 }}>Go Live</div>
          <div style={{ fontSize:11, color:'var(--t3)' }}>Stream to your holders via OBS or phone</div>
        </div>
      </div>
      <button onClick={goLive}
        style={{ width:'100%', padding:'11px 0', background:'#ef4444', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:'var(--sans)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        <span style={{ width:7, height:7, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
        Start Live Stream
      </button>
    </div>
  )

  // ── STARTING ──────────────────────────────────────────────
  if (status === 'starting') return (
    <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'20px', textAlign:'center' }}>
      <div style={{ fontSize:13, color:'var(--t3)' }}>Creating stream…</div>
    </div>
  )

  // ── LIVE: creator sees OBS instructions + stream key ──────
  if (status === 'live') return (
    <div style={{ margin:'0 14px 16px', border:'1px solid rgba(239,68,68,0.3)', borderRadius:14, overflow:'hidden', background:'#0a0a10' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'rgba(239,68,68,0.1)', borderBottom:'1px solid rgba(239,68,68,0.15)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:8, height:8, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite', display:'inline-block' }} />
          <span style={{ fontSize:13, fontWeight:800, color:'#ef4444' }}>YOU ARE LIVE</span>
          <span style={{ fontSize:12, color:'var(--t3)' }}>· {viewerCount} watching</span>
        </div>
        <button onClick={endStream}
          style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.3)', borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'var(--sans)' }}>
          End Stream
        </button>
      </div>

      <div style={{ padding:'14px 16px' }}>
        <div style={{ fontSize:12, color:'var(--t3)', marginBottom:10 }}>Use OBS or any RTMP app to stream. Copy these settings:</div>

        {rtmpUrl && (
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:11, color:'var(--t3)', marginBottom:4, fontWeight:600 }}>RTMP URL</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ flex:1, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:8, padding:'8px 10px', fontSize:11, fontFamily:'var(--mono)', color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                rtmp://rtmp.livepeer.com/live
              </div>
              <button onClick={() => copy('rtmp://rtmp.livepeer.com/live', 'rtmp')}
                style={{ background:'var(--p)', color:'white', border:'none', borderRadius:8, padding:'8px 12px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'var(--sans)', flexShrink:0 }}>
                {copied==='rtmp' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {streamKey && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:'var(--t3)', marginBottom:4, fontWeight:600 }}>STREAM KEY</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ flex:1, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:8, padding:'8px 10px', fontSize:11, fontFamily:'var(--mono)', color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {streamKey}
              </div>
              <button onClick={() => copy(streamKey, 'key')}
                style={{ background:'var(--p)', color:'white', border:'none', borderRadius:8, padding:'8px 12px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'var(--sans)', flexShrink:0 }}>
                {copied==='key' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div style={{ background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.15)', borderRadius:9, padding:'10px 12px', fontSize:11, color:'var(--t3)', lineHeight:1.6 }}>
          💡 Open OBS → Settings → Stream → Service: Custom → paste the RTMP URL and Stream Key above → Start Streaming
        </div>
      </div>

      <ChatBox chatMsgs={chatMsgs} chatInput={chatInput} setChatInput={setChatInput} sendChat={sendChat} userAddr={userAddr} />
    </div>
  )

  // ── AVAILABLE: viewer sees Watch button ───────────────────
  if (status === 'available') return (
    <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:14, padding:'16px 18px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:8, height:8, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite', display:'inline-block' }} />
          <span style={{ fontSize:14, fontWeight:800, color:'#ef4444' }}>LIVE NOW</span>
          <span style={{ fontSize:12, color:'var(--t3)' }}>· {viewerCount} watching</span>
        </div>
      </div>
      <button onClick={watchLive}
        style={{ width:'100%', padding:'11px 0', background:'#ef4444', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:'var(--sans)' }}>
        👁 Watch Live
      </button>
    </div>
  )

  // ── WATCHING: show Livepeer player + chat ─────────────────
  if (status === 'watching') return (
    <div style={{ margin:'0 14px 16px', border:'1px solid rgba(239,68,68,0.3)', borderRadius:14, overflow:'hidden', background:'#0a0a10' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'rgba(239,68,68,0.08)', borderBottom:'1px solid rgba(239,68,68,0.15)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:8, height:8, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite', display:'inline-block' }} />
          <span style={{ fontSize:13, fontWeight:800, color:'#ef4444' }}>LIVE</span>
          <span style={{ fontSize:12, color:'var(--t3)' }}>· {viewerCount} watching</span>
        </div>
        <span style={{ fontSize:12, fontWeight:700 }}>${tokenSymbol}</span>
      </div>

      {/* Livepeer player via iframe embed */}
      <div style={{ position:'relative', background:'#000', aspectRatio:'16/9' }}>
        {playbackId ? (
          <iframe
            src={`https://lvpr.tv/?v=${playbackId}`}
            allow="autoplay; fullscreen"
            allowFullScreen
            style={{ width:'100%', height:'100%', border:'none', display:'block' }}
          />
        ) : (
          <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.3)', fontSize:13 }}>
            Connecting to stream…
          </div>
        )}
      </div>

      <ChatBox chatMsgs={chatMsgs} chatInput={chatInput} setChatInput={setChatInput} sendChat={sendChat} userAddr={userAddr} />
    </div>
  )

  return null
}

function ChatBox({ chatMsgs, chatInput, setChatInput, sendChat, userAddr }) {
  return (
    <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ height:120, overflowY:'auto', padding:'8px 12px', display:'flex', flexDirection:'column', gap:4 }}>
        {chatMsgs.length === 0 && (
          <div style={{ color:'var(--t3)', fontSize:12, textAlign:'center', marginTop:20 }}>Say something…</div>
        )}
        {chatMsgs.map((m,i) => (
          <div key={i} style={{ fontSize:12, lineHeight:1.4 }}>
            <span style={{ fontWeight:700, color:'var(--p2)', fontFamily:'var(--mono)', marginRight:5 }}>{m.user}</span>
            <span style={{ color:'var(--t2)' }}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:6, padding:'8px 12px', borderTop:'1px solid rgba(255,255,255,0.05)' }}>
        <input
          value={chatInput} onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key==='Enter' && sendChat()}
          placeholder={userAddr ? 'Chat…' : 'Connect wallet to chat'}
          disabled={!userAddr}
          style={{ flex:1, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--t1)', fontFamily:'var(--sans)', outline:'none' }}
        />
        <button onClick={sendChat} disabled={!userAddr || !chatInput.trim()}
          style={{ background:'var(--p)', color:'white', border:'none', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'var(--sans)', opacity:(!userAddr||!chatInput.trim())?0.4:1 }}>
          Send
        </button>
      </div>
    </div>
  )
}