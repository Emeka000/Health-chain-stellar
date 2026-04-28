"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

import {
  acknowledgeDeviationIncident,
  fetchOpenDeviationIncidents,
  resolveDeviationIncident,
} from "../api/route-deviation.api";
import type { RouteDeviationIncident } from "../types/route-deviation";

interface LiveDeviationAlert {
  incidentId: string;
  orderId: string;
  riderId: string;
  severity: string;
  deviationDistanceM: number;
  lastKnownLatitude: number;
  lastKnownLongitude: number;
  recommendedAction: string | null;
  timestamp: string;
}

export function useRouteDeviations() {
  const [incidents, setIncidents] = useState<RouteDeviationIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchOpenDeviationIncidents();
      setIncidents(data);
    } catch {
      // silently fail — WS will keep us updated
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    const socket: Socket = io(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/deviation`,
      { transports: ["websocket"] },
    );
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("deviation.subscribe", {});
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("deviation.alert", (alert: LiveDeviationAlert) => {
      setIncidents((prev) => {
        const exists = prev.find((i) => i.id === alert.incidentId);
        if (exists) {
          return prev.map((i) =>
            i.id === alert.incidentId
              ? {
                  ...i,
                  deviationDistanceM: alert.deviationDistanceM,
                  lastKnownLatitude: alert.lastKnownLatitude,
                  lastKnownLongitude: alert.lastKnownLongitude,
                  severity: alert.severity as RouteDeviationIncident["severity"],
                  recommendedAction: alert.recommendedAction,
                }
              : i,
          );
        }
        // New incident — add a placeholder; full data will come from next poll
        return [
          {
            id: alert.incidentId,
            orderId: alert.orderId,
            riderId: alert.riderId,
            plannedRouteId: "",
            severity: alert.severity as RouteDeviationIncident["severity"],
            status: "open",
            deviationDistanceM: alert.deviationDistanceM,
            deviationDurationS: 0,
            lastKnownLatitude: alert.lastKnownLatitude,
            lastKnownLongitude: alert.lastKnownLongitude,
            reason: null,
            recommendedAction: alert.recommendedAction,
            acknowledgedBy: null,
            acknowledgedAt: null,
            resolvedAt: null,
            scoringApplied: false,
            createdAt: alert.timestamp,
          },
          ...prev,
        ];
      });
    });

    socket.on("deviation.resolved", ({ incidentId }: { incidentId: string }) => {
      setIncidents((prev) => prev.filter((i) => i.id !== incidentId));
    });

    return () => {
      socket.disconnect();
    };
  }, [load]);

  const acknowledge = useCallback(
    async (incidentId: string, userId: string) => {
      const updated = await acknowledgeDeviationIncident(incidentId, userId);
      setIncidents((prev) =>
        prev.map((i) => (i.id === incidentId ? { ...i, ...updated } : i)),
      );
    },
    [],
  );

  const resolve = useCallback(async (incidentId: string) => {
    await resolveDeviationIncident(incidentId);
    setIncidents((prev) => prev.filter((i) => i.id !== incidentId));
  }, []);

  return { incidents, loading, connected, acknowledge, resolve, refresh: load };
}
