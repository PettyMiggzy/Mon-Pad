/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api.monpad.net', pathname: '/uploads/**' },
      { protocol: 'https', hostname: 'monpad.net', pathname: '/uploads/**' },
      { protocol: 'https', hostname: 'www.monpad.net', pathname: '/uploads/**' },
      { protocol: 'https', hostname: 'i.imgur.com' },
      { protocol: 'https', hostname: 'pbs.twimg.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
      // Supabase Storage public URLs (token logos uploaded via /api/upload)
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: '*.supabase.in', pathname: '/storage/v1/object/public/**' },
    ],
  },
  env: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL || '',
  },
  async rewrites() {
    return [
      { source: '/sitemap.xml', destination: '/api/sitemap.xml' },
    ];
  },
  // Baseline security headers for a fund-moving dApp. `frame-ancestors 'none'` +
  // X-Frame-Options block clickjacking (a phishing site can't frame the buy/sell UI).
  // A full script/connect-src CSP is intentionally NOT set here — wallet SDKs
  // (RainbowKit/WalletConnect) need a carefully-tested allowlist; that's a separate
  // hardening pass. These directives are safe to ship as-is.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    }
    return config
  },
}

module.exports = nextConfig