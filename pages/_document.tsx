import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
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
