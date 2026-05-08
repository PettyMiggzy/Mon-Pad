// V2.1 UI consolidation: profile + portfolio merged into a single user hub at /portfolio.
// This page is kept as a redirect for any external links pointing to /profile.

export default function ProfileRedirect() { return null }

export async function getServerSideProps() {
  return { redirect: { destination: '/portfolio', permanent: false } }
}
