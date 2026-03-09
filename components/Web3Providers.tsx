"use client";

import "@rainbow-me/rainbowkit/styles.css";
import React from "react";
import { RainbowKitProvider, connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { monadMainnet } from "@/lib/wagmi";

const queryClient = new QueryClient();

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "cc1358b5e311a1f844c1d6482633c78d";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [
        injectedWallet, // MetaMask/Rabby/etc (NO MetaMask SDK)
        walletConnectWallet,
      ],
    },
  ],
  { appName: "MonPad", projectId }
);

const config = createConfig({
  chains: [monadMainnet as any],
  connectors,
  transports: {
    [monadMainnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.ankr.com/monad_mainnet"),
  },
  ssr: true,
});

export default function Web3Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}