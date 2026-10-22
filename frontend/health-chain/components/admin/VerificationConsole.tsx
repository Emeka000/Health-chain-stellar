"use client";

import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, Clock, XCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/http-client";

interface VerificationStatus {
  id: string;
  name: string;
  status: string;
  syncStatus: "pending" | "syncing" | "synced" | "failed" | "mismatch";
  verificationSource: string;
  verifiedAt?: string;
  syncedAt?: string;
  verificationTxHash?: string;
  sorobanVerifiedAt?: string;
  syncErrorMessage?: string;
  syncRetryCount: number;
}

export function VerificationConsole() {
  const [organizations, setOrganizations] = useState<VerificationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<VerificationStatus | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingSyncs();
    const interval = setInterval(fetchPendingSyncs, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchPendingSyncs = async () => {
    try {
      const data = await api.get<VerificationStatus[]>("/organizations/verification/pending-syncs");
      setOrganizations(data);
    } catch (error) {
      console.error("Failed to fetch pending syncs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (orgId: string) => {
    setRetrying(orgId);
    try {
      await api.post(`/organizations/${orgId}/retry-sync`);
      fetchPendingSyncs();
    } catch (error) {
      console.error("Retry failed:", error);
    } finally {
      setRetrying(null);
    }
  };

  const getSyncStatusIcon = (status: string) => {
    switch (status) {
      case "synced":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-600" />;
      case "syncing":
        return <Clock className="w-5 h-5 text-blue-600 animate-spin" />;
      case "mismatch":
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getSyncStatusColor = (status: string) => {
    switch (status) {
      case "synced":
        return "bg-green-50 border-green-200";
      case "failed":
        return "bg-red-50 border-red-200";
      case "syncing":
        return "bg-blue-50 border-blue-200";
      case "mismatch":
        return "bg-yellow-50 border-yellow-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  if (loading) {
    return <div className="p-6 text-center">Loading verification status...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Organization Verification Console</h2>
        <button
          onClick={fetchPendingSyncs}
          className="px-4 py-2 bg-brand-black text-white rounded hover:bg-gray-800"
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Refresh
        </button>
      </div>

      {organizations.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No pending verifications
        </div>
      ) : (
        <div className="grid gap-4">
          {organizations.map((org) => (
            <div
              key={org.id}
              className={`border rounded-lg p-4 cursor-pointer transition ${getSyncStatusColor(
                org.syncStatus
              )}`}
              onClick={() => setSelectedOrg(selectedOrg?.id === org.id ? null : org)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  {getSyncStatusIcon(org.syncStatus)}
                  <div>
                    <h3 className="font-semibold">{org.name}</h3>
                    <p className="text-sm text-gray-600">
                      Status: {org.status} | Sync: {org.syncStatus}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    Retries: {org.syncRetryCount}/5
                  </p>
                  {org.syncStatus === "failed" && org.syncRetryCount < 5 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetry(org.id);
                      }}
                      disabled={retrying === org.id}
                      className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {retrying === org.id ? "Retrying..." : "Retry"}
                    </button>
                  )}
                </div>
              </div>

              {selectedOrg?.id === org.id && (
                <div className="mt-4 pt-4 border-t space-y-2 text-sm">
                  {org.verifiedAt && (
                    <p>
                      <span className="font-semibold">Verified At:</span>{" "}
                      {new Date(org.verifiedAt).toLocaleString()}
                    </p>
                  )}
                  {org.syncedAt && (
                    <p>
                      <span className="font-semibold">Synced At:</span>{" "}
                      {new Date(org.syncedAt).toLocaleString()}
                    </p>
                  )}
                  {org.verificationTxHash && (
                    <p>
                      <span className="font-semibold">TX Hash:</span>{" "}
                      <code className="bg-gray-200 px-2 py-1 rounded text-xs">
                        {org.verificationTxHash.slice(0, 16)}...
                      </code>
                    </p>
                  )}
                  {org.syncErrorMessage && (
                    <p className="text-red-600">
                      <span className="font-semibold">Error:</span>{" "}
                      {org.syncErrorMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
