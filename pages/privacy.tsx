import Head from 'next/head';
import Link from 'next/link';

const UPDATED = 'November 1, 2026';

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-8 text-lg font-bold text-white">{children}</h2>;

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy | Monpad</title>
        <meta name="description" content="What Monpad and My Monshi collect, why, and how to remove it." />
      </Head>
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-white/80">
        <h1 className="text-2xl font-extrabold text-white">Privacy Policy</h1>
        <p className="mt-1 text-white/50">Last updated {UPDATED}</p>
        <p className="mt-4">
          This covers Monpad (monpad.net), the My Monshi pet at <Link href="/pet" className="underline">/pet</Link>, and the Android app that opens them. Monpad is a fair-launch pad on Monad. We keep as little data as we can: no accounts, no email, no password, and we do not sell data.
        </p>

        <H>What we collect</H>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li><b>Your wallet address</b> when you connect a wallet or buy something with MONSHI. Wallet addresses and transactions are already public on the Monad blockchain. For pet shop purchases we store the address, the item, the transaction hash and the amount so we can unlock what you paid for.</li>
          <li><b>A wallet signature</b> when you ask us to verify you own a wallet (for example to unlock a purchase). Signing a message costs no gas and gives us no access to your funds. We never see your private keys or seed phrase.</li>
          <li><b>Reminder notifications (optional).</b> If you turn on reminders we store your browser or device push subscription (an endpoint address and encryption keys) and the time of your next reminder. Turning reminders off deletes it.</li>
          <li><b>Token pictures and details you upload</b> when you launch a token (name, symbol, image, description, links). These are public on the token page.</li>
          <li><b>Basic technical data.</b> Our host (Vercel) and our RPC providers see your IP address and request details when you use the site, as any web host does. We use an IP address only to limit abuse, such as a daily cap on pet chat messages.</li>
        </ul>

        <H>Stored only on your device</H>
        <p className="mt-2">Your pet (needs, level, items, streak, sound and reminder settings) is saved in your browser or app storage on your own device. We do not have a copy. Clearing site data or uninstalling the app erases it. Items you bought with MONSHI are tied to your wallet address and can be restored by connecting that wallet.</p>

        <H>Talking to your pet</H>
        <p className="mt-2">When you chat with Monshi, your message is sent to an AI provider (Venice AI) to write his reply. We do not store the text of your conversations. Do not type personal or sensitive information into the chat.</p>

        <H>What we do not do</H>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>We do not sell or rent your data.</li>
          <li>We do not run ads or ad trackers.</li>
          <li>We do not take custody of your funds. Trades, launches and purchases are transactions you approve in your own wallet.</li>
        </ul>

        <H>Who we share data with</H>
        <p className="mt-2">Service providers that help the app run: hosting (Vercel), our database and file storage (Supabase), RPC providers for reading the blockchain, the push service of your browser or device for reminders, and Venice AI for pet chat. They process data only to provide those services. Blockchain transactions are public and permanent by design.</p>

        <H>Keeping and deleting data</H>
        <p className="mt-2">Push subscriptions are deleted when you turn reminders off. To ask us to delete your purchase records or any other data tied to your wallet address, contact us (below) and send the address. We cannot erase anything written to the blockchain.</p>

        <H>Children</H>
        <p className="mt-2">Monpad involves crypto assets and is for people aged 18 and over. It is not directed at children.</p>

        <H>Changes</H>
        <p className="mt-2">If we change this policy we will update the date above.</p>

        <H>Contact</H>
        <p className="mt-2">Questions or deletion requests: <a href="https://t.me/MonshiUtilitySupport" className="underline" target="_blank" rel="noopener noreferrer">Telegram support</a>.</p>
      </div>
    </>
  );
}
