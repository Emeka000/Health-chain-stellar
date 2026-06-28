"use client";
import React from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <h2 className="text-xl font-bold text-gray-900 mb-2">Dashboard error</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        {error.message || "An error occurred while loading this page."}
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
