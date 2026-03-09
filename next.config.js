/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // allow images from your Digital Ocean server
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**',
        port: '',
        pathname: '/uploads/**',
      },
      {
        protocol: 'https',
        hostname: '**',
        pathname: '/uploads/**',
      },
    ],
  },
  // expose server URL to browser
  env: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL || '',
  },
}

module.exports = nextConfig