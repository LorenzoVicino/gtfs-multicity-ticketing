"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl
} from "react-leaflet";
import type { CityGtfsPayload, StopPoint } from "@/types/gtfs";

type Props = {
  payload: CityGtfsPayload | null;
  activeRouteIds: number[];
  focusedRouteId: number | null;
  onStopPanelChange?: (isOpen: boolean) => void;
};

type ClusterPoint = {
  key: string;
  lat: number;
  lon: number;
  count: number;
  stopId: number | null;
  sampleName: string;
  colorSlices: Array<{ color: string; ratio: number }>;
};

type StopDeparture = {
  departureTs: string;
  lineName: string;
  routeId: number;
  tripId: number;
};

type StopDeparturesResponse = {
  cityId: number;
  stopId: number;
  stopName: string;
  serviceDate: string;
  departures: StopDeparture[];
};

type SelectedStop = {
  stopId: number;
  stopName: string;
};

function gradientFromSlices(slices: Array<{ color: string; ratio: number }>): string {
  if (slices.length === 0) {
    return "conic-gradient(#0a7e56 0deg 360deg)";
  }

  let start = 0;
  const parts: string[] = [];

  for (const slice of slices) {
    const end = start + slice.ratio * 360;
    parts.push(`${slice.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`);
    start = end;
  }

  if (start < 360) {
    parts.push(`#0a7e56 ${start.toFixed(1)}deg 360deg`);
  }

  return `conic-gradient(${parts.join(", ")})`;
}

