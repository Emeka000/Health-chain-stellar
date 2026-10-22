"use client";

import React from "react";
import { ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface TransactionPendingProps {
  txHash: string;
  status: "pending" | "confirmed" | "failed";
  /** Optional Stellar network — defaults to testnet */
  network?: "testnet" | "mainnet";
}

const EXPLORER_BASE: Record<NonNullable<TransactionPendingProps["network"]>, string> = {
  testnet: "https://stellar.expert/explorer/testnet/tx",
  mainnet: "https://stellar.expert/explorer/public/tx",
};

export function TransactionPending({
  txHash,
  status,
  network = "testnet",
}: TransactionPendingProps) {
  const explorerUrl = `${EXPLORER_BASE[network]}/${txHash}`;
  const shortHash = `${txHash.slice(0, 8)}…${txHash.slice(-6)}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Transaction ${status}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        {status === "pending" && (
          <Loader2
            className="h-5 w-5 animate-spin text-blue-500"
            aria-hidden="true"
          />
        )}
        {status === "confirmed" && (
          <CheckCircle2
            className="h-5 w-5 text-green-500"
            aria-hidden="true"
          />
        )}
        {status === "failed" && (
          <XCircle className="h-5 w-5 text-red-500" aria-hidden="true" />
        )}

        <span className="text-sm font-medium text-gray-800">
          {status === "pending" && "Transaction submitted — awaiting confirmation…"}
          {status === "confirmed" && "Transaction confirmed on-chain."}
          {status === "failed" && "Transaction failed."}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="font-mono">{shortHash}</span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-500 hover:underline"
          aria-label={`View transaction ${shortHash} on Stellar Explorer`}
        >
          View on Explorer
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
