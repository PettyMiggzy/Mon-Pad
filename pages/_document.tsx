import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Font preconnect — kills the CSS-parse-blocking @import waterfall */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* API preconnect — opens TCP+TLS before the first XHR fires */}
        <link rel="preconnect" href="https://api.monpad.net" crossOrigin="anonymous" />
        {/* Direct font stylesheet load — parallel with HTML parse, not blocking after CSS */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: '{"@context": "https://schema.org", "@type": "Organization", "name": "Mon-Pad", "url": "https://www.monpad.net", "logo": "https://www.monpad.net/Pad.png", "description": "Fair-launch token platform on Monad blockchain", "sameAs": ["https://t.me/MonshiUtilitySupport", "https://t.me/monpadlounge"]}' }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: '{"@context": "https://schema.org", "@type": "WebSite", "name": "Mon-Pad", "url": "https://www.monpad.net", "potentialAction": {"@type": "SearchAction", "target": "https://www.monpad.net/swap?q={search_term_string}", "query-input": "required name=search_term_string"}}' }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
