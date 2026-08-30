"use client";
import React from "react";

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <h2 className="text-xl font-bold text-gray-900 mb-2">Blood request error</h2>
      <p className="text-sm text-gray-500 mb-2 max-w-sm">
        {error.message || "An error occurred in the blood request flow."}
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-sm">
        If a blood request was in progress, please refresh and check the orders list to confirm its
        status before retrying.
      </p>
      <button
        onClick={reset}
        className="px-5 py-2 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition"
      >
        Try again
      </button>
    </div>
  );
}
