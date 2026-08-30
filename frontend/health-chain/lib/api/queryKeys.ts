import type { OrderQueryParams } from "@/lib/types/orders";

export const queryKeys = {
  orders: {
    all: ["orders"] as const,
    list: (params: OrderQueryParams) => ["orders", "list", params] as const,
  },

  /**
   * Riders (Issue #66)
   */
  riders: {
    all: ["riders"] as const,
    list: () => ["riders", "list"] as const,
    detail: (id: string) => ["riders", "detail", id] as const,
    performance: (id: string) => ["riders", "performance", id] as const,
  },

  /**
   * Blood Banks
   */
  bloodBanks: {
    /** Availability for a given blood type + hospital */
    availability: (bloodType: string, hospitalId: string) =>
      ["bloodBanks", "availability", bloodType, hospitalId] as const,
  },

  /**
   * Dashboard
   */
  dashboard: {
    stats: ["dashboard", "stats"] as const,
    operations: ["dashboard", "operations"] as const,
  },

  transparency: {
    metrics: ["transparency", "metrics"] as const,
  },

  /**
   * Anomalies (Issue #382)
   */
  anomalies: {
    all: ["anomalies"] as const,
    list: (params: import("@/lib/types/anomaly").AnomalyQueryParams) =>
      ["anomalies", "list", params] as const,
    detail: (id: string) => ["anomalies", "detail", id] as const,
  },

  quarantine: {
    all: ["quarantine"] as const,
    list: (params: Record<string, unknown>) =>
      ["quarantine", "list", params] as const,
    detail: (id: string) => ["quarantine", "detail", id] as const,
  },

  policyCenter: {
    all: ["policyCenter"] as const,
    versions: (policyName?: string) =>
      ["policyCenter", "versions", policyName ?? "operational-core"] as const,
    active: (policyName?: string) =>
      ["policyCenter", "active", policyName ?? "operational-core"] as const,
    compare: (fromVersionId: string, toVersionId: string) =>
      ["policyCenter", "compare", fromVersionId, toVersionId] as const,
  },
} as const;
