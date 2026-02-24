"use client";
import React, { useEffect, useRef } from "react";

export const LiveOpsMap = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    const initMap = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || mapInstance.current) return;

      // Center on Lagos
      mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([6.5244, 3.3792], 12);

      // Using CartoDB Light tiles for that clean MDrips look
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap'
      }).addTo(mapInstance.current);

      // Custom Red Pulse Marker for Orders
      const orderIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="relative flex items-center justify-center">
                <div class="absolute w-6 h-6 bg-[#E22A2A] rounded-full animate-ping opacity-20"></div>
                <div class="w-4 h-4 bg-[#E22A2A] rounded-full border-2 border-white shadow-lg"></div>
              </div>`,
        iconSize: [24, 24]
      });

      L.marker([6.4544, 3.3992], { icon: orderIcon }).addTo(mapInstance.current)
        .bindPopup('Urgent Request: St. Nicholas Hospital');
    };

    initMap();
  }, []);

  return <div ref={mapRef} className="w-full h-full z-0 grayscale-[0.2]" />;
};