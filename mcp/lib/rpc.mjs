/** Strip path, query, and credentials from an RPC URL before any client-facing output. */
export function redactRpcUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.pathname = '';
    u.search = '';
    u.hash = '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '[redacted]';
  }
}
