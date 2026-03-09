import { useState, useEffect, useRef } from 'react'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

// ─────────────────────────────────────────────────────────────
// LiveStream — drop into token detail page
//
// Props:
//   tokenAddress  : string
//   isCreator     : bool
//   userAddr      : string | undefined
//   tokenName     : string
//   tokenSymbol   : string
// ─────────────────────────────────────────────────────────────

export default function LiveStream({ tokenAddress, isCreator, userAddr, tokenName, tokenSymbol }) {
  const [status, setStatus]     = useState('idle')   // idle | available | starting | live | watching
  const [roomId, setRoomId]     = useState(null)
  const [viewerCount, setViewers] = useState(0)
  const [isChecking, setChecking] = useState(true)
  const [chatMsgs, setChat]     = useState([])
  const [chatInput, setChatInput] = useState('')
  const localVideoRef  = useRef(null)
  const streamRef      = useRef(null)
  const wsRef          = useRef(null)
  const pollRef        = useRef(null)
  const statusRef      = useRef('idle') // mirrors status state — avoids stale closures in interval

  function setStatusBoth(s) { statusRef.current = s; setStatus(s) }

  // on mount: check if this token has an active live room
  useEffect(() => {
    if (!tokenAddress || !SERVER) { setChecking(false); return }
    checkLive()
    pollRef.current = setInterval(checkLive, 8000)
    return () => { clearInterval(pollRef.current); cleanup() }
  }, [tokenAddress])

  async function checkLive() {
    try {
      const res = await fetch(`${SERVER}/api/live/${tokenAddress}`)
      if (!res.ok) { setChecking(false); return }
      const data = await res.json()
      // use ref — not state — to avoid stale closure from the interval
      const currentStatus = statusRef.current
      if (data.live && currentStatus === 'idle') {
        setRoomId(data.roomId)
        setViewers(data.viewers || 0)
        setStatusBoth('available')
      } else if (!data.live && currentStatus === 'available') {
        setStatusBoth('idle')
        setRoomId(null)
      }
    } catch {}
    setChecking(false)
  }

  // ── GO LIVE (creator) ──────────────────────────────────────
  async function goLive() {
    if (!userAddr) return
    setStatusBoth('starting')
    try {
      // 1. register room on server
      const res = await fetch(`${SERVER}/api/live/${tokenAddress}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: userAddr, tokenName, tokenSymbol }),
      })
      const { roomId: rid } = await res.json()
      setRoomId(rid)

      // 2. get camera + mic
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.muted = true
        localVideoRef.current.play()
      }

      setStatusBoth('live')
      openWS(rid, 'host')
    } catch (e) {
      console.error('goLive error:', e)
      setStatusBoth('idle')
    }
  }

  // ── WATCH LIVE (everyone) ──────────────────────────────────
  async function watchLive() {
    if (!roomId) return
    setStatusBoth('watching')
    openWS(roomId, 'viewer')
  }

  // ── WEBSOCKET for viewer count + chat ─────────────────────
  function openWS(rid, role) {
    if (typeof window === 'undefined') return
    const wsUrl = SERVER.replace('http://', 'ws://').replace('https://', 'wss://')
    const ws = new WebSocket(`${wsUrl}/ws/live/${rid}?role=${role}`)
    wsRef.current = ws
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'viewers') setViewers(msg.count)
        if (msg.type === 'chat')    setChat(p => [...p.slice(-49), { user: msg.user, text: msg.text, ts: Date.now() }])
        if (msg.type === 'ended')   { setStatusBoth('idle'); cleanup() }
      } catch {}
    }
    ws.onerror = () => {}
    ws.onclose = () => {}
  }

  function sendChat() {
    if (!chatInput.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'chat', user: userAddr ? userAddr.slice(0,8)+'…' : 'anon', text: chatInput.trim() }))
    setChat(p => [...p.slice(-49), { user: 'You', text: chatInput.trim(), ts: Date.now() }])
    setChatInput('')
  }

  // ── END STREAM ─────────────────────────────────────────────
  async function endStream() {
    if (SERVER && roomId) {
      fetch(`${SERVER}/api/live/${tokenAddress}/end`, { method: 'POST' }).catch(() => {})
    }
    wsRef.current?.send(JSON.stringify({ type: 'end' }))
    cleanup()
    setStatusBoth('idle')
    setRoomId(null)
  }

  function cleanup() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }

  // ── IDLE: no stream, show Go Live or nothing ───────────────
  if (isChecking) return null

  if (status === 'idle' && !isCreator) return null

  if (status === 'idle' && isCreator) {
    return (
      <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'16px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:'rgba(239,68,68,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>📡</div>
          <div>
            <div style={{ fontSize:14, fontWeight:800 }}>Go Live</div>
            <div style={{ fontSize:11, color:'var(--t3)' }}>Stream to your holders in real-time</div>
          </div>
        </div>
        <button onClick={goLive}
          style={{ width:'100%', padding:'12px 0', background:'#ef4444', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:'var(--sans)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          <span style={{ width:8, height:8, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
          Start Live Stream
        </button>
      </div>
    )
  }

  if (status === 'available') {
    return (
      <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:14, padding:'16px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:8, height:8, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
            <span style={{ fontSize:14, fontWeight:800, color:'#ef4444' }}>LIVE NOW</span>
            <span style={{ fontSize:12, color:'var(--t3)' }}>· {viewerCount} watching</span>
          </div>
          <div style={{ fontSize:12, color:'var(--t3)' }}>📡 {tokenName}</div>
        </div>
        <button onClick={watchLive}
          style={{ width:'100%', padding:'12px 0', background:'#ef4444', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:'var(--sans)' }}>
          👁 Watch Live
        </button>
      </div>
    )
  }

  if (status === 'starting') {
    return (
      <div style={{ margin:'0 14px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'20px 18px', textAlign:'center' }}>
        <div style={{ fontSize:13, color:'var(--t3)' }}>Starting stream…</div>
      </div>
    )
  }

  // ── LIVE or WATCHING: show video + chat ───────────────────
  return (
    <div style={{ margin:'0 14px 16px', border:'1px solid rgba(239,68,68,0.3)', borderRadius:14, overflow:'hidden', background:'#0a0a10' }}>
      {/* header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'rgba(239,68,68,0.08)', borderBottom:'1px solid rgba(239,68,68,0.15)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:8, height:8, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
          <span style={{ fontSize:13, fontWeight:800, color:'#ef4444' }}>LIVE</span>
          <span style={{ fontSize:12, color:'var(--t3)' }}>· {viewerCount} watching</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700 }}>{tokenName}</span>
          {isCreator && status === 'live' && (
            <button onClick={endStream}
              style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.3)', borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'var(--sans)' }}>
              End Stream
            </button>
          )}
        </div>
      </div>

      {/* video */}
      <div style={{ position:'relative', background:'#000', aspectRatio:'16/9' }}>
        <video
          ref={localVideoRef}
          autoPlay playsInline muted={status === 'live'}
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
        />
        {status === 'watching' && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.2)', fontSize:13 }}>
            Connecting to stream…
          </div>
        )}
        {/* token badge overlay */}
        <div style={{ position:'absolute', bottom:10, left:10, display:'flex', alignItems:'center', gap:6, background:'rgba(0,0,0,0.6)', borderRadius:8, padding:'5px 10px' }}>
          <div style={{ width:6, height:6, background:'#ef4444', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
          <span style={{ fontSize:11, fontWeight:700, color:'white' }}>${tokenSymbol}</span>
        </div>
      </div>

      {/* chat */}
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
            onKeyDown={e => e.key === 'Enter' && sendChat()}
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
    </div>
  )
}