"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import {
  buildStopTimes,
  createEmptyGtfsDraft,
  formatGtfsTime,
  GTFS_BUILDER_STORAGE_KEY,
  GTFS_ROUTE_TYPES,
  GTFS_WEEKDAYS,
  issuesForStep,
  normalizeHexColor,
  parseGtfsTime,
  safeGtfsId,
  upgradeGtfsDraft,
  validateGtfsDraft
} from "@/lib/gtfs-builder-model";
import type {
  CanonicalGtfsValidation,
  GtfsBuilderAgency,
  GtfsBuilderDraft,
  GtfsBuilderIssue,
  GtfsBuilderRoute,
  GtfsBuilderService,
  GtfsBuilderServiceException,
  GtfsBuilderStep,
  GtfsBuilderStop,
  GtfsBuilderTrip
} from "@/types/gtfs-builder";

type Props = {
  onClose: () => void;
  onImported: (cityCode: string, cityName: string) => Promise<void> | void;
  initialDraft?: GtfsBuilderDraft;
  mode?: "create" | "edit";
  sourceLabel?: string;
};

type PublishStatus = "idle" | "validating" | "building" | "importing" | "success" | "error";
type DraftStorageStatus = "saved" | "saving" | "unavailable" | "memory";
type RoundTripMode = "original" | "merged" | "generated";

type ArchiveResponse = {
  blob: Blob;
  mode: RoundTripMode;
  warnings: number;
};

const STEPS: Array<{ id: GtfsBuilderStep; number: string; label: string; description: string }> = [
  { id: "agency", number: "01", label: "Progetto", description: "Agenzia e calendario" },
  { id: "stops", number: "02", label: "Fermate", description: "Punti sulla mappa" },
  { id: "routes", number: "03", label: "Linee", description: "Percorsi e sequenze" },
  { id: "service", number: "04", label: "Corse", description: "Orari di servizio" },
  { id: "publish", number: "05", label: "Esporta", description: "Controlla e pubblica" }
];

const ITALY_CENTER: [number, number] = [41.9028, 12.4964];

function nextReadableId(prefix: string, currentIds: string[]): string {
  const used = new Set(currentIds);
  let index = currentIds.length + 1;
  let candidate = `${prefix}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}_${index}`;
  }
  return candidate;
}

function stopMarkerIcon(label: string, selected: boolean, routeColor?: string): L.DivIcon {
  const color = routeColor ? `#${normalizeHexColor(routeColor, "0F7B3E")}` : "#0f7b3e";
  return L.divIcon({
    className: "builder-marker-wrapper",
    html: `<span class="builder-marker${selected ? " builder-marker-selected" : ""}" style="--marker-color:${color}"><b>${label}</b></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function BuilderMapEvents({ enabled, onCreate }: { enabled: boolean; onCreate: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
      if (enabled) {
        onCreate(event.latlng.lat, event.latlng.lng);
      }
    }
  });
  return null;
}

function BuilderMapViewport({ focus }: { focus: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) {
      map.flyTo(focus, Math.max(map.getZoom(), 15), { duration: 0.55 });
    }
  }, [focus, map]);
  return null;
}

function BuilderLocateControl({ onLocate }: { onLocate: (map: L.Map) => void }) {
  const map = useMap();
  return (
    <button type="button" className="builder-map-locate" onClick={() => onLocate(map)}>
      Usa la mia posizione
    </button>
  );
}

function BuilderMap({
  stops,
  activeRoute,
  selectedStopId,
  allowCreate,
  focus,
  onCreateStop,
  onSelectStop,
  onMoveStop,
  onLocate
}: {
  stops: GtfsBuilderStop[];
  activeRoute: GtfsBuilderRoute | null;
  selectedStopId: string | null;
  allowCreate: boolean;
  focus: [number, number] | null;
  onCreateStop: (lat: number, lon: number) => void;
  onSelectStop: (id: string) => void;
  onMoveStop: (id: string, lat: number, lon: number) => void;
  onLocate: (map: L.Map) => void;
}) {
  const stopById = useMemo(() => new Map(stops.map((stop) => [stop.id, stop])), [stops]);
  const routeStops = useMemo(
    () => activeRoute?.stopIds.map((stopId) => stopById.get(stopId)).filter((stop): stop is GtfsBuilderStop => Boolean(stop)) ?? [],
    [activeRoute, stopById]
  );
  const routePositions = routeStops.map((stop) => [stop.lat, stop.lon] as [number, number]);
  const routePositionByStop = new Map(activeRoute?.stopIds.map((stopId, index) => [stopId, index + 1]) ?? []);
  const initialCenter = stops.length > 0 ? ([stops[0].lat, stops[0].lon] as [number, number]) : ITALY_CENTER;

  return (
    <div className="builder-map-shell">
      <MapContainer center={initialCenter} zoom={stops.length > 0 ? 14 : 6} zoomControl={false} className="builder-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <BuilderMapEvents enabled={allowCreate} onCreate={onCreateStop} />
        <BuilderMapViewport focus={focus} />
        <BuilderLocateControl onLocate={onLocate} />
        {routePositions.length > 1 ? (
          <Polyline
            positions={routePositions}
            pathOptions={{ color: `#${normalizeHexColor(activeRoute?.color ?? "0F7B3E", "0F7B3E")}`, weight: 6, opacity: 0.82 }}
          />
        ) : null}
        {stops.map((stop) => {
          const routePosition = routePositionByStop.get(stop.id);
          return (
            <Marker
              key={stop.id}
              position={[stop.lat, stop.lon]}
              icon={stopMarkerIcon(routePosition ? String(routePosition) : "•", selectedStopId === stop.id, activeRoute?.color)}
              draggable={allowCreate}
              eventHandlers={{
                click: () => onSelectStop(stop.id),
                dragend: (event) => {
                  const point = (event.target as L.Marker).getLatLng();
                  onMoveStop(stop.id, point.lat, point.lng);
                }
              }}
              title={stop.name || stop.id}
            />
          );
        })}
      </MapContainer>
      <div className="builder-map-hint">
        {allowCreate ? "Clicca sulla mappa per aggiungere una fermata. Trascina i punti per correggerli." : "La linea segue l’ordine delle fermate selezionate."}
      </div>
    </div>
  );
}

function FieldError({ issues, field }: { issues: GtfsBuilderIssue[]; field: string }) {
  const issue = issues.find((candidate) => candidate.field === field);
  return issue ? <span className="builder-field-error">{issue.message}</span> : null;
}

