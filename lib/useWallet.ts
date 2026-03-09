"use client";

import { useEffect, useState } from "react";
import { CHAIN_ID } from "@/lib/web3";

type EthereumProvider = {
  request: (args: { method: string; params?: any[] | Record<string, any> }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function getProvider(): EthereumProvider | null {
  // @ts-ignore
  return typeof window !== "undefined" ? (window.ethereum as EthereumProvider) : null;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const eth = getProvider();
    if (!eth) return;

    const refresh = async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        setAddress(accounts?.[0] ?? null);
        const cid = (await eth.request({ method: "eth_chainId" })) as string;
        setChainId(cid ? parseInt(cid, 16) : null);
      } catch {
        // ignore
      }
    };
    refresh();

    const onAccounts = (accs: string[]) => setAddress(accs?.[0] ?? null);
    const onChain = (cid: string) => setChainId(cid ? parseInt(cid, 16) : null);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);

    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = async () => {
    const eth = getProvider();
    if (!eth) throw new Error("No injected wallet found. Install MetaMask/Phantom EVM.");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    setAddress(accounts?.[0] ?? null);
    const cid = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(cid ? parseInt(cid, 16) : null);
  };

  const switchToMonad = async () => {
    const eth = getProvider();
    if (!eth) throw new Error("No wallet provider");
    const hexChain = "0x" + CHAIN_ID.toString(16);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
    } catch (e: any) {
      // If chain not added, attempt add
      if (e?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexChain,
              chainName: "Monad Mainnet",
              nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
              rpcUrls: ["https://rpc.ankr.com/monad_mainnet"],
              blockExplorerUrls: ["https://monad.socialscan.io"],
            },
          ],
        });
      } else {
        throw e;
      }
    }
  };

  return {
    provider: getProvider(),
    address,
    chainId,
    isConnected: Boolean(address),
    isMonad: chainId === CHAIN_ID,
    connect,
    switchToMonad,
  };
}
