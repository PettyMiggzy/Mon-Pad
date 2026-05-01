export const config = { api: { bodyParser: false, responseLimit: false } }

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'https://api.monpad.net'

export default async function handler(req, res) {
  // Block admin/upload paths — these must hit the backend directly with proper auth, never via the public proxy
  const blocked = ['admin/', 'admin', '/admin', 'upload/'];
  const requestPath = (req.query.path || []).join('/');
  if (blocked.some(b => requestPath.startsWith(b) || requestPath.includes(b))) {
    return res.status(404).end();
  }

  const path = req.url.replace('/api/proxy', '')

  try {
    const headers = {}
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

    // read raw body for uploads
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await getRawBody(req)

    const upstream = await fetch(`${SERVER}${path}`, {
      method: req.method,
      headers,
      body,
    })

    // forward content-type
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(upstream.status)

    const buf = await upstream.arrayBuffer()
    res.send(Buffer.from(buf))
  } catch (e) {
    console.error('proxy error', e)
    res.status(502).json({ error: 'proxy error' })
  }
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}