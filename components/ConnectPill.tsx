"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function ConnectPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <button
            onClick={() => {
              if (!connected) return openConnectModal();
              if (chain?.unsupported) return openChainModal();
              return openAccountModal();
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            {!connected
              ? "Connect"
              : chain?.unsupported
              ? "Switch to Monad"
              : `${account.address.slice(0, 6)}…${account.address.slice(-4)}`}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
