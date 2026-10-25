import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** One-click copy. Falls back to a hidden textarea where the Clipboard API is blocked. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* nothing else to try */ } t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1600);
  }
  return (
    <button type="button" onClick={copy} className={`inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 ${className}`}>
      {done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copied' : label}
    </button>
  );
}

/** A code block with a copy button on top. */
export function CodeBlock({ children, label = 'Copy' }: { children: string; label?: string }) {
  return (
    <div className="relative mb-4">
      <div className="absolute right-2 top-2"><CopyButton text={children} label={label} /></div>
      <pre className="rounded-xl border border-white/10 bg-black/40 p-4 pr-24 text-sm text-white/90 overflow-x-auto"><code>{children}</code></pre>
    </div>
  );
}
