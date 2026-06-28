"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

interface WalletContextValue {
  publicKey: string | null;
  isInstalled: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  sign: (xdr: string) => Promise<string>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    const detect = async () => {
      try {
        const freighter = await import("@stellar/freighter-api");
        const result = await freighter.isConnected();
        const installed = typeof result === "boolean" ? result : (result as { isConnected: boolean }).isConnected;
        setIsInstalled(installed);
        if (installed) {
          try {
            const pk = await freighter.getPublicKey();
            const key = typeof pk === "string" ? pk : (pk as { publicKey?: string }).publicKey;
            if (key) setPublicKey(key);
          } catch {
            // not yet authorised — user hasn't connected yet
          }
        }
      } catch {
        setIsInstalled(false);
      }
    };
    detect();
  }, []);

  const connect = useCallback(async () => {
    if (!isInstalled) {
      setShowInstallPrompt(true);
      return;
    }
    setIsConnecting(true);
    try {
      const freighter = await import("@stellar/freighter-api");
      const access = await freighter.requestAccess();
      const pk = typeof access === "string" ? access : (access as { publicKey?: string }).publicKey;
      if (pk) setPublicKey(pk);
    } finally {
      setIsConnecting(false);
    }
  }, [isInstalled]);

  const sign = useCallback(async (xdr: string): Promise<string> => {
    const freighter = await import("@stellar/freighter-api");
    const result = await freighter.signTransaction(xdr);
    if (typeof result === "string") return result;
    const r = result as { signedTxXdr?: string; error?: string };
    if (r.error) throw new Error(r.error);
    return r.signedTxXdr!;
  }, []);

  const disconnect = useCallback(() => setPublicKey(null), []);

  return (
    <WalletContext.Provider value={{ publicKey, isInstalled, isConnecting, connect, sign, disconnect }}>
      {children}
      {showInstallPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Freighter wallet not installed"
          className="fixed bottom-4 right-4 z-50 bg-white border border-gray-200 rounded-2xl shadow-lg p-4 max-w-xs"
        >
          <p className="text-sm font-semibold text-gray-900 mb-1">Freighter not detected</p>
          <p className="text-xs text-gray-500 mb-3">
            Install the Freighter browser extension to connect your Stellar wallet and sign
            Soroban transactions.
          </p>
          <div className="flex gap-2">
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center px-3 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-gray-800 transition"
            >
              Install Freighter
            </a>
            <button
              onClick={() => setShowInstallPrompt(false)}
              className="px-3 py-2 border border-gray-200 text-gray-600 text-xs rounded-xl hover:bg-gray-50 transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
