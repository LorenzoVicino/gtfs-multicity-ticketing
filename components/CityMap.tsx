"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { QrTicket } from "@/components/QrTicket";
import { getTicketDisplayName, getTicketDurationBadge, getTicketMetaLabel } from "@/lib/ticket-display";
import type { CityGtfsPayload, StopPoint } from "@/types/gtfs";
import type { CityTicketCatalog } from "@/types/ticketing";

type Props = {
  payload: CityGtfsPayload | null;
  activeRouteIds: number[];
  focusedRouteId: number | null;
  onStopPanelChange?: (isOpen: boolean) => void;
  onPurchaseCompleted?: (payload: {
    email: string;
    ticketCode: string | null;
    purchase: PurchaseResponse;
  }) => void;
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

type PurchaseStatus = "idle" | "loading" | "success" | "error";

type PurchaseResponse = {
  bookingCode: string;
  totalCents: number;
  agency: {
    agencyId: number;
    gtfsAgencyId: string;
    name: string;
  };
  ticketType: {
    ticketTypeId: number;
    name: string;
    durationMinutes: number;
    priceCents: number;
  };
  tickets: Array<{ ticketCode: string; passengerName: string; qrToken: string }>;
};

const OVERLAY_EXIT_MS = 240;

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

export function CityMap({ payload, activeRouteIds, focusedRouteId, onStopPanelChange, onPurchaseCompleted }: Props) {
  const [zoom, setZoom] = useState(6);
  const [selectedStop, setSelectedStop] = useState<SelectedStop | null>(null);
  const [departuresStatus, setDeparturesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [departuresError, setDeparturesError] = useState<string | null>(null);
  const [departuresData, setDeparturesData] = useState<StopDeparture[]>([]);
  const [serviceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const departuresCacheRef = useRef<Map<string, StopDeparturesResponse>>(new Map());
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [isPurchaseClosing, setIsPurchaseClosing] = useState(false);
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseStatus>("idle");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResponse | null>(null);
  const [ticketCatalogStatus, setTicketCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [ticketCatalogError, setTicketCatalogError] = useState<string | null>(null);
  const [ticketCatalog, setTicketCatalog] = useState<CityTicketCatalog | null>(null);
  const [selectedAgencyId, setSelectedAgencyId] = useState<number | null>(null);
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<number | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerFullName, setCustomerFullName] = useState("");
  const [passengerFullName, setPassengerFullName] = useState("");
  const [passengerBirthDate, setPassengerBirthDate] = useState("");
  const [isPassengerNameManual, setIsPassengerNameManual] = useState(false);
  const purchaseCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedStop(null);
    setDeparturesStatus("idle");
    setDeparturesError(null);
    setDeparturesData([]);
    setIsPurchaseOpen(false);
    setIsPurchaseClosing(false);
    setTicketCatalogStatus("idle");
    setTicketCatalogError(null);
    setTicketCatalog(null);
    setSelectedAgencyId(null);
    setSelectedTicketTypeId(null);
  }, [payload?.city.id]);

  useEffect(() => {
    return () => {
      if (purchaseCloseTimerRef.current !== null) {
        window.clearTimeout(purchaseCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPurchaseOpen || isPurchaseClosing) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPurchaseClosing(true);
        purchaseCloseTimerRef.current = window.setTimeout(() => {
          setIsPurchaseOpen(false);
          setIsPurchaseClosing(false);
          setPurchaseStatus("idle");
          setPurchaseError(null);
          setPurchaseResult(null);
          setCustomerEmail("");
          setCustomerFullName("");
          setPassengerFullName("");
          setPassengerBirthDate("");
          setIsPassengerNameManual(false);
          purchaseCloseTimerRef.current = null;
        }, OVERLAY_EXIT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isPurchaseClosing, isPurchaseOpen]);

  useEffect(() => {
    if (!isPassengerNameManual) {
      setPassengerFullName(customerFullName);
    }
  }, [customerFullName, isPassengerNameManual]);

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

  useEffect(() => {
    if (!payload) {
      return;
    }

    const cityCode = payload.city.cityCode;
    const controller = new AbortController();

    async function loadTicketCatalog() {
      try {
        setTicketCatalogStatus("loading");
        setTicketCatalogError(null);

        const response = await fetch(`/api/cities/${cityCode}/tickets`, {
          signal: controller.signal
        });
        const json = (await response.json()) as CityTicketCatalog | { error?: string };

        if (!response.ok) {
          throw new Error(("error" in json && json.error) || "Errore caricamento catalogo ticket");
        }

        const catalog = json as CityTicketCatalog;
        setTicketCatalog(catalog);
        setTicketCatalogStatus("ready");

        const firstAgency = catalog.agencies.find((agency) => agency.ticketTypes.some((ticketType) => ticketType.active));
        const firstTicketType = firstAgency?.ticketTypes.find((ticketType) => ticketType.active) ?? null;

        setSelectedAgencyId(firstAgency?.agencyId ?? null);
        setSelectedTicketTypeId(firstTicketType?.ticketTypeId ?? null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setTicketCatalogStatus("error");
        setTicketCatalogError(error instanceof Error ? error.message : "Errore caricamento catalogo ticket");
        setTicketCatalog(null);
        setSelectedAgencyId(null);
        setSelectedTicketTypeId(null);
      }
    }

    void loadTicketCatalog();

    return () => {
      controller.abort();
    };
  }, [payload]);

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
  const availableAgencies = useMemo(() => ticketCatalog?.agencies ?? [], [ticketCatalog]);
  const agenciesWithTicketTypes = useMemo(
    () => availableAgencies.filter((agency) => agency.ticketTypes.some((ticketType) => ticketType.active)),
    [availableAgencies]
  );
  const selectedAgency = useMemo(
    () => availableAgencies.find((agency) => agency.agencyId === selectedAgencyId) ?? null,
    [availableAgencies, selectedAgencyId]
  );
  const availableTicketTypes = useMemo(
    () => (selectedAgency ? selectedAgency.ticketTypes.filter((ticketType) => ticketType.active) : []),
    [selectedAgency]
  );
  const selectedTicketType = useMemo(
    () => availableTicketTypes.find((ticketType) => ticketType.ticketTypeId === selectedTicketTypeId) ?? null,
    [availableTicketTypes, selectedTicketTypeId]
  );
  const hasAnyTicketTypes = agenciesWithTicketTypes.length > 0;

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

  const resetPurchaseModal = useCallback(() => {
    setPurchaseStatus("idle");
    setPurchaseError(null);
    setPurchaseResult(null);
    setCustomerEmail("");
    setCustomerFullName("");
    setPassengerFullName("");
    setPassengerBirthDate("");
    setIsPassengerNameManual(false);
  }, []);

  function openPurchaseModal() {
    if (purchaseCloseTimerRef.current !== null) {
      window.clearTimeout(purchaseCloseTimerRef.current);
      purchaseCloseTimerRef.current = null;
    }
    resetPurchaseModal();
    setIsPurchaseClosing(false);
    setIsPurchaseOpen(true);
  }

  const closePurchaseModal = useCallback(() => {
    setIsPurchaseClosing(true);
    purchaseCloseTimerRef.current = window.setTimeout(() => {
      setIsPurchaseOpen(false);
      setIsPurchaseClosing(false);
      resetPurchaseModal();
      purchaseCloseTimerRef.current = null;
    }, OVERLAY_EXIT_MS);
  }, [resetPurchaseModal]);

  async function handlePurchaseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!payload) {
      setPurchaseStatus("error");
      setPurchaseError("Citta non disponibile");
      return;
    }

    const trimmedEmail = customerEmail.trim();
    const trimmedCustomerName = customerFullName.trim();
    const trimmedPassengerName = passengerFullName.trim();

    if (!trimmedEmail || !trimmedCustomerName || !trimmedPassengerName) {
      setPurchaseStatus("error");
      setPurchaseError("Compila email, nome cliente e nome passeggero");
      return;
    }

    if (!selectedAgency || !selectedTicketType) {
      setPurchaseStatus("error");
      setPurchaseError("Seleziona agency e tipologia di biglietto");
      return;
    }

    try {
      setPurchaseStatus("loading");
      setPurchaseError(null);
      setPurchaseResult(null);

      const response = await fetch("/api/tickets/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityId: payload.city.id,
          agencyId: selectedAgency.agencyId,
          ticketTypeId: selectedTicketType.ticketTypeId,
          customer: {
            email: trimmedEmail,
            fullName: trimmedCustomerName
          },
          passengers: [
            {
              fullName: trimmedPassengerName,
              birthDate: passengerBirthDate.trim() || undefined
            }
          ]
        })
      });

      const data = (await response.json()) as PurchaseResponse | { error?: string; details?: string };
      if (!response.ok) {
        const message =
          ("error" in data && data.error) || ("details" in data && data.details) || "Acquisto non riuscito";
        throw new Error(message);
      }

      setPurchaseResult(data as PurchaseResponse);
      setPurchaseStatus("success");
      onPurchaseCompleted?.({
        email: trimmedEmail,
        ticketCode: (data as PurchaseResponse).tickets[0]?.ticketCode ?? null,
        purchase: data as PurchaseResponse
      });
    } catch (error) {
      setPurchaseStatus("error");
      setPurchaseError(error instanceof Error ? error.message : "Errore acquisto ticket");
    }
  }

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

      {payload ? (
        <button
          type="button"
          className={`map-buy ${selectedStop ? "map-floating-shifted" : ""}`}
          onClick={openPurchaseModal}
        >
          Acquista biglietto
        </button>
      ) : null}

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

      {isPurchaseOpen ? (
        <div
          className={`ticket-modal-overlay ${isPurchaseClosing ? "map-ui-exit" : "map-ui-enter map-ui-delay-1"}`}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePurchaseModal();
            }
          }}
        >
          <div className="ticket-modal">
            <div className="ticket-modal-head">
              <div>
                <p className="ticket-modal-title">Acquista biglietto digitale</p>
                <p className="ticket-modal-subtitle">Scegli agency e tariffa a tempo per la citta selezionata.</p>
              </div>
              <button type="button" className="ticket-modal-close" onClick={closePurchaseModal}>
                Chiudi
              </button>
            </div>

            {purchaseStatus === "success" && purchaseResult ? (
              <div className="ticket-modal-result">
                <p className="ticket-modal-success">Acquisto completato</p>
                <p className="ticket-modal-line">Agency: {purchaseResult.agency.name}</p>
                <p className="ticket-modal-line">
                  Titolo: {getTicketDisplayName(purchaseResult.ticketType.name, purchaseResult.ticketType.durationMinutes)} · {" "}
                  {getTicketMetaLabel(
                    purchaseResult.ticketType.name,
                    purchaseResult.ticketType.durationMinutes,
                    purchaseResult.ticketType.priceCents
                  )}
                </p>
                <p className="ticket-modal-line">Booking: {purchaseResult.bookingCode}</p>
                <p className="ticket-modal-line">Ticket: {purchaseResult.tickets[0]?.ticketCode ?? "-"}</p>
                <a
                  className="ticket-modal-cta"
                  href={`/api/tickets/${purchaseResult.tickets[0]?.ticketCode ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vai a validare
                </a>
                <p className="ticket-modal-help">Usa questo endpoint:</p>
                <code className="ticket-modal-code">
                  POST /api/tickets/{purchaseResult.tickets[0]?.ticketCode ?? "TICKET_CODE"}/validate
                </code>
                {purchaseResult.tickets[0]?.qrToken ? (
                  <div className="ticket-modal-qr-shell">
                    <QrTicket value={purchaseResult.tickets[0].qrToken} size={184} className="ticket-modal-qr" />
                  </div>
                ) : null}
                <p className="ticket-modal-help">QR firmato:</p>
                <code className="ticket-modal-code">{purchaseResult.tickets[0]?.qrToken ?? "-"}</code>
              </div>
            ) : (
              <form className="ticket-modal-form" onSubmit={handlePurchaseSubmit}>
                <div className="ticket-modal-section">
                  <p className="ticket-modal-section-title">Agency</p>
                  {availableAgencies.length > 0 ? (
                    <div className="ticket-modal-choice-grid">
                      {availableAgencies.map((agency) => (
                        <button
                          key={agency.agencyId}
                          type="button"
                          className={`ticket-modal-choice ${
                            selectedAgencyId === agency.agencyId ? "ticket-modal-choice-active" : ""
                          }`}
                          onClick={() => {
                            const firstTicketType = agency.ticketTypes.find((ticketType) => ticketType.active) ?? null;
                            setSelectedAgencyId(agency.agencyId);
                            setSelectedTicketTypeId(firstTicketType?.ticketTypeId ?? null);
                          }}
                          disabled={ticketCatalogStatus !== "ready"}
                        >
                          <span className="ticket-modal-choice-title">{agency.agencyName}</span>
                          <span className="ticket-modal-choice-meta">
                            {agency.ticketTypes.filter((ticketType) => ticketType.active).length} tariffe a tempo disponibili
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : ticketCatalogStatus === "ready" ? (
                    <div className="ticket-modal-empty-state">
                      Nessuna agency disponibile per la citta selezionata.
                    </div>
                  ) : null}
                </div>

                <div className="ticket-modal-section">
                  <p className="ticket-modal-section-title">Tariffa a tempo</p>
                  {availableTicketTypes.length > 0 ? (
                    <div className="ticket-modal-choice-grid">
                      {availableTicketTypes.map((ticketType) => (
                        <button
                          key={ticketType.ticketTypeId}
                          type="button"
                          className={`ticket-modal-choice ${
                            selectedTicketTypeId === ticketType.ticketTypeId ? "ticket-modal-choice-active" : ""
                          }`}
                          onClick={() => setSelectedTicketTypeId(ticketType.ticketTypeId)}
                          disabled={ticketCatalogStatus !== "ready"}
                        >
                          <span className="ticket-modal-choice-title">
                            {getTicketDisplayName(ticketType.name, ticketType.durationMinutes)}
                          </span>
                          <span className="ticket-modal-choice-meta">
                            {getTicketMetaLabel(ticketType.name, ticketType.durationMinutes, ticketType.priceCents)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : ticketCatalogStatus === "ready" && selectedAgency ? (
                    <div className="ticket-modal-empty-state">
                      Nessuna tariffa a tempo disponibile per questa agency.
                    </div>
                  ) : ticketCatalogStatus === "ready" && !hasAnyTicketTypes ? (
                    <div className="ticket-modal-empty-state">
                      Nessuna tariffa acquistabile disponibile per la citta selezionata.
                    </div>
                  ) : null}
                </div>

                <label className="ticket-modal-field">
                  <span>Email cliente</span>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="ticket-modal-field">
                  <span>Nome cliente</span>
                  <input
                    type="text"
                    value={customerFullName}
                    onChange={(event) => setCustomerFullName(event.target.value)}
                    required
                  />
                </label>

                <label className="ticket-modal-field">
                  <span>Nome passeggero</span>
                  <input
                    type="text"
                    value={passengerFullName}
                    onChange={(event) => {
                      setPassengerFullName(event.target.value);
                      setIsPassengerNameManual(true);
                    }}
                    required
                  />
                </label>

                <label className="ticket-modal-field">
                  <span>Data nascita (opzionale)</span>
                  <input
                    type="date"
                    value={passengerBirthDate}
                    onChange={(event) => setPassengerBirthDate(event.target.value)}
                  />
                </label>

                {selectedAgency && selectedTicketType ? (
                  <div className="ticket-modal-summary">
                    <p className="ticket-modal-line">Operatore: {selectedAgency.agencyName}</p>
                    <p className="ticket-modal-line">
                      Tariffa: {getTicketDisplayName(selectedTicketType.name, selectedTicketType.durationMinutes)}
                    </p>
                    <p className="ticket-modal-line">
                      Totale: €{(selectedTicketType.priceCents / 100).toFixed(2)} · validita {getTicketDurationBadge(selectedTicketType.durationMinutes)}
                    </p>
                  </div>
                ) : null}

                {ticketCatalogStatus === "loading" ? (
                  <p className="ticket-modal-help">Caricamento catalogo ticket...</p>
                ) : null}

                {ticketCatalogStatus === "error" ? (
                  <p className="ticket-modal-error">{ticketCatalogError ?? "Errore catalogo ticket"}</p>
                ) : null}

                {purchaseStatus === "error" ? (
                  <p className="ticket-modal-error">{purchaseError ?? "Errore acquisto"}</p>
                ) : null}

                <button
                  type="submit"
                  className="ticket-modal-submit"
                  disabled={
                    purchaseStatus === "loading" ||
                    ticketCatalogStatus !== "ready" ||
                    !hasAnyTicketTypes ||
                    !selectedAgency ||
                    !selectedTicketType
                  }
                >
                  {purchaseStatus === "loading" ? "Acquisto in corso..." : "Conferma acquisto"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
