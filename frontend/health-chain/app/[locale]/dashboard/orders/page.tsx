"use client";

// OrdersPage — React Query refactor
// All data fetching via useOrders hook (React Query), zero manual fetch calls.

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  OrderFilters,
  SortConfig,
  PaginationConfig,
  OrderQueryParams,
} from "@/lib/types/orders";
import { URLStateManager } from "@/lib/utils/url-state-manager";
import {
  WebSocketClient,
  ConnectionStatus,
} from "@/lib/utils/websocket-client";
import { CSVExporter } from "@/lib/utils/csv-exporter";
import { FilterPanel } from "@/components/orders/FilterPanel";
import { OrderTable } from "@/components/orders/OrderTable";
import { PaginationController } from "@/components/orders/PaginationController";
import { ConnectionStatusIndicator } from "@/components/orders/ConnectionStatusIndicator";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorDisplay } from "@/components/ui/ErrorDisplay";
import { useOrders } from "@/lib/hooks/useOrders";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/queryKeys";

const HOSPITAL_ID = "HOSP-001";

export default function OrdersPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<OrderFilters>({
    startDate: null,
    endDate: null,
    bloodTypes: [],
    statuses: [],
    bloodBank: "",
  });
  const [sort, setSort] = useState<SortConfig>({
    column: "placedAt",
    order: "desc",
  });
  const [pagination, setPagination] = useState<PaginationConfig>({
    page: 1,
    pageSize: 25,
  });
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>("disconnected");

  const wsClientRef = useRef<WebSocketClient | null>(null);

  // Sync state from URL on first render
  useEffect(() => {
    const urlState = URLStateManager.readFromURL();
    setFilters(urlState.filters);
    setSort(urlState.sort);
    setPagination({
      page: urlState.pagination.page,
      pageSize: urlState.pagination.pageSize,
    });
  }, []);

  // Build typed query params from local state
  const queryParams: OrderQueryParams = {
    hospitalId: HOSPITAL_ID,
    ...filters,
    ...sort,
    ...pagination,
  };

  // ─── React Query ──────────────────────────────────────────────────────────
  const { data, isLoading, isFetching, isError, error, refetch } =
    useOrders(queryParams);

  const orders = data?.data ?? [];
  const totalCount = data?.pagination.totalCount ?? 0;

  // WebSocket: real-time order updates + reconcile after reconnect
  useEffect(() => {
    const wsClient = new WebSocketClient(HOSPITAL_ID);
    wsClientRef.current = wsClient;

    wsClient.onConnectionChange((status) => setWsStatus(status));

    // After reconnect, silently invalidate to pull any missed updates
    wsClient.onReconnected(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    });

    wsClient.onOrderUpdate((updatedOrder) => {
      // Patch the cached data in-place so the table updates without a round-trip
      queryClient.setQueryData(
        queryKeys.orders.list(queryParams),
        (old: typeof data) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((order) =>
              order.id === updatedOrder.id
                ? {
                    ...order,
                    ...updatedOrder,
                    updatedAt: updatedOrder.updatedAt
                      ? new Date(updatedOrder.updatedAt as unknown as string)
                      : order.updatedAt,
                    deliveredAt: updatedOrder.deliveredAt
                      ? new Date(updatedOrder.deliveredAt as unknown as string)
                      : order.deliveredAt,
                  }
                : order,
            ),
          };
        },
      );
    });

    wsClient.connect().catch((err) => {
      console.error("WebSocket connection failed:", err);
    });

    return () => wsClient.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStale = wsStatus === "reconnecting" || wsStatus === "disconnected";

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleFiltersChange = useCallback(
    (newFilters: OrderFilters) => {
      setFilters(newFilters);
      URLStateManager.updateURL(newFilters, sort, pagination);
    },
    [sort, pagination],
  );

  const handleClearFilters = useCallback(() => {
    const cleared: OrderFilters = {
      startDate: null,
      endDate: null,
      bloodTypes: [],
      statuses: [],
      bloodBank: "",
    };
    setFilters(cleared);
    URLStateManager.updateURL(cleared, sort, pagination);
  }, [sort, pagination]);

  const handleSortChange = useCallback(
    (column: string) => {
      const newSort: SortConfig = {
        column,
        order: sort.column === column && sort.order === "asc" ? "desc" : "asc",
      };
      setSort(newSort);
      URLStateManager.updateURL(filters, newSort, pagination);
    },
    [filters, sort, pagination],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setPagination((prev) => ({ ...prev, page }));
      URLStateManager.updateURL(filters, sort, { ...pagination, page });
    },
    [filters, sort, pagination],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      setPagination({ page: 1, pageSize: pageSize as 25 | 50 | 100 });
      URLStateManager.updateURL(filters, sort, {
        page: 1,
        pageSize: pageSize as 25 | 50 | 100,
      });
    },
    [filters, sort],
  );

  const handleExport = useCallback(() => {
    CSVExporter.export(orders);
  }, [orders]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Page Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order History</h1>
          <p className="text-gray-600 mt-2">
            View and manage your hospital&apos;s blood order history
          </p>
        </div>
        <div className="pt-1">
          <ConnectionStatusIndicator status={wsStatus} />
        </div>
      </div>

      {/* Error */}
      {isError && (
        <ErrorDisplay
          className="mb-4"
          heading="Error loading orders"
          message={
            error instanceof Error
              ? error.message
              : "An unexpected error occurred"
          }
          onRetry={refetch}
        />
      )}

      {/* Subtle fetching indicator (not the full spinner – keeps data visible) */}
      {isFetching && !isLoading && (
        <p className="mb-2 text-xs text-gray-400 animate-pulse">Refreshing…</p>
      )}

      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
        onExport={handleExport}
      />

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <OrderTable
          orders={orders}
          sort={sort}
          onSortChange={handleSortChange}
          loading={false}
          emptyMessage="No orders found"
          onClearFilters={handleClearFilters}
          isStale={isStale}
        />
      )}

      {!isLoading && orders.length > 0 && (
        <PaginationController
          currentPage={pagination.page}
          totalCount={totalCount}
          pageSize={pagination.pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}
    </div>
  );
}