export function GtfsBuilder({ onClose, onImported, initialDraft, mode = "create", sourceLabel }: Props) {
  const [draft, setDraft] = useState<GtfsBuilderDraft>(() => initialDraft ?? createEmptyGtfsDraft());
  const [activeStep, setActiveStep] = useState<GtfsBuilderStep>("agency");
  const [visibleIssues, setVisibleIssues] = useState<GtfsBuilderIssue[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<[number, number] | null>(null);
  const [scheduleStart, setScheduleStart] = useState("08:00:00");
  const [scheduleInterval, setScheduleInterval] = useState(5);
  const [draftReady, setDraftReady] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [canonicalValidation, setCanonicalValidation] = useState<CanonicalGtfsValidation | null>(null);
  const [roundTripMode, setRoundTripMode] = useState<RoundTripMode | null>(null);
  const [draftStorageStatus, setDraftStorageStatus] = useState<DraftStorageStatus>(initialDraft ? "memory" : "saved");
  const publishStatusRef = useRef<PublishStatus>("idle");
  const storageUnavailableRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const storageKey = useMemo(
    () => initialDraft ? `${GTFS_BUILDER_STORAGE_KEY}-${initialDraft.project.cityCode.toLowerCase() || "import"}` : GTFS_BUILDER_STORAGE_KEY,
    [initialDraft]
  );

  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
  const allIssues = useMemo(() => validateGtfsDraft(draft), [draft]);
  const selectedStop = draft.stops.find((stop) => stop.id === selectedStopId) ?? null;
  const selectedRoute = draft.routes.find((route) => route.id === selectedRouteId) ?? null;
  const selectedTrip = draft.trips.find((trip) => trip.id === selectedTripId) ?? null;
  const tripRoute = selectedTrip ? draft.routes.find((route) => route.id === selectedTrip.routeId) ?? null : null;

  useEffect(() => {
    try {
      if (initialDraft) {
        // Older builds attempted to persist imported feeds under a per-city
        // key. Remove that oversized value before hydrating the in-memory copy.
        window.localStorage.removeItem(storageKey);
      }
      const stored = initialDraft ? null : window.localStorage.getItem(storageKey);
      const parsed = stored ? upgradeGtfsDraft(JSON.parse(stored)) : initialDraft ?? null;
      if (parsed) {
        setDraft(parsed);
        setSelectedStopId(parsed.stops[0]?.id ?? null);
        setSelectedRouteId(parsed.routes[0]?.id ?? null);
        setSelectedTripId(parsed.trips[0]?.id ?? null);
        if (parsed.stops[0]) setMapFocus([parsed.stops[0].lat, parsed.stops[0].lon]);
      }
    } catch {
      storageUnavailableRef.current = true;
      setDraftStorageStatus(initialDraft ? "memory" : "unavailable");
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Storage can be disabled entirely by the browser.
      }
    } finally {
      setDraftReady(true);
    }
  }, [initialDraft, storageKey]);

  useEffect(() => {
    if (!draftReady || initialDraft || storageUnavailableRef.current) {
      return;
    }
    setDraftStorageStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
        setDraftStorageStatus("saved");
      } catch {
        storageUnavailableRef.current = true;
        setDraftStorageStatus("unavailable");
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // Storage may be entirely unavailable (for example in private browsing).
        }
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady, initialDraft, storageKey]);

  useEffect(() => {
    publishStatusRef.current = publishStatus;
  }, [publishStatus]);

  useEffect(() => {
    setCanonicalValidation(null);
    setRoundTripMode(null);
  }, [draft]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && publishStatusRef.current !== "validating" && publishStatusRef.current !== "building" && publishStatusRef.current !== "importing") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const updateProject = useCallback(<K extends keyof GtfsBuilderDraft["project"]>(key: K, value: GtfsBuilderDraft["project"][K]) => {
    setDraft((current) => ({ ...current, project: { ...current.project, [key]: value } }));
    setVisibleIssues((current) => current.filter((issue) => issue.field !== key));
  }, []);

  function updateAgency(currentId: string, patch: Partial<GtfsBuilderAgency>) {
    const nextId = patch.id ?? currentId;
    setDraft((current) => ({
      ...current,
      agencies: current.agencies.map((agency) => agency.id === currentId ? { ...agency, ...patch } : agency),
      routes: current.routes.map((route) => route.agencyId === currentId ? { ...route, agencyId: nextId } : route)
    }));
  }

  function addAgency() {
    const id = nextReadableId("AGENCY", draft.agencies.map((agency) => agency.id));
    setDraft((current) => ({ ...current, agencies: [...current.agencies, { id, name: "Nuova agenzia", url: "https://", timezone: "Europe/Rome", lang: "it", phone: "" }] }));
  }

  function deleteAgency(id: string) {
    if (draft.agencies.length <= 1 || draft.routes.some((route) => route.agencyId === id)) return;
    setDraft((current) => ({ ...current, agencies: current.agencies.filter((agency) => agency.id !== id) }));
  }

  function updateService(currentId: string, patch: Partial<GtfsBuilderService>) {
    const nextId = patch.id ?? currentId;
    setDraft((current) => ({
      ...current,
      services: current.services.map((service) => service.id === currentId ? { ...service, ...patch } : service),
      trips: current.trips.map((trip) => trip.serviceId === currentId ? { ...trip, serviceId: nextId } : trip)
    }));
  }

  function addService() {
    const template = draft.services[0] ?? createEmptyGtfsDraft().services[0];
    const id = nextReadableId("SERVICE", draft.services.map((service) => service.id));
    setDraft((current) => ({ ...current, services: [...current.services, { ...template, id, days: { ...template.days }, exceptions: [...(template.exceptions ?? [])] }] }));
  }

  function addServiceException(serviceId: string) {
    setDraft((current) => ({
      ...current,
      services: current.services.map((service) => {
        if (service.id !== serviceId) return service;
        const usedDates = new Set((service.exceptions ?? []).map((exception) => exception.date));
        const date = new Date();
        while (usedDates.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1);
        return { ...service, exceptions: [...(service.exceptions ?? []), { date: date.toISOString().slice(0, 10), exceptionType: "1" }] };
      })
    }));
  }

  function updateServiceException(serviceId: string, index: number, patch: Partial<GtfsBuilderServiceException>) {
    setDraft((current) => ({
      ...current,
      services: current.services.map((service) => service.id === serviceId
        ? { ...service, exceptions: (service.exceptions ?? []).map((exception, position) => position === index ? { ...exception, ...patch } : exception) }
        : service)
    }));
  }

  function deleteServiceException(serviceId: string, index: number) {
    setDraft((current) => ({
      ...current,
      services: current.services.map((service) => service.id === serviceId
        ? { ...service, exceptions: (service.exceptions ?? []).filter((_, position) => position !== index) }
        : service)
    }));
  }

  function deleteService(id: string) {
    if (draft.services.length <= 1 || draft.trips.some((trip) => trip.serviceId === id)) return;
    setDraft((current) => ({ ...current, services: current.services.filter((service) => service.id !== id) }));
  }

  const addStop = useCallback((lat: number, lon: number) => {
    setDraft((current) => {
      const id = nextReadableId("STOP", current.stops.map((stop) => stop.id));
      const stop: GtfsBuilderStop = {
        id,
        code: String(current.stops.length + 1).padStart(3, "0"),
        name: `Nuova fermata ${current.stops.length + 1}`,
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        wheelchairBoarding: "0"
      };
      setSelectedStopId(id);
      setMapFocus([stop.lat, stop.lon]);
      return { ...current, stops: [...current.stops, stop] };
    });
    setVisibleIssues([]);
  }, []);

  const updateStop = useCallback((currentId: string, patch: Partial<GtfsBuilderStop>) => {
    setDraft((current) => {
      const nextId = patch.id === undefined ? currentId : patch.id;
      return {
        ...current,
        stops: current.stops.map((stop) => (stop.id === currentId ? { ...stop, ...patch } : stop)),
        routes: current.routes.map((route) => ({
          ...route,
          stopIds: route.stopIds.map((stopId) => (stopId === currentId ? nextId : stopId))
        })),
        trips: current.trips.map((trip) => ({
          ...trip,
          stopTimes: trip.stopTimes.map((stopTime) => (stopTime.stopId === currentId ? { ...stopTime, stopId: nextId } : stopTime))
        }))
      };
    });
    if (patch.id !== undefined) {
      setSelectedStopId(patch.id);
    }
  }, []);

  function deleteStop(id: string) {
    if (!window.confirm("Eliminare questa fermata? Verrà rimossa anche dai percorsi e dagli orari.")) {
      return;
    }
    setDraft((current) => ({
      ...current,
      stops: current.stops.filter((stop) => stop.id !== id),
      routes: current.routes.map((route) => ({ ...route, stopIds: route.stopIds.filter((stopId) => stopId !== id) })),
      trips: current.trips.map((trip) => ({ ...trip, stopTimes: trip.stopTimes.filter((time) => time.stopId !== id) }))
    }));
    setSelectedStopId((current) => (current === id ? null : current));
  }

  function addRoute() {
    const id = nextReadableId("ROUTE", draft.routes.map((route) => route.id));
    const palette = ["0F7B3E", "1D6FD8", "E56A24", "7652B5", "D73555", "008B8B"];
    const route: GtfsBuilderRoute = {
      id,
      agencyId: draft.agencies[0]?.id ?? "AGENCY_1",
      shortName: String(draft.routes.length + 1),
      longName: "",
      type: 3,
      color: palette[draft.routes.length % palette.length],
      textColor: "FFFFFF",
      stopIds: []
    };
    setDraft((current) => ({ ...current, routes: [...current.routes, route] }));
    setSelectedRouteId(id);
  }

  function updateRoute(currentId: string, patch: Partial<GtfsBuilderRoute>) {
    const nextId = patch.id === undefined ? currentId : patch.id;
    setDraft((current) => ({
      ...current,
      routes: current.routes.map((route) => (route.id === currentId ? { ...route, ...patch } : route)),
      trips: current.trips.map((trip) => (trip.routeId === currentId ? { ...trip, routeId: nextId } : trip))
    }));
    if (patch.id !== undefined) {
      setSelectedRouteId(patch.id);
    }
  }

  function deleteRoute(id: string) {
    if (!window.confirm("Eliminare la linea e tutte le sue corse?")) {
      return;
    }
    setDraft((current) => ({
      ...current,
      routes: current.routes.filter((route) => route.id !== id),
      trips: current.trips.filter((trip) => trip.routeId !== id)
    }));
    setSelectedRouteId((current) => (current === id ? null : current));
    setSelectedTripId((current) => (draft.trips.find((trip) => trip.id === current)?.routeId === id ? null : current));
  }

  function appendStopToRoute(stopId: string) {
    if (!selectedRoute || selectedRoute.stopIds.includes(stopId)) {
      return;
    }
    updateRoute(selectedRoute.id, { stopIds: [...selectedRoute.stopIds, stopId] });
  }

  function moveRouteStop(index: number, direction: -1 | 1) {
    if (!selectedRoute) {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= selectedRoute.stopIds.length) {
      return;
    }
    const next = [...selectedRoute.stopIds];
    [next[index], next[target]] = [next[target], next[index]];
    updateRoute(selectedRoute.id, { stopIds: next });
  }

  function addTrip(routeId = selectedRouteId ?? draft.routes[0]?.id) {
    if (!routeId) {
      return;
    }
    const route = draft.routes.find((candidate) => candidate.id === routeId);
    if (!route) {
      return;
    }
    const id = nextReadableId("TRIP", draft.trips.map((trip) => trip.id));
    const lastStop = draft.stops.find((stop) => stop.id === route.stopIds[route.stopIds.length - 1]);
    const trip: GtfsBuilderTrip = {
      id,
      routeId,
      serviceId: draft.services[0]?.id ?? "WEEKDAY",
      headsign: lastStop?.name ?? route.longName ?? "",
      directionId: 0,
      stopTimes: buildStopTimes(route.stopIds, scheduleStart, scheduleInterval)
    };
    setDraft((current) => ({ ...current, trips: [...current.trips, trip] }));
    setSelectedTripId(id);
  }

  function updateTrip(id: string, patch: Partial<GtfsBuilderTrip>) {
    setDraft((current) => ({
      ...current,
      trips: current.trips.map((trip) => (trip.id === id ? { ...trip, ...patch } : trip))
    }));
  }

  function changeTripRoute(trip: GtfsBuilderTrip, routeId: string) {
    const route = draft.routes.find((candidate) => candidate.id === routeId);
    if (!route) {
      return;
    }
    const lastStop = draft.stops.find((stop) => stop.id === route.stopIds[route.stopIds.length - 1]);
    updateTrip(trip.id, {
      routeId,
      headsign: lastStop?.name ?? trip.headsign,
      shapeId: undefined,
      stopTimes: buildStopTimes(route.stopIds, scheduleStart, scheduleInterval)
    });
  }

  function duplicateTrip(trip: GtfsBuilderTrip) {
    const id = nextReadableId("TRIP", draft.trips.map((candidate) => candidate.id));
    const shiftedTimes = trip.stopTimes.map((time) => {
      const arrival = parseGtfsTime(time.arrivalTime) ?? 0;
      const departure = parseGtfsTime(time.departureTime) ?? arrival;
      return { ...time, arrivalTime: formatGtfsTime(arrival + 3600), departureTime: formatGtfsTime(departure + 3600) };
    });
    setDraft((current) => ({ ...current, trips: [...current.trips, { ...trip, id, stopTimes: shiftedTimes }] }));
    setSelectedTripId(id);
  }

  function regenerateTrip(trip: GtfsBuilderTrip) {
    const route = draft.routes.find((candidate) => candidate.id === trip.routeId);
    if (route) {
      updateTrip(trip.id, { shapeId: undefined, stopTimes: buildStopTimes(route.stopIds, scheduleStart, scheduleInterval) });
    }
  }

  function deleteTrip(id: string) {
    setDraft((current) => ({ ...current, trips: current.trips.filter((trip) => trip.id !== id) }));
    setSelectedTripId((current) => (current === id ? null : current));
  }

  function selectStep(step: GtfsBuilderStep) {
    setActiveStep(step);
    setVisibleIssues(issuesForStep(allIssues, step));
    setPublishMessage(null);
  }

  function nextStep() {
    const currentIssues = issuesForStep(allIssues, activeStep);
    if (currentIssues.length > 0) {
      setVisibleIssues(currentIssues);
      return;
    }
    const next = STEPS[activeIndex + 1];
    if (next) {
      setActiveStep(next.id);
      setVisibleIssues(issuesForStep(allIssues, next.id));
    }
  }

  function previousStep() {
    const previous = STEPS[activeIndex - 1];
    if (previous) {
      setActiveStep(previous.id);
      setVisibleIssues([]);
    }
  }

  async function requestArchive(): Promise<ArchiveResponse> {
    const response = await fetch("/api/gtfs/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { error?: string; details?: string; issues?: GtfsBuilderIssue[]; canonical?: CanonicalGtfsValidation };
      if (result.issues) {
        setVisibleIssues(result.issues);
      }
      if (result.canonical) setCanonicalValidation(result.canonical);
      throw new Error(result.details ?? result.error ?? "Creazione ZIP fallita.");
    }
    const mode = (response.headers.get("X-GTFS-Roundtrip-Mode") ?? "generated") as RoundTripMode;
    const warnings = Number(response.headers.get("X-GTFS-Validation-Warnings")) || 0;
    setRoundTripMode(mode);
    return { blob: await response.blob(), mode, warnings };
  }

  async function validateCanonical() {
    const issues = validateGtfsDraft(draft);
    if (issues.length > 0) {
      setVisibleIssues(issues);
      setPublishStatus("error");
      setPublishMessage("Correggi i punti indicati prima della validazione canonica.");
      return;
    }
    try {
      setPublishStatus("validating");
      setPublishMessage("MobilityData sta controllando l’archivio completo...");
      const response = await fetch("/api/gtfs/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        issues?: GtfsBuilderIssue[];
        validation?: CanonicalGtfsValidation;
        roundTrip?: { mode?: RoundTripMode };
      };
      if (result.issues) setVisibleIssues(result.issues);
      if (!response.ok || !result.validation) throw new Error(result.details ?? result.error ?? "Validazione GTFS fallita.");
      setCanonicalValidation(result.validation);
      setRoundTripMode(result.roundTrip?.mode ?? null);
      setPublishStatus(result.validation.valid ? "success" : "error");
      setPublishMessage(result.validation.valid
        ? `Validazione MobilityData superata: ${result.validation.warnings} warning, nessun errore.`
        : `Validazione bloccata: ${result.validation.errors} errori da correggere.`);
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? error.message : "Validazione GTFS fallita.");
    }
  }

  async function downloadArchive() {
    const issues = validateGtfsDraft(draft);
    if (issues.length > 0) {
      setVisibleIssues(issues);
      setPublishStatus("error");
      setPublishMessage("Correggi i punti indicati prima di esportare.");
      return;
    }
    try {
      setPublishStatus("building");
      setPublishMessage("Sto creando i file GTFS...");
      const archive = await requestArchive();
      const href = URL.createObjectURL(archive.blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${safeGtfsId(draft.project.cityCode.toUpperCase(), "GTFS")}_gtfs.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setPublishStatus("success");
      setPublishMessage(`Archivio GTFS scaricato (${archive.mode === "original" ? "originale invariato" : archive.mode === "merged" ? "modifiche fuse senza scartare file" : "generato da zero"}); ${archive.warnings} warning.`);
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? error.message : "Creazione ZIP fallita.");
    }
  }

  async function importArchive() {
    const issues = validateGtfsDraft(draft);
    if (issues.length > 0) {
      setVisibleIssues(issues);
      setPublishStatus("error");
      setPublishMessage("Correggi i punti indicati prima di importare.");
      return;
    }
    try {
      setPublishStatus("building");
      setPublishMessage("Genero l’archivio GTFS...");
      const archive = await requestArchive();
      const formData = new FormData();
      formData.append("file", new File([archive.blob], `${draft.project.cityCode}_gtfs.zip`, { type: "application/zip" }));
      formData.append("cityCode", draft.project.cityCode.toUpperCase());
      formData.append("cityName", draft.project.cityName.trim());
      setPublishStatus("importing");
      setPublishMessage("Importazione nel database in corso...");
      const response = await fetch("/api/gtfs/upload", { method: "POST", body: formData });
      const result = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(result.details ?? result.error ?? "Importazione GTFS fallita.");
      }
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Import succeeded even if browser storage is unavailable.
      }
      setPublishStatus("success");
      setPublishMessage("GTFS importato. La città è pronta sulla mappa.");
      await onImported(draft.project.cityCode.toUpperCase(), draft.project.cityName.trim());
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(error instanceof Error ? error.message : "Importazione GTFS fallita.");
    }
  }

  function resetDraft() {
    if (!window.confirm(mode === "edit" ? "Ripristinare tutti i dati originali del feed?" : "Vuoi davvero cancellare tutta la bozza GTFS?")) {
      return;
    }
    const empty = mode === "edit" && initialDraft ? initialDraft : createEmptyGtfsDraft();
    setDraft(empty);
    setActiveStep("agency");
    setSelectedStopId(null);
    setSelectedRouteId(null);
    setSelectedTripId(null);
    setVisibleIssues([]);
    setPublishStatus("idle");
    setPublishMessage(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Resetting the in-memory draft does not depend on browser storage.
    }
  }

  function renderAgencyStep() {
    return (
      <div className="builder-form-page">
        <div className="builder-page-heading">
          <span className="builder-eyebrow">{mode === "edit" ? "Feed aperto nello Studio" : "Fondamenta del feed"}</span>
          <h2>{mode === "edit" ? "Modifica progetto e operatori" : "Definisci il progetto"}</h2>
          <p>Gestisci città, agenzie e calendari. I riferimenti usati da linee e corse vengono aggiornati automaticamente.</p>
        </div>
        <section className="builder-card">
          <div className="builder-section-heading">
            <span className="builder-section-index">A</span>
            <div><h3>Città</h3><p>Il city code identifica il feed nel GTFS Hub.</p></div>
          </div>
          <div className="builder-fields-grid">
            <label className="builder-field">
              <span>City code *</span>
              <input value={draft.project.cityCode} maxLength={16} placeholder="es. BRI" aria-invalid={visibleIssues.some((issue) => issue.field === "cityCode")} onChange={(event) => updateProject("cityCode", event.target.value.toUpperCase().replace(/\s/g, ""))} />
              <small>Codice breve usato dal GTFS Hub.</small>
              <FieldError issues={visibleIssues} field="cityCode" />
            </label>
            <label className="builder-field">
              <span>Nome città *</span>
              <input value={draft.project.cityName} placeholder="es. Bari" aria-invalid={visibleIssues.some((issue) => issue.field === "cityName")} onChange={(event) => updateProject("cityName", event.target.value)} />
              <FieldError issues={visibleIssues} field="cityName" />
            </label>
          </div>
        </section>
        <section className="builder-card">
          <div className="builder-section-heading builder-section-heading-actions">
            <span className="builder-section-index">B</span>
            <div><h3>Agenzie ({draft.agencies.length})</h3><p>Ogni linea può essere assegnata al proprio operatore.</p></div>
            <button type="button" className="builder-small-primary" onClick={addAgency}>＋ Agenzia</button>
          </div>
          <div className="builder-subcard-list">
            {draft.agencies.map((agency, index) => (
              <div className="builder-subcard" key={`${agency.id}-${index}`}>
                <div className="builder-subcard-heading"><strong>{agency.name || `Agenzia ${index + 1}`}</strong>{draft.agencies.length > 1 && !draft.routes.some((route) => route.agencyId === agency.id) ? <button type="button" className="builder-danger-link" onClick={() => deleteAgency(agency.id)}>Elimina</button> : null}</div>
                <div className="builder-fields-grid">
                  <label className="builder-field"><span>ID agenzia *</span><input value={agency.id} aria-invalid={visibleIssues.some((issue) => issue.field === agency.id)} onChange={(event) => updateAgency(agency.id, { id: event.target.value })} /></label>
                  <label className="builder-field"><span>Nome *</span><input value={agency.name} onChange={(event) => updateAgency(agency.id, { name: event.target.value })} /></label>
                  <label className="builder-field builder-field-wide"><span>Sito web *</span><input type="url" value={agency.url} placeholder="https://azienda.it" onChange={(event) => updateAgency(agency.id, { url: event.target.value })} /></label>
                  <label className="builder-field"><span>Fuso orario *</span><input value={agency.timezone} onChange={(event) => updateAgency(agency.id, { timezone: event.target.value })} /></label>
                  <label className="builder-field"><span>Lingua</span><input value={agency.lang} maxLength={8} onChange={(event) => updateAgency(agency.id, { lang: event.target.value })} /></label>
                  <label className="builder-field builder-field-wide"><span>Telefono</span><input value={agency.phone} onChange={(event) => updateAgency(agency.id, { phone: event.target.value })} /></label>
                </div>
                <FieldError issues={visibleIssues} field={agency.id} />
              </div>
            ))}
          </div>
        </section>
        <section className="builder-card">
          <div className="builder-section-heading builder-section-heading-actions">
            <span className="builder-section-index">C</span>
            <div><h3>Calendari ({draft.services.length})</h3><p>Ogni corsa mantiene il proprio service_id.</p></div>
            <button type="button" className="builder-small-primary" onClick={addService}>＋ Calendario</button>
          </div>
          <div className="builder-subcard-list">
            {draft.services.map((service, index) => (
              <div className="builder-subcard" key={`${service.id}-${index}`}>
                <div className="builder-subcard-heading"><strong>{service.id || `Servizio ${index + 1}`}</strong>{draft.services.length > 1 && !draft.trips.some((trip) => trip.serviceId === service.id) ? <button type="button" className="builder-danger-link" onClick={() => deleteService(service.id)}>Elimina</button> : null}</div>
                <div className="builder-fields-grid builder-fields-grid-three">
                  <label className="builder-field"><span>ID servizio *</span><input value={service.id} onChange={(event) => updateService(service.id, { id: event.target.value })} /></label>
                  <label className="builder-field"><span>Dal *</span><input type="date" value={service.startDate} onChange={(event) => updateService(service.id, { startDate: event.target.value })} /></label>
                  <label className="builder-field"><span>Al *</span><input type="date" value={service.endDate} onChange={(event) => updateService(service.id, { endDate: event.target.value })} /></label>
                </div>
                <fieldset className="builder-days"><legend>Giorni attivi *</legend><div className="builder-day-grid">{GTFS_WEEKDAYS.map((day) => <label key={day.key} className={service.days[day.key] ? "builder-day builder-day-active" : "builder-day"}><input type="checkbox" checked={service.days[day.key]} onChange={(event) => updateService(service.id, { days: { ...service.days, [day.key]: event.target.checked } })} /><span aria-hidden="true">{day.short}</span><span className="sr-only">{day.label}</span></label>)}</div></fieldset>
                <div className="builder-exceptions">
                  <div className="builder-exceptions-heading"><div><strong>Eccezioni calendario</strong><small>Aggiunte e rimozioni di servizio in calendar_dates.txt.</small></div><button type="button" onClick={() => addServiceException(service.id)}>＋ Data</button></div>
                  {(service.exceptions ?? []).length === 0 ? <p>Nessuna eccezione.</p> : (service.exceptions ?? []).map((exception, exceptionIndex) => (
                    <div className="builder-exception-row" key={`${exception.date}-${exceptionIndex}`}>
                      <input aria-label={`Data eccezione ${service.id}`} type="date" value={exception.date} onChange={(event) => updateServiceException(service.id, exceptionIndex, { date: event.target.value })} />
                      <select aria-label={`Tipo eccezione ${service.id}`} value={exception.exceptionType} onChange={(event) => updateServiceException(service.id, exceptionIndex, { exceptionType: event.target.value as "1" | "2" })}>
                        <option value="1">Servizio aggiunto</option>
                        <option value="2">Servizio rimosso</option>
                      </select>
                      <button type="button" aria-label={`Elimina eccezione ${exception.date}`} onClick={() => deleteServiceException(service.id, exceptionIndex)}>×</button>
                    </div>
                  ))}
                </div>
                <FieldError issues={visibleIssues} field={service.id} />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderStopsStep() {
    return (
      <div className="builder-map-layout">
        <section className="builder-editor-pane">
          <div className="builder-page-heading builder-page-heading-compact">
            <span className="builder-eyebrow">Disegna la rete</span>
            <h2>Posiziona le fermate</h2>
            <p>Clicca sulla mappa, poi completa nome e codice. Puoi trascinare ogni punto.</p>
          </div>
          <div className="builder-inline-stats"><span><strong>{draft.stops.length}</strong> fermate</span><span>minimo 2</span></div>
          {visibleIssues.length > 0 ? <div className="builder-inline-alert" role="alert">{visibleIssues[0].message}</div> : null}
          <div className="builder-stop-list" aria-label="Fermate create">
            {draft.stops.length === 0 ? (
              <div className="builder-empty"><span className="builder-empty-icon">＋</span><strong>Nessuna fermata</strong><p>Clicca un punto sulla mappa per iniziare.</p></div>
            ) : draft.stops.map((stop, index) => (
              <button key={stop.id} type="button" className={selectedStopId === stop.id ? "builder-list-item builder-list-item-active" : "builder-list-item"} onClick={() => { setSelectedStopId(stop.id); setMapFocus([stop.lat, stop.lon]); }}>
                <span className="builder-list-number">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{stop.name || "Fermata senza nome"}</strong><small>{stop.id} · {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}</small></span>
              </button>
            ))}
          </div>
          {selectedStop ? (
            <div className="builder-detail-card">
              <div className="builder-detail-head"><h3>Dettagli fermata</h3><button type="button" className="builder-danger-link" onClick={() => deleteStop(selectedStop.id)}>Elimina</button></div>
              <div className="builder-fields-grid">
                <label className="builder-field"><span>ID fermata *</span><input value={selectedStop.id} onChange={(event) => updateStop(selectedStop.id, { id: event.target.value })} /></label>
                <label className="builder-field"><span>Codice pubblico</span><input value={selectedStop.code} onChange={(event) => updateStop(selectedStop.id, { code: event.target.value })} /></label>
                <label className="builder-field builder-field-wide"><span>Nome fermata *</span><input value={selectedStop.name} onChange={(event) => updateStop(selectedStop.id, { name: event.target.value })} /></label>
                <label className="builder-field"><span>Latitudine *</span><input type="number" step="0.000001" value={selectedStop.lat} onChange={(event) => updateStop(selectedStop.id, { lat: Number(event.target.value) })} /></label>
                <label className="builder-field"><span>Longitudine *</span><input type="number" step="0.000001" value={selectedStop.lon} onChange={(event) => updateStop(selectedStop.id, { lon: Number(event.target.value) })} /></label>
                <label className="builder-field builder-field-wide"><span>Accessibilità</span><select value={selectedStop.wheelchairBoarding} onChange={(event) => updateStop(selectedStop.id, { wheelchairBoarding: event.target.value as "0" | "1" | "2" })}><option value="0">Non specificata</option><option value="1">Accessibile in sedia a rotelle</option><option value="2">Non accessibile</option></select></label>
              </div>
            </div>
          ) : null}
        </section>
        <BuilderMap
          stops={draft.stops}
          activeRoute={null}
          selectedStopId={selectedStopId}
          allowCreate
          focus={mapFocus}
          onCreateStop={addStop}
          onSelectStop={(id) => setSelectedStopId(id)}
          onMoveStop={(id, lat, lon) => updateStop(id, { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) })}
          onLocate={(map) => navigator.geolocation?.getCurrentPosition((position) => map.flyTo([position.coords.latitude, position.coords.longitude], 15))}
        />
      </div>
    );
  }

  function renderRoutesStep() {
    return (
      <div className="builder-map-layout">
        <section className="builder-editor-pane">
          <div className="builder-page-heading builder-page-heading-compact"><span className="builder-eyebrow">Costruisci i percorsi</span><h2>Crea le linee</h2><p>Definisci la linea e aggiungi le fermate nell’ordine di percorrenza.</p></div>
          <div className="builder-toolbar"><div className="builder-inline-stats"><span><strong>{draft.routes.length}</strong> linee</span></div><button type="button" className="builder-small-primary" onClick={addRoute}>＋ Nuova linea</button></div>
          {visibleIssues.length > 0 ? <div className="builder-inline-alert" role="alert">{visibleIssues[0].message}</div> : null}
          <div className="builder-chip-list" aria-label="Linee create">
            {draft.routes.map((route) => <button key={route.id} type="button" className={selectedRouteId === route.id ? "builder-route-chip builder-route-chip-active" : "builder-route-chip"} style={{ "--route-color": `#${normalizeHexColor(route.color, "0F7B3E")}` } as React.CSSProperties} onClick={() => setSelectedRouteId(route.id)}><span>{route.shortName || route.id}</span><small>{route.stopIds.length} fermate</small></button>)}
          </div>
          {selectedRoute ? (
            <div className="builder-detail-card builder-route-editor">
              <div className="builder-detail-head"><h3>Dettagli linea</h3><button type="button" className="builder-danger-link" onClick={() => deleteRoute(selectedRoute.id)}>Elimina</button></div>
              <div className="builder-fields-grid">
                <label className="builder-field"><span>ID linea *</span><input value={selectedRoute.id} onChange={(event) => updateRoute(selectedRoute.id, { id: event.target.value })} /></label>
                <label className="builder-field"><span>Nome breve *</span><input value={selectedRoute.shortName} placeholder="es. 1" onChange={(event) => updateRoute(selectedRoute.id, { shortName: event.target.value })} /></label>
                <label className="builder-field builder-field-wide"><span>Nome esteso</span><input value={selectedRoute.longName} placeholder="es. Stazione – Aeroporto" onChange={(event) => updateRoute(selectedRoute.id, { longName: event.target.value })} /></label>
                <label className="builder-field"><span>Agenzia *</span><select value={selectedRoute.agencyId} onChange={(event) => updateRoute(selectedRoute.id, { agencyId: event.target.value })}>{draft.agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name || agency.id}</option>)}</select></label>
                <label className="builder-field"><span>Mezzo</span><select value={selectedRoute.type} onChange={(event) => updateRoute(selectedRoute.id, { type: Number(event.target.value) })}>{GTFS_ROUTE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
                <div className="builder-color-fields"><label className="builder-field"><span>Colore linea</span><input type="color" value={`#${normalizeHexColor(selectedRoute.color, "0F7B3E")}`} onChange={(event) => updateRoute(selectedRoute.id, { color: event.target.value.slice(1).toUpperCase() })} /></label><label className="builder-field"><span>Colore testo</span><input type="color" value={`#${normalizeHexColor(selectedRoute.textColor, "FFFFFF")}`} onChange={(event) => updateRoute(selectedRoute.id, { textColor: event.target.value.slice(1).toUpperCase() })} /></label></div>
              </div>
              <div className="builder-route-sequence">
                <h4>Sequenza fermate</h4>
                {selectedRoute.stopIds.length === 0 ? <p className="builder-muted">Aggiungi almeno due fermate dall’elenco sotto.</p> : selectedRoute.stopIds.map((stopId, index) => {
                  const stop = draft.stops.find((candidate) => candidate.id === stopId);
                  return <div key={`${stopId}-${index}`} className="builder-sequence-row"><span className="builder-sequence-index">{index + 1}</span><button type="button" className="builder-sequence-name" onClick={() => { setSelectedStopId(stopId); if (stop) setMapFocus([stop.lat, stop.lon]); }}>{stop?.name ?? stopId}</button><button type="button" aria-label="Sposta su" disabled={index === 0} onClick={() => moveRouteStop(index, -1)}>↑</button><button type="button" aria-label="Sposta giù" disabled={index === selectedRoute.stopIds.length - 1} onClick={() => moveRouteStop(index, 1)}>↓</button><button type="button" aria-label="Rimuovi dalla linea" onClick={() => updateRoute(selectedRoute.id, { stopIds: selectedRoute.stopIds.filter((_, position) => position !== index) })}>×</button></div>;
                })}
              </div>
              <div className="builder-stop-pool"><h4>Fermate disponibili</h4><div>{draft.stops.map((stop) => <button key={stop.id} type="button" disabled={selectedRoute.stopIds.includes(stop.id)} onClick={() => appendStopToRoute(stop.id)}><span>＋</span>{stop.name}</button>)}</div></div>
            </div>
          ) : <div className="builder-empty builder-empty-compact"><strong>Crea la prima linea</strong><p>Potrai collegare le fermate già posizionate.</p></div>}
        </section>
        <BuilderMap stops={draft.stops} activeRoute={selectedRoute} selectedStopId={selectedStopId} allowCreate={false} focus={mapFocus} onCreateStop={() => undefined} onSelectStop={(id) => { setSelectedStopId(id); appendStopToRoute(id); }} onMoveStop={() => undefined} onLocate={(map) => navigator.geolocation?.getCurrentPosition((position) => map.flyTo([position.coords.latitude, position.coords.longitude], 15))} />
      </div>
    );
  }

  function renderServiceStep() {
    return (
      <div className="builder-map-layout">
        <section className="builder-editor-pane">
          <div className="builder-page-heading builder-page-heading-compact"><span className="builder-eyebrow">Metti in moto la rete</span><h2>Programma le corse</h2><p>Crea gli orari di passaggio per ogni linea. GTFS supporta anche orari oltre le 24:00.</p></div>
          <div className="builder-schedule-generator"><label><span>Prima partenza</span><input type="text" inputMode="numeric" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} placeholder="08:00:00" /></label><label><span>Minuti tra fermate</span><input type="number" min="1" max="180" value={scheduleInterval} onChange={(event) => setScheduleInterval(Number(event.target.value))} /></label><button type="button" onClick={() => addTrip()}>＋ Crea corsa</button></div>
          {visibleIssues.length > 0 ? <div className="builder-inline-alert" role="alert">{visibleIssues[0].message}</div> : null}
          <div className="builder-trip-list" aria-label="Corse create">
            {draft.trips.length === 0 ? <div className="builder-empty builder-empty-compact"><strong>Nessuna corsa</strong><p>Crea una linea con almeno due fermate, poi genera la prima corsa.</p></div> : draft.trips.map((trip) => {
              const route = draft.routes.find((candidate) => candidate.id === trip.routeId);
              return <button key={trip.id} type="button" className={selectedTripId === trip.id ? "builder-list-item builder-list-item-active" : "builder-list-item"} onClick={() => { setSelectedTripId(trip.id); setSelectedRouteId(trip.routeId); }}><span className="builder-trip-line" style={{ background: `#${normalizeHexColor(route?.color ?? "0F7B3E", "0F7B3E")}` }}>{route?.shortName ?? "?"}</span><span><strong>{trip.id}</strong><small>{trip.stopTimes[0]?.departureTime ?? "--:--:--"} · {trip.headsign || "Direzione da definire"}</small></span></button>;
            })}
          </div>
          {selectedTrip ? (
            <div className="builder-detail-card">
              <div className="builder-detail-head"><h3>Dettagli corsa</h3><div className="builder-detail-actions"><button type="button" onClick={() => duplicateTrip(selectedTrip)}>Duplica +1h</button><button type="button" className="builder-danger-link" onClick={() => deleteTrip(selectedTrip.id)}>Elimina</button></div></div>
              <div className="builder-fields-grid">
                <label className="builder-field"><span>ID corsa *</span><input value={selectedTrip.id} onChange={(event) => { updateTrip(selectedTrip.id, { id: event.target.value }); setSelectedTripId(event.target.value); }} /></label>
                <label className="builder-field"><span>Linea *</span><select value={selectedTrip.routeId} onChange={(event) => changeTripRoute(selectedTrip, event.target.value)}>{draft.routes.map((route) => <option key={route.id} value={route.id}>{route.shortName || route.id}</option>)}</select></label>
                <label className="builder-field"><span>Calendario *</span><select value={selectedTrip.serviceId} onChange={(event) => updateTrip(selectedTrip.id, { serviceId: event.target.value })}>{draft.services.map((service) => <option key={service.id} value={service.id}>{service.id}</option>)}</select></label>
                <label className="builder-field builder-field-wide"><span>Destinazione</span><input value={selectedTrip.headsign} placeholder="Capolinea" onChange={(event) => updateTrip(selectedTrip.id, { headsign: event.target.value })} /></label>
                <label className="builder-field"><span>Direzione</span><select value={selectedTrip.directionId} onChange={(event) => updateTrip(selectedTrip.id, { directionId: Number(event.target.value) as 0 | 1 })}><option value={0}>Andata (0)</option><option value={1}>Ritorno (1)</option></select></label>
                <div className="builder-regenerate"><button type="button" onClick={() => regenerateTrip(selectedTrip)}>Rigenera da {scheduleStart}</button><small>Usa l’intervallo di {scheduleInterval} min impostato sopra.</small></div>
              </div>
              <div className="builder-timetable"><div className="builder-timetable-head"><span>Fermata</span><span>Arrivo</span><span>Partenza</span></div>{selectedTrip.stopTimes.map((stopTime, index) => {
                const stop = draft.stops.find((candidate) => candidate.id === stopTime.stopId);
                return <div key={`${stopTime.stopId}-${index}`} className="builder-timetable-row"><span><strong>{index + 1}</strong>{stop?.name ?? stopTime.stopId}</span><input aria-label={`Arrivo a ${stop?.name ?? stopTime.stopId}`} value={stopTime.arrivalTime} onChange={(event) => updateTrip(selectedTrip.id, { stopTimes: selectedTrip.stopTimes.map((time, position) => position === index ? { ...time, arrivalTime: event.target.value } : time) })} /><input aria-label={`Partenza da ${stop?.name ?? stopTime.stopId}`} value={stopTime.departureTime} onChange={(event) => updateTrip(selectedTrip.id, { stopTimes: selectedTrip.stopTimes.map((time, position) => position === index ? { ...time, departureTime: event.target.value } : time) })} /></div>;
              })}</div>
            </div>
          ) : null}
        </section>
        <BuilderMap stops={draft.stops} activeRoute={tripRoute} selectedStopId={null} allowCreate={false} focus={null} onCreateStop={() => undefined} onSelectStop={() => undefined} onMoveStop={() => undefined} onLocate={(map) => navigator.geolocation?.getCurrentPosition((position) => map.flyTo([position.coords.latitude, position.coords.longitude], 15))} />
      </div>
    );
  }

  function renderPublishStep() {
    const stepSummaries = STEPS.slice(0, 4).map((step) => ({ ...step, issues: issuesForStep(allIssues, step.id) }));
    const sourceFiles = draft.sourceArchive?.files ?? [];
    const unmanagedFiles = sourceFiles.filter((file) => !file.managed);
    const publishBusy = publishStatus === "validating" || publishStatus === "building" || publishStatus === "importing";
    return (
      <div className="builder-publish-page">
        <div className="builder-page-heading"><span className="builder-eyebrow">Ultimo controllo</span><h2>Il tuo GTFS, pronto a viaggiare</h2><p>Scarica un archivio standard indipendente oppure importalo direttamente nel GTFS Hub.</p></div>
        <div className="builder-metrics"><div><strong>{draft.stops.length}</strong><span>Fermate</span></div><div><strong>{draft.routes.length}</strong><span>Linee</span></div><div><strong>{draft.trips.length}</strong><span>Corse</span></div><div><strong>{draft.trips.reduce((total, trip) => total + trip.stopTimes.length, 0)}</strong><span>Orari</span></div></div>
        <section className="builder-readiness-card">
          <div className="builder-section-heading"><span className={allIssues.length === 0 ? "builder-ready-mark" : "builder-warning-mark"}>{allIssues.length === 0 ? "✓" : "!"}</span><div><h3>{allIssues.length === 0 ? "Feed completo" : `${allIssues.length} punti da completare`}</h3><p>{allIssues.length === 0 ? "I file obbligatori sono coerenti e possono essere generati." : "Apri le sezioni indicate e correggi i campi mancanti."}</p></div></div>
          <div className="builder-check-list">{stepSummaries.map((step) => <button key={step.id} type="button" onClick={() => selectStep(step.id)} className={step.issues.length === 0 ? "builder-check builder-check-ok" : "builder-check builder-check-error"}><span>{step.issues.length === 0 ? "✓" : step.issues.length}</span><strong>{step.label}</strong><small>{step.issues.length === 0 ? "Completo" : step.issues[0].message}</small></button>)}</div>
        </section>
        <section className={draft.sourceArchive ? "builder-lossless-card builder-lossless-card-protected" : "builder-lossless-card"}>
          <div className="builder-lossless-mark">{draft.sourceArchive ? "◎" : "+"}</div>
          <div>
            <span className="builder-export-kicker">Round-trip</span>
            <h3>{draft.sourceArchive ? "Archivio sorgente protetto" : mode === "edit" ? "Sorgente completa non disponibile" : "Nuovo feed"}</h3>
            <p>{draft.sourceArchive
              ? `${draft.sourceArchive.fileName}: ${sourceFiles.length} file registrati. ${unmanagedFiles.length} file non modificati dallo Studio saranno copiati byte per byte.`
              : mode === "edit"
                ? "Questa città proviene dalla proiezione nel database: l’export è valido, ma non può promettere di conservare campi e file assenti dal database."
                : "Non esiste un archivio precedente: lo Studio genererà tutti i file del feed."}</p>
            {draft.sourceArchive ? <small>SHA-256 sorgente: {draft.sourceArchive.sha256.slice(0, 16)}… · sessione server 24h</small> : null}
            {roundTripMode ? <strong className="builder-roundtrip-mode">Ultimo build: {roundTripMode === "original" ? "ZIP originale invariato" : roundTripMode === "merged" ? "merge conservativo" : "generazione completa"}</strong> : null}
          </div>
        </section>
        <section className="builder-validator-card">
          <div className="builder-validator-heading">
            <div><span className="builder-export-kicker">Controllo canonico</span><h3>MobilityData GTFS Validator</h3><p>È il gate reale usato anche durante download e importazione: gli errori bloccano, warning e info restano visibili.</p></div>
            <button type="button" disabled={allIssues.length > 0 || publishBusy} onClick={() => void validateCanonical()}>{publishStatus === "validating" ? "Validazione..." : "Valida adesso"}</button>
          </div>
          {canonicalValidation ? (
            <div className="builder-validator-result">
              <div className={canonicalValidation.valid ? "builder-validator-verdict builder-validator-ok" : "builder-validator-verdict builder-validator-error"}>
                <strong>{canonicalValidation.valid ? "VALIDO" : "NON VALIDO"}</strong>
                <span>{canonicalValidation.errors} errori</span><span>{canonicalValidation.warnings} warning</span><span>{canonicalValidation.infos} info</span>
              </div>
              <small>{canonicalValidation.validatorVersion}</small>
              {canonicalValidation.notices.length > 0 ? <div className="builder-validator-notices">{canonicalValidation.notices.slice(0, 12).map((notice) => <div key={`${notice.severity}-${notice.code}`}><span className={`builder-notice-severity builder-notice-${notice.severity.toLowerCase()}`}>{notice.severity}</span><code>{notice.code}</code><strong>{notice.totalNotices}</strong></div>)}</div> : <p>Nessuna segnalazione.</p>}
              {canonicalValidation.notices.length > 12 ? <small>Mostrate 12 categorie su {canonicalValidation.notices.length}.</small> : null}
            </div>
          ) : <p className="builder-validator-empty">Nessun report per questa versione della bozza.</p>}
        </section>
        <div className="builder-export-grid">
          <section className="builder-export-card"><span className="builder-export-kicker">Portabile</span><h3>Scarica ZIP GTFS</h3><p>Il server esegue prima il validatore canonico. Se stai modificando un ZIP, conserva file e colonne che lo Studio non gestisce.</p><button type="button" className="builder-export-button builder-export-button-secondary" disabled={allIssues.length > 0 || publishBusy} onClick={() => void downloadArchive()}>Scarica archivio .zip</button></section>
          <section className="builder-export-card builder-export-card-primary"><span className="builder-export-kicker">GTFS Hub</span><h3>{mode === "edit" ? "Aggiorna la città" : "Crea e apri la città"}</h3><p>Valida lo ZIP, sincronizza il database locale e conserva l’archivio canonico per le modifiche future.</p><button type="button" className="builder-export-button" disabled={allIssues.length > 0 || publishBusy} onClick={() => void importArchive()}>{publishStatus === "importing" ? "Importazione..." : mode === "edit" ? "Salva modifiche nel Hub" : "Importa nel GTFS Hub"}</button></section>
        </div>
        {publishMessage ? <div className={`builder-publish-message builder-publish-message-${publishStatus}`} role={publishStatus === "error" ? "alert" : "status"}>{publishMessage}</div> : null}
        <div className="builder-file-manifest"><strong>{sourceFiles.length > 0 ? `Manifest sorgente (${sourceFiles.length})` : "Contenuto generato"}</strong>{sourceFiles.length > 0 ? sourceFiles.map((file) => <span key={file.name} title={file.managed ? "Gestito con merge conservativo" : "Preservato byte per byte"}>{file.name}{file.managed ? "" : " · intatto"}</span>) : <><span>agency.txt</span><span>stops.txt</span><span>routes.txt</span><span>calendar.txt</span><span>calendar_dates.txt</span><span>trips.txt</span><span>stop_times.txt</span><span>shapes.txt</span><span>feed_info.txt</span></>}</div>
      </div>
    );
  }

  return (
    <div ref={dialogRef} className="builder-overlay" role="dialog" aria-modal="true" aria-labelledby="builder-title">
      <header className="builder-topbar">
        <div className="builder-brand"><span className="builder-brand-mark">G</span><div><strong id="builder-title">GTFS Studio</strong><small>{mode === "edit" ? `Modifica ${sourceLabel ?? draft.project.cityName}` : "Crea una rete da zero"}</small></div></div>
        <div className={`builder-save-state builder-save-state-${draftStorageStatus}`} aria-live="polite">
          <span />
          {draftStorageStatus === "memory"
            ? "Modifiche in memoria: salva o scarica prima di chiudere"
            : draftStorageStatus === "saving"
              ? "Salvataggio bozza..."
              : draftStorageStatus === "unavailable"
                ? "Recupero locale non disponibile: esporta prima di chiudere"
                : "Bozza salvata sul dispositivo"}
        </div>
        <div className="builder-top-actions"><button type="button" className="builder-reset" onClick={resetDraft}>{mode === "edit" ? "Ripristina" : "Ricomincia"}</button><button ref={closeButtonRef} type="button" className="builder-close" aria-label="Chiudi GTFS Studio" onClick={onClose}>×</button></div>
      </header>
      <div className="builder-body">
        <nav className="builder-steps" aria-label={mode === "edit" ? "Fasi modifica GTFS" : "Fasi creazione GTFS"}>
          <div className="builder-progress-copy"><span>Avanzamento</span><strong>{activeIndex + 1} / {STEPS.length}</strong></div>
          <div className="builder-progress-track"><span style={{ width: `${((activeIndex + 1) / STEPS.length) * 100}%` }} /></div>
          {STEPS.map((step, index) => {
            const stepIssues = issuesForStep(allIssues, step.id);
            const visited = index < activeIndex;
            return <button key={step.id} type="button" className={activeStep === step.id ? "builder-step builder-step-active" : "builder-step"} aria-label={`${step.label}: ${step.description}`} aria-current={activeStep === step.id ? "step" : undefined} onClick={() => selectStep(step.id)}><span className={visited && stepIssues.length === 0 ? "builder-step-number builder-step-complete" : "builder-step-number"}>{visited && stepIssues.length === 0 ? "✓" : step.number}</span><span><strong>{step.label}</strong><small>{step.description}</small></span>{stepIssues.length > 0 && (visited || activeStep === "publish") ? <i aria-label={`${stepIssues.length} errori`}>{stepIssues.length}</i> : null}</button>;
          })}
          <div className="builder-side-note"><span>GTFS</span><p>General Transit Feed Specification: il formato aperto per descrivere reti, percorsi e orari.</p></div>
        </nav>
        <div className="builder-content">
          {activeStep === "agency" ? renderAgencyStep() : null}
          {activeStep === "stops" ? renderStopsStep() : null}
          {activeStep === "routes" ? renderRoutesStep() : null}
          {activeStep === "service" ? renderServiceStep() : null}
          {activeStep === "publish" ? renderPublishStep() : null}
        </div>
      </div>
      <footer className="builder-footer">
        <div><strong>{draft.project.cityName || "Nuovo progetto"}</strong><span>{draft.project.cityCode || "Codice città da definire"}</span></div>
        <div className="builder-footer-actions"><button type="button" className="builder-back" disabled={activeIndex === 0} onClick={previousStep}>Indietro</button>{activeStep !== "publish" ? <button type="button" className="builder-next" onClick={nextStep}>Continua <span>→</span></button> : null}</div>
      </footer>
    </div>
  );
}
