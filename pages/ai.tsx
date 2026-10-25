import Link from 'next/link';
import Head from 'next/head';
import { Bot, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { CopyButton } from '@/components/ui/CopyButton';

const URL_MCP = 'https://www.monpad.net/api/mcp';
const CURSOR = `cursor://anysphere.cursor-deeplink/mcp/install?name=monpad&config=${typeof btoa === 'function' ? btoa(JSON.stringify({ url: URL_MCP })) : 'eyJ1cmwiOiJodHRwczovL3d3dy5tb25wYWQubmV0L2FwaS9tY3AifQ=='}`;
const VSCODE = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'monpad', type: 'http', url: URL_MCP }))}`;
const CLAUDE_CODE = `claude mcp add --transport http monpad ${URL_MCP}`;

const PROMPTS = [
  'What launched on Monpad in the last day? Which one is biggest?',
  'Give me a link to buy 5 MON of the top coin on Monpad.',
  'Launch a coin on Monpad called Milk Baron, ticker MILK, with a 2% creator tax.',
  'How much MONSHI has been burned?',
];

const TOOLS = [
  ['monpad_list_launches', 'Newest coins with market cap and a link.'],
  ['monpad_trending', 'Biggest coins by market cap.'],
  ['monpad_get_token', 'Price, market cap, liquidity, creator tax and fee for one coin.'],
  ['monpad_get_spec', 'Fees, fee split and contract addresses.'],
  ['monpad_get_monshi_burn', 'MONSHI burned so far.'],
  ['monpad_buy_link / monpad_sell_link', 'A link that opens the coin with the trade filled in.'],
  ['monpad_launch_link', 'A link to the launch page with name, ticker and tax filled in.'],
];

const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-white';

export default function AiPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <Head>
        <title>Use Monpad with your AI | Monpad</title>
        <meta key="description" name="description" content="Add Monpad to Claude, ChatGPT, Cursor or VS Code in one click. Ask your AI to find coins, build a buy link or set up a launch." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/ai" />
      </Head>

      <header className="text-center mb-10">
        <div className="inline-flex items-center gap-2 text-sm text-white/60 mb-3"><Bot size={16} /> Works with any AI</div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Use Monpad with your AI</h1>
        <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          Add one link. Then just ask in plain English. No install, no keys, no wallet in the AI.
        </p>
      </header>

      <section className="rounded-2xl border border-purple-400/30 bg-purple-500/10 p-6 mb-8">
        <h2 className="text-xl font-semibold text-white mb-1">1. Add Monpad</h2>
        <p className="text-white/70 mb-4">Pick your app:</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          <a href={CURSOR} className={`${btn} bg-purple-600 hover:bg-purple-500`}>Add to Cursor</a>
          <a href={VSCODE} className={`${btn} bg-purple-600 hover:bg-purple-500`}>Add to VS Code</a>
          <div className={`${btn} justify-between bg-white/10 border border-white/15 font-normal`}>
            <span className="font-semibold">Claude Code</span><CopyButton text={CLAUDE_CODE} label="Copy command" />
          </div>
          <div className={`${btn} justify-between bg-white/10 border border-white/15 font-normal`}>
            <span className="font-semibold">Claude / ChatGPT</span><CopyButton text={URL_MCP} label="Copy link" />
          </div>
        </div>
        <p className="text-white/60 text-sm">
          In Claude or ChatGPT: <b>Settings → Connectors → Add custom connector</b>, paste the link, no sign-in needed. Any other MCP app: use the link <code className="text-purple-200">{URL_MCP}</code>.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-1">2. Ask</h2>
        <p className="text-white/70 mb-4">Click a prompt to copy it, then paste it into your AI.</p>
        <div className="grid gap-2">
          {PROMPTS.map((p) => (
            <div key={p} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-white/85"><Sparkles size={14} className="inline mr-2 text-purple-300" />{p}</span>
              <CopyButton text={p} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-8">
        <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2"><ShieldCheck size={20} /> You stay in control</h2>
        <p className="text-white/70 leading-relaxed">
          The AI can look things up and hand you a link. It can&apos;t spend anything. When you open a buy, sell or launch link, your own wallet asks you to confirm, like any other trade on Monpad. Nothing here is financial advice, and coins can go to zero.
        </p>
      </section>

      <section className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <MessageCircle className="mb-3" size={22} />
          <h2 className="text-xl font-semibold text-white mb-2">No AI app? Use ours</h2>
          <p className="text-white/70 mb-4">Describe your coin in a sentence. Monpad drafts the name, ticker and logo, then you confirm and launch.</p>
          <Link href="/chat" className="inline-block rounded-xl bg-purple-600 px-4 py-2 font-semibold text-white">Open Chat</Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <Bot className="mb-3" size={22} />
          <h2 className="text-xl font-semibold text-white mb-2">Just want to launch?</h2>
          <p className="text-white/70 mb-4">The launch page is one form and one confirm. Free to launch, pay in MON.</p>
          <Link href="/create" className="inline-block rounded-xl bg-white/10 border border-white/15 px-4 py-2 font-semibold text-white">Launch a coin</Link>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-white mb-4">What your AI can do</h2>
        <div className="divide-y divide-white/10 rounded-2xl border border-white/10 overflow-hidden">
          {TOOLS.map(([name, body]) => (
            <div key={name} className="p-4">
              <code className="text-purple-300">{name}</code>
              <p className="text-white/65 text-sm mt-1">{body}</p>
            </div>
          ))}
        </div>
        <p className="text-white/50 text-sm mt-3">Building a bot instead? See the <Link href="/docs#bots" className="underline">docs</Link>.</p>
      </section>
    </div>
  );
}
