"use client";

import React, { useEffect, useRef } from "react";
import { BloodBankAvailability, BloodType, StockLevel } from "@/lib/types/orders";

interface BloodBankMapProps {
  bloodBanks: BloodBankAvailability[];
  hospitalLat: number;
  hospitalLng: number;
  selectedId: string | null;
  bloodType: BloodType;
  onSelect: (id: string) => void;
}

const STOCK_COLORS: Record<StockLevel, string> = {
  adequate: "#00BFA5",
  low: "#FFA500",
  critical: "#D32F2F",
  out_of_stock: "#9E9E9E",
};

export const BloodBankMap: React.FC<BloodBankMapProps> = ({
  bloodBanks,
  hospitalLat,
  hospitalLng,
  selectedId,
  bloodType,
  onSelect,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);

  useEffect(() => {
    // Dynamically import Leaflet to avoid SSR issues
    const initMap = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current).setView([hospitalLat, hospitalLng], 12);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      // Hospital marker
      const hospitalIcon = L.divIcon({
        html: `<div style="
          width:16px;height:16px;border-radius:50%;
          background:#1E1E1E;border:3px solid white;
          box-shadow:0 0 0 2px #1E1E1E;
        "></div>`,
        className: "",
        iconAnchor: [8, 8],
      });

      L.marker([hospitalLat, hospitalLng], { icon: hospitalIcon })
        .addTo(map)
        .bindPopup("<b>Your Hospital</b>");
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update blood bank markers when data changes
  useEffect(() => {
    const updateMarkers = async () => {
      const L = (await import("leaflet")).default;
      const map = mapInstanceRef.current as {
        addLayer: (l: unknown) => void;
        removeLayer: (l: unknown) => void;
      } | null;
      if (!map) return;

      // Remove old markers
      markersRef.current.forEach((m) => map.removeLayer(m));
      markersRef.current = [];

      bloodBanks.forEach((bb) => {
        const stock = bb.stock[bloodType] ?? 0;
        const color = STOCK_COLORS[bb.stockLevel];
        const isSelected = bb.id === selectedId;
        const isOutOfStock = bb.stockLevel === "out_of_stock" || stock === 0;

        const icon = L.divIcon({
          html: `<div style="
            width:${isSelected ? "22px" : "16px"};
            height:${isSelected ? "22px" : "16px"};
            border-radius:50%;
            background:${color};
            border:${isSelected ? "3px solid black" : "2px solid white"};
            box-shadow:0 2px 6px rgba(0,0,0,0.3);
            opacity:${isOutOfStock ? "0.5" : "1"};
            transition:all 0.2s;
          "></div>`,
          className: "",
          iconAnchor: [isSelected ? 11 : 8, isSelected ? 11 : 8],
        });

        const marker = L.marker([bb.latitude, bb.longitude], { icon })
          .addTo(map as unknown as import("leaflet").Map)
          .bindPopup(
            `<div style="min-width:160px">
              <b>${bb.name}</b><br/>
              <span style="color:${color};font-weight:600">${bb.stockLevel.replace("_", " ").toUpperCase()}</span><br/>
              ${bloodType}: <b>${stock} units</b><br/>
              ${bb.distanceKm.toFixed(1)} km away
            </div>`,
          )
          .on("click", () => {
            if (!isOutOfStock) onSelect(bb.id);
          });

        markersRef.current.push(marker);
      });
    };

    updateMarkers();
  }, [bloodBanks, selectedId, bloodType, onSelect]);

  return (
    <div
      ref={mapRef}
      className="w-full h-[300px] rounded-xl overflow-hidden border border-gray-200"
      style={{ zIndex: 0 }}
    />
  );
};
