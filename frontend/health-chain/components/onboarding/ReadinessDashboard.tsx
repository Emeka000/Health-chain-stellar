"use client";
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, RefreshCw } from "lucide-react";

import { fetchBlockedChecklists, fetchChecklists, signOffChecklist, updateReadinessItem } from "@/lib/api/readiness.api";
import type { ReadinessChecklist, ReadinessEntityType, ReadinessItemKey } from "@/lib/types/readiness";

const ITEM_LABELS: Record<ReadinessItemKey, string> = {
  licensing: "Licensing",
  staffing: "Staffing",
  storage: "Storage",
  transport_coverage: "Transport Coverage",
  notification_setup: "Notification Setup",
  permissions: "Permissions",
  wallet_linkage: "Wallet Linkage",
  emergency_contacts: "Emergency Contacts",
};

const STATUS_STYLES = {
  incomplete: "bg-red-100 text-red-700",
  ready: "bg-yellow-100 text-yellow-700",
  signed_off: "bg-green-100 text-green-700",
};

const ITEM_STATUS_ICON = {
  pending: <Clock className="w-4 h-4 text-gray-400" aria-hidden="true" />,
  complete: <CheckCircle className="w-4 h-4 text-green-500" aria-hidden="true" />,
  waived: <CheckCircle className="w-4 h-4 text-blue-400" aria-hidden="true" />,
};

function ChecklistCard({
  checklist,
  onRefresh,
}: {
  checklist: ReadinessChecklist;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [signing, setSigning] = useState(false);

  const handleMarkComplete = async (itemKey: ReadinessItemKey) => {
    await updateReadinessItem(checklist.id, itemKey, "complete");
    onRefresh();
  };

  const handleSignOff = async () => {
    setSigning(true);
    try {
      await signOffChecklist(checklist.id);
      onRefresh();
    } finally {
      setSigning(false);
    }
  };

  const pendingCount = checklist.items.filter((i) => i.status === "pending").length;

  return (
    <article
      className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-3"
      aria-label={`Readiness checklist for ${checklist.entityId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-black capitalize">{checklist.entityType}: {checklist.entityId}</p>
          <p className="text-xs text-gray-400">{pendingCount} pending item{pendingCount !== 1 ? "s" : ""}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[checklist.status]}`}>
          {checklist.status.replace("_", " ")}
        </span>
      </div>

      <button
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-blue-600 hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? "Hide items" : "Show items"}
      </button>

      {expanded && (
        <ul className="space-y-2" role="list" aria-label="Checklist items">
          {checklist.items.map((item) => (
            <li key={item.itemKey} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {ITEM_STATUS_ICON[item.status]}
                <span className="text-sm text-gray-700">{ITEM_LABELS[item.itemKey]}</span>
              </div>
              {item.status === "pending" && checklist.status !== "signed_off" && (
                <button
                  onClick={() => void handleMarkComplete(item.itemKey)}
                  className="text-xs px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition"
                  aria-label={`Mark ${ITEM_LABELS[item.itemKey]} complete`}
                >
                  Mark complete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {checklist.status === "ready" && (
        <button
          onClick={() => void handleSignOff()}
          disabled={signing}
          className="w-full text-sm font-medium bg-black text-white rounded-xl py-2 hover:bg-gray-800 transition disabled:opacity-50"
          aria-label="Sign off checklist"
        >
          {signing ? "Signing off…" : "Sign Off"}
        </button>
      )}

      {checklist.status === "signed_off" && checklist.signedOffAt && (
        <p className="text-xs text-gray-400">
          Signed off {new Date(checklist.signedOffAt).toLocaleDateString()} by {checklist.signedOffBy}
        </p>
      )}
    </article>
  );
}

export default function ReadinessDashboard() {
  const [checklists, setChecklists] = useState<ReadinessChecklist[]>([]);
  const [blocked, setBlocked] = useState<ReadinessChecklist[]>([]);
  const [filter, setFilter] = useState<ReadinessEntityType | "all">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, blockedList] = await Promise.all([
        fetchChecklists(filter === "all" ? undefined : filter),
        fetchBlockedChecklists(),
      ]);
      setChecklists(all);
      setBlocked(blockedList);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-label="Operational readiness dashboard" className="flex flex-col gap-6 font-poppins">
      {/* Blocked banner */}
      {blocked.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-700 font-medium">
            {blocked.length} partner{blocked.length !== 1 ? "s" : ""} blocked from activation — incomplete readiness checklist{blocked.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(["all", "partner", "region"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`text-xs px-3 py-1.5 rounded-full border transition capitalize ${
                filter === t ? "bg-black text-white border-black" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
              aria-pressed={filter === t}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={() => void load()}
          className="p-1.5 rounded-lg border hover:bg-gray-50 transition"
          aria-label="Refresh readiness checklists"
        >
          <RefreshCw className="w-4 h-4 text-gray-500" aria-hidden="true" />
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
      ) : checklists.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No readiness checklists found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {checklists.map((c) => (
            <ChecklistCard key={c.id} checklist={c} onRefresh={() => void load()} />
          ))}
        </div>
      )}
    </section>
  );
}
