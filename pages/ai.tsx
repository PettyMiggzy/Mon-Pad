import Link from 'next/link';
import Head from 'next/head';
import { Bot, MessageCircle, ShieldAlert, Terminal } from 'lucide-react';

const TOOLS = [
  { name: 'monpad_list_launches', kind: 'read', body: 'Recent tokens and their curves.' },
  { name: 'monpad_get_curve', kind: 'read', body: 'Price, amount raised, graduation status.' },
  { name: 'monpad_get_spec', kind: 'read', body: 'Fees, platform wallet and bot policy.' },
  { name: 'monpad_get_monshi_burn', kind: 'read', body: 'Live MONSHI burned.' },
  { name: 'monpad_launch_token', kind: 'write', body: 'Deploy a token, with an optional dev buy in the same transaction.' },
  { name: 'monpad_buy', kind: 'write', body: 'Buy a token with MON.' },
  { name: 'monpad_sell', kind: 'write', body: 'Sell a token for MON.' },
];

const CONFIG = `{
  "mcpServers": {
    "monpad": {
      "command": "npx",
      "args": ["-y", "@monpad/mcp"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_PRIVATE_KEY": "<key of a small burner wallet>"
      }
    }
  }
}`;

export default function AiPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <Head>
        <title>Trade and launch with your AI | Monpad</title>
        <meta key="description" name="description" content="Connect Claude, Cursor or any MCP-compatible AI to Monpad. Ask it to find tokens, launch one or trade on Monad." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/ai" />
      </Head>

      <header className="text-center mb-12">
        <div className="inline-flex items-center gap-2 text-sm text-white/60 mb-3"><Bot size={16} /> Agent-native launchpad</div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Trade and launch with your AI</h1>
        <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          Monpad speaks the Model Context Protocol. Plug in Claude, Cursor or any MCP-compatible assistant and tell it what you want in plain English.
        </p>
      </header>

      <section className="grid md:grid-cols-2 gap-6 mb-12">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <MessageCircle className="mb-3" size={22} />
          <h2 className="text-xl font-semibold text-white mb-2">Launch by chat</h2>
          <p className="text-white/70 mb-4">Describe your coin in a sentence. Monpad drafts the name, ticker, logo and a 3D character, then you confirm and launch.</p>
          <Link href="/chat" className="inline-block rounded-xl bg-purple-600 px-4 py-2 font-semibold text-white">Open Chat</Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <Terminal className="mb-3" size={22} />
          <h2 className="text-xl font-semibold text-white mb-2">Bring your own AI</h2>
          <p className="text-white/70">Add the Monpad MCP server to your assistant. Then ask things like “what launched in the last hour?”, “launch a coin called Milk Baron”, or “buy 5 MON of the top token”.</p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-3">Set it up</h2>
        <p className="text-white/70 mb-3">Add this to your assistant&apos;s MCP settings (Claude Desktop, Cursor, and others use the same format):</p>
        <pre className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/90 overflow-x-auto">{CONFIG}</pre>
        <p className="text-white/60 text-sm mt-3">The server runs on your machine. Your key never leaves it and Monpad never sees it. Read-only tools work without a key.</p>
      </section>

      <section className="mb-12 rounded-2xl border border-yellow-400/30 bg-yellow-400/5 p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-white mb-2"><ShieldAlert size={20} /> Use a burner wallet</h2>
        <ul className="list-disc pl-5 space-y-1 text-white/75">
          <li>Create a separate wallet just for your AI and fund it with only what you are willing to lose.</li>
          <li>Never give an AI your main wallet key.</li>
          <li>AI assistants make mistakes. Check what it is about to do before you approve any trade.</li>
          <li>Nothing here is financial advice. Tokens can go to zero.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-white mb-4">Tools your AI gets</h2>
        <div className="divide-y divide-white/10 rounded-2xl border border-white/10 overflow-hidden">
          {TOOLS.map((t) => (
            <div key={t.name} className="flex items-start justify-between gap-4 p-4">
              <div>
                <code className="text-purple-300">{t.name}</code>
                <p className="text-white/65 text-sm mt-1">{t.body}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${t.kind === 'write' ? 'bg-red-500/20 text-red-200' : 'bg-green-500/20 text-green-200'}`}>{t.kind}</span>
            </div>
          ))}
        </div>
        <p className="text-white/50 text-sm mt-3">Also available over HTTP: <Link href="/api/v1/spec" className="underline">/api/v1/spec</Link>. More in the <Link href="/docs#agents" className="underline">docs</Link>.</p>
      </section>
    </div>
  );
}
