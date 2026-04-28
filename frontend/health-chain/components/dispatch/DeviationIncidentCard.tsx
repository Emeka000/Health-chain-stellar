"use client";
import React, { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle, MapPin, Navigation, X } from "lucide-react";

import type { RouteDeviationIncident } from "@/lib/types/route-deviation";

interface Props {
  incident: RouteDeviationIncident;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  severe: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
  },
  moderate: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    dot: "bg-orange-500",
  },
  minor: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
    dot: "bg-yellow-400",
  },
};

function MiniMap({
  lat,
  lng,
  severity,
}: {
  lat: number;
  lng: number;
  severity: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (!mapRef.current || mapInstance.current || !mounted) return;

      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
      }).setView([lat, lng], 14);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png").addTo(
        mapInstance.current,
      );

      const color = severity === "severe" ? "#E22A2A" : severity === "moderate" ? "#F97316" : "#EAB308";
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:${color}" class="w-4 h-4 rounded-full border-2 border-white shadow-lg animate-pulse"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([lat, lng], { icon }).addTo(mapInstance.current);
    };

    init();

    return () => {
      mounted = false;
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [lat, lng, severity]);

  return <div ref={mapRef} className="w-full h-full" aria-label="Deviation location map" />;
}

export default function DeviationIncidentCard({ incident, onAcknowledge, onResolve }: Props) {
  const styles = SEVERITY_STYLES[incident.severity] ?? SEVERITY_STYLES.minor;
  const isAcknowledged = incident.status === "acknowledged";

  return (
    <article
      className={`rounded-2xl border ${styles.border} ${styles.bg} p-4 shadow-sm space-y-3`}
      aria-label={`Route deviation incident for order ${incident.orderId}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${styles.dot} flex-shrink-0 mt-0.5`} aria-hidden="true" />
          <div>
            <p className={`text-sm font-semibold ${styles.text} capitalize`}>
              {incident.severity} Deviation
            </p>
            <p className="text-xs text-gray-500">Order: {incident.orderId}</p>
          </div>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${styles.bg} ${styles.text} border ${styles.border}`}
        >
          {incident.status}
        </span>
      </div>

      {/* Mini map */}
      <div className="w-full h-32 rounded-xl overflow-hidden border border-gray-100">
        <MiniMap
          lat={incident.lastKnownLatitude}
          lng={incident.lastKnownLongitude}
          severity={incident.severity}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-600">
          <Navigation className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{Math.round(incident.deviationDistanceM)}m off route</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            {incident.lastKnownLatitude.toFixed(4)}, {incident.lastKnownLongitude.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Reason */}
      {incident.reason && (
        <p className="text-xs text-gray-600 leading-relaxed">{incident.reason}</p>
      )}

      {/* Recommended action */}
      {incident.recommendedAction && (
        <div className="flex items-start gap-2 bg-white/70 rounded-xl p-2.5 border border-gray-100">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-gray-700">{incident.recommendedAction}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {!isAcknowledged && (
          <button
            onClick={() => onAcknowledge(incident.id)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-700 rounded-xl py-2 hover:bg-gray-50 transition"
            aria-label={`Acknowledge deviation for order ${incident.orderId}`}
          >
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Acknowledge
          </button>
        )}
        <button
          onClick={() => onResolve(incident.id)}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-black text-white rounded-xl py-2 hover:bg-gray-800 transition"
          aria-label={`Resolve deviation for order ${incident.orderId}`}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          Resolve
        </button>
      </div>
    </article>
  );
}