function clusterIcon(count: number, colorSlices: Array<{ color: string; ratio: number }>): L.DivIcon {
  const size = Math.min(50, Math.max(32, 24 + Math.log2(count + 1) * 5));
  const gradient = gradientFromSlices(colorSlices);

  return L.divIcon({
    className: "stop-cluster-icon-wrapper",
    html: `<span class="stop-cluster-icon" style="width:${size}px;height:${size}px;">
      <span class="stop-cluster-ring" style="background:${gradient};"></span>
      <span class="stop-cluster-core">${count}</span>
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function gridSizeByZoom(zoom: number): number {
  if (zoom <= 8) {
    return 0.08;
  }
  if (zoom <= 10) {
    return 0.04;
  }
  if (zoom <= 12) {
    return 0.02;
  }
  if (zoom <= 13) {
    return 0.008;
  }
  if (zoom <= 14) {
    return 0.004;
  }
  if (zoom <= 15) {
    return 0.002;
  }
  return 0.001;
}

function clusterStops(
  stops: StopPoint[],
  zoom: number,
  stopColorWeights: Map<number, Map<string, number>>
): ClusterPoint[] {
  const cell = gridSizeByZoom(zoom);
  const buckets = new Map<
    string,
    {
      lat: number;
      lon: number;
      count: number;
      sampleName: string;
      stopId: number | null;
      colorCounts: Map<string, number>;
    }
  >();

  for (const stop of stops) {
    const x = Math.floor(stop.lat / cell);
    const y = Math.floor(stop.lon / cell);
    const key = `${x}_${y}`;

    const current = buckets.get(key) ?? {
      lat: 0,
      lon: 0,
      count: 0,
      sampleName: stop.stopName,
      stopId: stop.stopId,
      colorCounts: new Map<string, number>()
    };
    current.lat += stop.lat;
    current.lon += stop.lon;
    current.count += 1;

    const stopColors = stopColorWeights.get(stop.stopId);
    if (stopColors && stopColors.size > 0) {
      for (const [color, weight] of stopColors.entries()) {
        current.colorCounts.set(color, (current.colorCounts.get(color) ?? 0) + weight);
      }
    }

    buckets.set(key, current);
  }

  return Array.from(buckets.entries()).map(([key, value]) => {
    const entries = Array.from(value.colorCounts.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const top = entries.slice(0, 6);
    const topTotal = top.reduce((sum, [, weight]) => sum + weight, 0);
    const slices = top.map(([color, weight]) => ({
      color,
      ratio: total > 0 ? weight / total : 0
    }));

    if (total > 0 && total - topTotal > 0) {
      slices.push({ color: "#9ca3af", ratio: (total - topTotal) / total });
    }

    return {
      key,
      lat: value.lat / value.count,
      lon: value.lon / value.count,
      count: value.count,
      stopId: value.count === 1 ? value.stopId : null,
      sampleName: value.sampleName,
      colorSlices: slices
    };
  });
}

function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    }
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

function FitBounds({ payload, activeRouteIds }: { payload: CityGtfsPayload | null; activeRouteIds: number[] }) {
  const map = useMap();

  useEffect(() => {
    if (!payload) {
      map.setView([41.9028, 12.4964], 6);
      return;
    }

    const activeSet = new Set(activeRouteIds);
    const points = payload.routes
      .filter((route) => activeSet.has(route.routeId))
      .flatMap((route) => route.points)
      .slice(0, 10000);

    if (points.length === 0) {
      return;
    }

    map.fitBounds(points, { padding: [32, 32], maxZoom: 14 });
  }, [map, payload, activeRouteIds]);

  return null;
}

export function CityMap({ payload, activeRouteIds, focusedRouteId, onStopPanelChange }: Props) {
  const [zoom, setZoom] = useState(6);
  const [selectedStop, setSelectedStop] = useState<SelectedStop | null>(null);
  const [departuresStatus, setDeparturesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [departuresError, setDeparturesError] = useState<string | null>(null);
  const [departuresData, setDeparturesData] = useState<StopDeparture[]>([]);
  const [serviceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const departuresCacheRef = useRef<Map<string, StopDeparturesResponse>>(new Map());

  useEffect(() => {
    setSelectedStop(null);
    setDeparturesStatus("idle");
    setDeparturesError(null);
    setDeparturesData([]);
  }, [payload?.city.id]);

  useEffect(() => {
    if (!payload || !selectedStop) {
      return;
    }

    const cityId = payload.city.id;
    const currentStop = selectedStop;
    const cacheKey = `${cityId}:${currentStop.stopId}:${serviceDate}`;
    const cached = departuresCacheRef.current.get(cacheKey);
    if (cached) {
      setDeparturesStatus("ready");
      setDeparturesError(null);
      setDeparturesData(cached.departures);
      return;
    }

    const controller = new AbortController();

    async function loadDepartures() {
      try {
        setDeparturesStatus("loading");
        setDeparturesError(null);

        const response = await fetch(
          `/api/stops/departures?cityId=${cityId}&stopId=${currentStop.stopId}&serviceDate=${serviceDate}`,
          { signal: controller.signal }
        );
        const json = (await response.json()) as StopDeparturesResponse | { error?: string };

        if (!response.ok) {
          throw new Error(("error" in json && json.error) || "Errore lettura partenze");
        }

        departuresCacheRef.current.set(cacheKey, json as StopDeparturesResponse);
        setDeparturesData((json as StopDeparturesResponse).departures);
        setDeparturesStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setDeparturesStatus("error");
        setDeparturesData([]);
        setDeparturesError(error instanceof Error ? error.message : "Errore lettura partenze");
      }
    }

    void loadDepartures();

    return () => {
      controller.abort();
    };
  }, [payload, selectedStop, serviceDate]);

  function formatDepartureTime(departureTs: string): string {
    const date = new Date(departureTs);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    const match = departureTs.match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : "--:--";
  }

  const activeStops = useMemo(() => {
    if (!payload) {
      return [] as StopPoint[];
    }

    const activeSet = new Set(activeRouteIds);
    const stopSet = new Set<number>();

    for (const route of payload.routes) {
      if (!activeSet.has(route.routeId)) {
        continue;
      }

      for (const stopId of route.stopIds) {
        stopSet.add(stopId);
      }
    }

    return payload.stops.filter((stop) => stopSet.has(stop.stopId));
  }, [payload, activeRouteIds]);

  const stopColorWeights = useMemo(() => {
    const map = new Map<number, Map<string, number>>();

    if (!payload) {
      return map;
    }

    const activeSet = new Set(activeRouteIds);
    for (const route of payload.routes) {
      if (!activeSet.has(route.routeId)) {
        continue;
      }

      for (const stopId of route.stopIds) {
        const current = map.get(stopId) ?? new Map<string, number>();
        current.set(route.color, (current.get(route.color) ?? 0) + 1);
        map.set(stopId, current);
      }
    }

    return map;
  }, [payload, activeRouteIds]);

  const clusters = useMemo(
    () => clusterStops(activeStops, zoom, stopColorWeights),
    [activeStops, zoom, stopColorWeights]
  );
  const activeSet = useMemo(() => new Set(activeRouteIds), [activeRouteIds]);
  const visibleDepartures = useMemo(
    () => departuresData.filter((departure) => activeSet.has(departure.routeId)),
    [activeSet, departuresData]
  );
  useEffect(() => {
    if (!selectedStop) {
      return;
    }

    const stopStillVisible = activeStops.some((stop) => stop.stopId === selectedStop.stopId);
    if (!stopStillVisible) {
      setSelectedStop(null);
      setDeparturesStatus("idle");
      setDeparturesError(null);
      setDeparturesData([]);
    }
  }, [activeStops, selectedStop]);

  useEffect(() => {
    onStopPanelChange?.(selectedStop !== null);
  }, [onStopPanelChange, selectedStop]);

  return (
    <div className="city-map-shell">
      <MapContainer
        center={[41.9028, 12.4964]}
        zoom={6}
        zoomControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />

        <ZoomWatcher onZoomChange={setZoom} />
        <FitBounds payload={payload} activeRouteIds={activeRouteIds} />

        {payload?.routes.map((route) => {
          const active = activeSet.has(route.routeId);
          const focused = focusedRouteId === route.routeId;

          return (
            <Polyline
              key={route.routeId}
              positions={route.points}
              pathOptions={{
                color: route.color,
                weight: focused ? 7 : active ? 4 : 2,
                opacity: active ? 0.92 : 0,
                lineCap: "round",
                lineJoin: "round"
              }}
            >
              <Popup>Linea {route.lineName}</Popup>
            </Polyline>
          );
        })}

        {clusters.map((cluster) =>
          cluster.count === 1 ? (
            <CircleMarker
              key={cluster.key}
              center={[cluster.lat, cluster.lon]}
              radius={4}
              pathOptions={{ color: "#0a7e56", fillColor: "#0a7e56", fillOpacity: 0.8, weight: 1 }}
              eventHandlers={{
                click: () => {
                  if (cluster.stopId) {
                    setSelectedStop({ stopId: cluster.stopId, stopName: cluster.sampleName });
                  }
                }
              }}
            >
              <Popup>
                <strong>{cluster.sampleName}</strong>
                <br />
                Clicca per prossime partenze
              </Popup>
            </CircleMarker>
          ) : (
            <Marker
              key={cluster.key}
              position={[cluster.lat, cluster.lon]}
              icon={clusterIcon(cluster.count, cluster.colorSlices)}
            >
              <Popup>
                <strong>{cluster.count} fermate vicine</strong>
                <br />
                Area: {cluster.sampleName}
              </Popup>
            </Marker>
          )
        )}
      </MapContainer>

      {selectedStop ? (
        <aside className="stop-departures-panel map-ui-enter map-ui-delay-2">
          <div className="stop-departures-head">
            <p className="stop-departures-title">{selectedStop.stopName}</p>
            <button type="button" className="stop-departures-close" onClick={() => setSelectedStop(null)}>
              Chiudi
            </button>
          </div>
          <p className="stop-departures-meta">Prossime partenze ({serviceDate})</p>

          {departuresStatus === "loading" ? (
            <p className="stop-departures-state">Caricamento...</p>
          ) : null}

          {departuresStatus === "error" ? (
            <p className="stop-departures-state stop-departures-state-error">
              {departuresError ?? "Errore nel caricamento"}
            </p>
          ) : null}

          {departuresStatus === "ready" && visibleDepartures.length === 0 ? (
            <p className="stop-departures-state">Nessuna partenza trovata</p>
          ) : null}

          {departuresStatus === "ready" && visibleDepartures.length > 0 ? (
            <ul className="stop-departures-list">
              {visibleDepartures.map((departure) => (
                <li
                  key={`${departure.tripId}-${departure.routeId}-${departure.departureTs}`}
                  className="stop-departures-item"
                >
                  <span className="stop-departures-time">{formatDepartureTime(departure.departureTs)}</span>
                  <span className="stop-departures-line">{departure.lineName}</span>
                </li>
              ))}
            </ul>
          ) : null}

        </aside>
      ) : null}
    </div>
  );
}
