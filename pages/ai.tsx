import Link from 'next/link';
import Head from 'next/head';
import { useState } from 'react';
import { Check, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { CopyButton } from '@/components/ui/CopyButton';

const LINK = 'https://www.monpad.net/api/mcp';
const cursorLink = () => `cursor://anysphere.cursor-deeplink/mcp/install?name=monpad&config=${btoa(JSON.stringify({ url: LINK }))}`;
const vscodeLink = () => `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'monpad', type: 'http', url: LINK }))}`;
const CLAUDE_CODE = `claude mcp add --transport http monpad ${LINK}`;

type App = { id: string; name: string; steps: string[]; action?: 'cursor' | 'vscode'; copy: { text: string; label: string }; note?: string };
const APPS: App[] = [
  { id: 'claude', name: 'Claude', copy: { text: LINK, label: 'Copy the link' }, steps: ['Open Claude and go to **Settings → Connectors**.', 'Press **Add custom connector**.', 'Paste the link, name it Monpad, and save.', 'Start a new chat and ask a question below.'], note: 'Custom connectors need a paid Claude plan.' },
  { id: 'chatgpt', name: 'ChatGPT', copy: { text: LINK, label: 'Copy the link' }, steps: ['Open ChatGPT and go to **Settings → Connectors → Advanced**. Turn on **Developer mode**.', 'Press **Add connector** and paste the link.', 'Choose **No authentication** and save.', 'Start a new chat and ask a question below.'], note: 'Which plans can do this changes over time.' },
  { id: 'cursor', name: 'Cursor', action: 'cursor', copy: { text: LINK, label: 'Copy the link' }, steps: ['Press the purple button. Cursor opens.', 'Press **Install** in Cursor.', 'Ask a question below in the chat.'] },
  { id: 'vscode', name: 'VS Code', action: 'vscode', copy: { text: LINK, label: 'Copy the link' }, steps: ['Press the purple button. VS Code opens.', 'Press **Install**.', 'Open Copilot Chat in Agent mode and ask a question below.'] },
  { id: 'claudecode', name: 'Claude Code', copy: { text: CLAUDE_CODE, label: 'Copy the command' }, steps: ['Open your terminal.', 'Paste the command and press Enter.', 'Start Claude Code and ask a question below.'] },
];

const PROMPTS = [
  'What launched on Monpad today? Which coin is biggest?',
  'Give me a link to buy 5 MON of the top coin on Monpad.',
  'Set up a Monpad coin called Milk Baron, ticker MILK, with a 2% creator tax.',
];

function Bold({ text }: { text: string }) {
  return <>{text.split('**').map((p, i) => (i % 2 ? <b key={i} className="text-white">{p}</b> : <span key={i}>{p}</span>))}</>;
}

function TestButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle');
  async function test() {
    setState('busy');
    try {
      const r = await fetch('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      const j = await r.json();
      setState(Array.isArray(j?.result?.tools) && j.result.tools.length ? 'ok' : 'bad');
    } catch { setState('bad'); }
  }
  return (
    <button type="button" onClick={test} className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20">
      {state === 'busy' ? 'Checking…' : state === 'ok' ? <span className="inline-flex items-center gap-1 text-green-300"><Check size={16} /> Monpad is online</span> : state === 'bad' ? 'Not reachable, try again' : 'Check that Monpad is online'}
    </button>
  );
}

export default function AiPage() {
  const [appId, setAppId] = useState('claude');
  const app = APPS.find((a) => a.id === appId)!;
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Head>
        <title>Use Monpad with your AI | Monpad</title>
        <meta key="description" name="description" content="Connect Monpad to Claude, ChatGPT, Cursor or VS Code in three steps. Ask your AI for coins, buy links and launches." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/ai" />
      </Head>

      <header className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">Use Monpad with your AI</h1>
        <p className="text-lg text-white/70">Pick your app. Follow three steps. Then just ask.</p>
      </header>

      <section className="rounded-2xl border border-purple-400/30 bg-purple-500/10 p-5 md:p-6 mb-8">
        <div className="text-sm font-semibold text-purple-200 mb-3">1. Which app do you use?</div>
        <div className="flex flex-wrap gap-2 mb-6" role="tablist">
          {APPS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === appId} onClick={() => setAppId(a.id)}
              className={`rounded-xl px-5 py-3 text-base font-semibold ${a.id === appId ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}>
              {a.name}
            </button>
          ))}
        </div>

        <div className="text-sm font-semibold text-purple-200 mb-3">2. Add Monpad to {app.name}</div>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {app.action && (
            <a href={app.action === 'cursor' ? cursorLink() : vscodeLink()} className="rounded-xl bg-purple-600 hover:bg-purple-500 px-6 py-3 text-base font-bold text-white">
              Add Monpad to {app.name}
            </a>
          )}
          <CopyButton text={app.copy.text} label={app.copy.label} className="!px-5 !py-3 !text-base" />
        </div>
        <ol className="space-y-3">
          {app.steps.map((s, i) => (
            <li key={s} className="flex gap-3 text-white/85">
              <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">{i + 1}</span>
              <span className="pt-0.5"><Bold text={s} /></span>
            </li>
          ))}
        </ol>
        {app.note && <p className="mt-4 text-sm text-white/55">{app.note}</p>}
        <div className="mt-5"><TestButton /></div>
      </section>

      <section className="mb-8">
        <div className="text-sm font-semibold text-purple-200 mb-3">3. Ask. Click to copy, then paste into your AI.</div>
        <div className="grid gap-2">
          {PROMPTS.map((p) => (
            <div key={p} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-white/85"><Sparkles size={14} className="inline mr-2 text-purple-300" />{p}</span>
              <CopyButton text={p} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-8">
        <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2"><ShieldCheck size={18} /> Safe by design</h2>
        <p className="text-white/70 leading-relaxed">The AI can look things up and hand you a link. It can&apos;t spend anything. When you open a buy or launch link, your own wallet asks you to confirm. Coins can go to zero. This is not financial advice.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2"><MessageCircle size={18} /> No AI app? Use ours.</h2>
          <p className="text-white/70">Describe your coin in a sentence and launch it.</p>
        </div>
        <Link href="/chat" className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white">Open Chat</Link>
      </section>

      <details className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white/70">
        <summary className="cursor-pointer font-semibold text-white">For developers and bots</summary>
        <p className="mt-3 text-sm">The connector link is <code className="text-purple-200">{LINK}</code>. Tools: <code>monpad_list_launches</code>, <code>monpad_trending</code>, <code>monpad_get_token</code>, <code>monpad_get_spec</code>, <code>monpad_get_monshi_burn</code>, <code>monpad_buy_link</code>, <code>monpad_sell_link</code>, <code>monpad_launch_link</code>.</p>
        <p className="mt-2 text-sm">Want an agent that trades on its own burner wallet? See the <Link href="/docs#bots" className="underline">docs</Link> for <code>@monpad/mcp</code> and <code>@monpad/sdk</code>.</p>
      </details>
    </div>
  );
}
