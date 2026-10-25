// Hosted MCP server (Streamable HTTP, stateless JSON). Add https://www.monpad.net/api/mcp as a connector — no install, no keys.
import type { NextApiRequest, NextApiResponse } from 'next';
import { TOOLS } from '@/lib/mcp/tools';

const PROTOCOL = '2025-03-26';
const SUPPORTED = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

async function handle(msg: Rpc): Promise<object | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (msg.id === undefined) return null; // notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion || '');
      return ok({
        protocolVersion: SUPPORTED.has(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'monpad', version: '1.0.0' },
        instructions: 'Monpad is a fair-launch pad on Monad. Read tools show coins and prices. Buy, sell and launch tools return a link; the user confirms in their own wallet.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const data = await tool.run(msg.params?.arguments ?? {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e: any) {
        return ok({ isError: true, content: [{ type: 'text', text: String(e?.message || 'Tool failed').slice(0, 300) }] });
      }
    }
    default: return err(-32601, `Method not found: ${msg.method}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).json({ error: 'POST JSON-RPC to this URL. Add it as an MCP connector.' }); }
  const body = req.body;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m)))).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  const out = await handle(body as Rpc);
  return out ? res.status(200).json(out) : res.status(202).end();
}
