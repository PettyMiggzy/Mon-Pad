import { recordMonSpend } from './safety.mjs';

/**
 * Broadcast a contract write and record MON spend only after a successful receipt.
 * @param {import('viem').WalletClient} wallet
 * @param {import('viem').PublicClient} publicClient
 * @param {object} txArgs — viem writeContract args (incl. account)
 * @param {{ monToRecord?: bigint }} opts
 */
export async function writeContractAndWait(wallet, publicClient, txArgs, { monToRecord } = {}) {
  const hash = await wallet.writeContract(txArgs);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`transaction reverted (hash ${hash})`);
  }
  if (monToRecord != null && monToRecord > 0n) {
    recordMonSpend(monToRecord);
  }
  return { hash, receipt };
}

/** Same for raw value transfer (not used in production buy path). */
export async function sendTransactionAndWait(wallet, publicClient, txArgs, { monToRecord } = {}) {
  const hash = await wallet.sendTransaction(txArgs);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`transaction reverted (hash ${hash})`);
  }
  if (monToRecord != null && monToRecord > 0n) {
    recordMonSpend(monToRecord);
  }
  return { hash, receipt };
}
