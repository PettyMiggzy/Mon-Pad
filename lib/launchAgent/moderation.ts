// lib/launchAgent/moderation.ts — cheap, deterministic checks that run on every draft
// BEFORE anything is shown or paid for. Not a replacement for human review; it blocks
// the obvious: impersonation, hate, scam promises, copyrighted mascots.

const BLOCK: [RegExp, string][] = [
  [/\b(n[i1]gg|f[a4]gg?[o0]t|k[i1]ke|ch[i1]nk|tr[a4]nny|r[a4]pe)\w*/i, 'hateful or abusive wording'],
  [/\b(guaranteed|risk[- ]?free|100x|1000x|can'?t lose|sure thing)\b/i, 'promises of returns'],
  [/\b(elon|musk|trump|biden|vitalik|cz|sbf|satoshi|zuck)\b/i, 'real person'],
  [/\b(mickey|disney|pokemon|pikachu|nintendo|mario|hello ?kitty|spongebob|marvel|batman|superman)\b/i, 'copyrighted character'],
  [/\b(monad foundation|official|binance|coinbase|metamask|uniswap)\b/i, 'impersonates a brand'],
];

export function moderate(...fields: (string | undefined)[]): string[] {
  const text = fields.filter(Boolean).join(' \n ');
  const flags: string[] = [];
  for (const [re, why] of BLOCK) if (re.test(text)) flags.push(why);
  return flags;
}

/** Untrusted user text goes into LLM/Meshy prompts: strip control chars and role markers. */
export function cleanPrompt(s: string, max = 400): string {
  return String(s || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/(system|assistant|developer)\s*:/gi, '$1 -')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
