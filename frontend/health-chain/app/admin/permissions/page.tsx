"use client";

import React, { useState } from "react";
import { usePermissions } from "@/lib/hooks/usePermissions";

const SCOPE_LABELS: Record<string, string> = {
  "inventory:write": "Inventory Write",
  "dispatch:override": "Dispatch Override",
  "request:approve": "Request Approval",
  "dispute:resolve": "Dispute Resolution",
  "verification:admin": "Verification Admin",
  "settlement:release": "Settlement Release",
};

export default function PermissionsPage() {
  const { data, isLoading, error } = usePermissions();
  const [search, setSearch] = useState("");

  const filtered = data?.filter((r) =>
    r.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-10 space-y-6 bg-white min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Permission Management</h1>
        <p className="text-gray-500 mt-1">
          Effective permission scopes by role. Sensitive actions require the
          matching scope.
        </p>
      </div>

      <input
        type="text"
        placeholder="Filter by role…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {isLoading && (
        <p className="text-gray-500 text-sm">Loading permissions…</p>
      )}

      {error && (
        <p className="text-red-600 text-sm">
          Failed to load permissions. Make sure you have the{" "}
          <code>manage:roles</code> scope.
        </p>
      )}

      {filtered && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 w-32">
                  Role
                </th>
                {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
                  <th
                    key={scope}
                    className="px-4 py-3 text-center font-semibold text-gray-700"
                    title={scope}
                  >
                    {label}
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  All Permissions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(({ role, permissions }) => (
                <tr key={role} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 capitalize">
                    {role}
                  </td>
                  {Object.keys(SCOPE_LABELS).map((scope) => (
                    <td key={scope} className="px-4 py-3 text-center">
                      {permissions.includes(scope) ? (
                        <span className="inline-block w-5 h-5 rounded-full bg-green-500 text-white text-xs leading-5 text-center">
                          ✓
                        </span>
                      ) : (
                        <span className="inline-block w-5 h-5 rounded-full bg-gray-200 text-gray-400 text-xs leading-5 text-center">
                          –
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {permissions.map((p) => (
                        <span
                          key={p}
                          className="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
