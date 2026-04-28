// Redirect bare /stake → /staking
export default function StakeRedirect() { return null }

export async function getServerSideProps() {
  return { redirect: { destination: '/staking', permanent: false } }
}
