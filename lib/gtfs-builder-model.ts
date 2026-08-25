import type {
  GtfsBuilderDraft,
  GtfsBuilderIssue,
  GtfsBuilderStep,
  GtfsBuilderStopTime,
  LegacyGtfsBuilderDraft
} from "@/types/gtfs-builder";

export const GTFS_BUILDER_STORAGE_KEY = "gtfs-builder-draft-v2";

export const GTFS_ROUTE_TYPES = [
  { value: 0, label: "Tram" },
  { value: 1, label: "Metropolitana" },
  { value: 2, label: "Treno" },
  { value: 3, label: "Bus" },
  { value: 4, label: "Traghetto" },
  { value: 5, label: "Funivia" },
  { value: 6, label: "Cabinovia" },
  { value: 7, label: "Funicolare" },
  { value: 11, label: "Filobus" },
  { value: 12, label: "Monorotaia" }
] as const;

export const GTFS_WEEKDAYS = [
  { key: "monday", short: "Lun", label: "Lunedì" },
  { key: "tuesday", short: "Mar", label: "Martedì" },
  { key: "wednesday", short: "Mer", label: "Mercoledì" },
  { key: "thursday", short: "Gio", label: "Giovedì" },
  { key: "friday", short: "Ven", label: "Venerdì" },
  { key: "saturday", short: "Sab", label: "Sabato" },
  { key: "sunday", short: "Dom", label: "Domenica" }
] as const;

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyGtfsDraft(): GtfsBuilderDraft {
  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  return {
    version: 2,
    project: { cityCode: "", cityName: "" },
    agencies: [{ id: "AGENCY_1", name: "", url: "https://", timezone: "Europe/Rome", lang: "it", phone: "" }],
    services: [{
      id: "WEEKDAY",
      startDate: dateInputValue(start),
      endDate: dateInputValue(end),
      days: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false }
    }],
    stops: [],
    routes: [],
    trips: [],
    updatedAt: new Date().toISOString()
  };
}

export function upgradeGtfsDraft(value: unknown): GtfsBuilderDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    version?: number;
    project?: unknown;
    agencies?: unknown;
    services?: unknown;
    stops?: unknown;
    routes?: unknown;
    trips?: unknown;
  };
  if (!candidate.project || !Array.isArray(candidate.stops) || !Array.isArray(candidate.routes) || !Array.isArray(candidate.trips)) return null;
  if (candidate.version === 2 && Array.isArray(candidate.agencies) && Array.isArray(candidate.services)) return value as GtfsBuilderDraft;
  if (candidate.version !== 1) return null;
  const legacy = value as LegacyGtfsBuilderDraft;
  return {
    version: 2,
    project: { cityCode: legacy.project.cityCode, cityName: legacy.project.cityName },
    agencies: [{ id: legacy.project.agencyId, name: legacy.project.agencyName, url: legacy.project.agencyUrl, timezone: legacy.project.agencyTimezone, lang: legacy.project.agencyLang, phone: "" }],
    services: [{ id: legacy.project.serviceId, startDate: legacy.project.serviceStartDate, endDate: legacy.project.serviceEndDate, days: legacy.project.serviceDays }],
    stops: legacy.stops,
    routes: legacy.routes.map((route) => ({ ...route, agencyId: legacy.project.agencyId })),
    trips: legacy.trips.map((trip) => ({ ...trip, serviceId: legacy.project.serviceId })),
    updatedAt: legacy.updatedAt
  };
}

export function safeGtfsId(value: string, fallback: string): string {
  return value.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) || fallback;
}

export function normalizeHexColor(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

export function parseGtfsTime(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!match || Number(match[1]) > 47) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function formatGtfsTime(totalSeconds: number): string {
  const normalized = Math.max(0, Math.min(totalSeconds, 47 * 3600 + 59 * 60 + 59));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildStopTimes(stopIds: string[], firstDeparture: string, minutesBetweenStops: number): GtfsBuilderStopTime[] {
  const base = parseGtfsTime(firstDeparture) ?? 8 * 3600;
  const interval = Math.max(1, Math.min(180, Math.round(minutesBetweenStops))) * 60;
  return stopIds.map((stopId, index) => {
    const time = formatGtfsTime(base + index * interval);
    return { stopId, arrivalTime: time, departureTime: time, pickupType: "0", dropOffType: "0" };
  });
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export function validateGtfsDraft(draft: GtfsBuilderDraft): GtfsBuilderIssue[] {
  const issues: GtfsBuilderIssue[] = [];
  if (!/^[A-Z0-9_-]{2,16}$/.test(draft.project.cityCode.trim().toUpperCase())) issues.push({ step: "agency", field: "cityCode", message: "Il city code deve avere 2–16 lettere o numeri." });
  if (!draft.project.cityName.trim()) issues.push({ step: "agency", field: "cityName", message: "Inserisci il nome della città." });

  if (draft.agencies.length === 0) issues.push({ step: "agency", message: "Inserisci almeno un’agenzia." });
  const agencyIds = new Set<string>();
  for (const agency of draft.agencies) {
    const id = safeGtfsId(agency.id, "");
    if (!id || agencyIds.has(id)) issues.push({ step: "agency", field: agency.id, message: `ID agenzia non valido o duplicato: ${agency.id || "vuoto"}.` });
    agencyIds.add(id);
    if (!agency.name.trim()) issues.push({ step: "agency", field: agency.id, message: `Inserisci il nome dell’agenzia ${id || "senza ID"}.` });
    if (!isValidUrl(agency.url)) issues.push({ step: "agency", field: agency.id, message: `Inserisci un URL completo per l’agenzia ${id || "senza ID"}.` });
    if (!agency.timezone.trim()) issues.push({ step: "agency", field: agency.id, message: `Inserisci il fuso orario dell’agenzia ${id || "senza ID"}.` });
  }

  if (draft.services.length === 0) issues.push({ step: "agency", message: "Inserisci almeno un calendario di servizio." });
  const serviceIds = new Set<string>();
  for (const service of draft.services) {
    const id = safeGtfsId(service.id, "");
    if (!id || serviceIds.has(id)) issues.push({ step: "agency", field: service.id, message: `ID servizio non valido o duplicato: ${service.id || "vuoto"}.` });
    serviceIds.add(id);
    if (!isDateInput(service.startDate) || !isDateInput(service.endDate) || service.startDate > service.endDate) issues.push({ step: "agency", field: service.id, message: `Controlla le date del servizio ${id || "senza ID"}.` });
    if (!Object.values(service.days).some(Boolean)) issues.push({ step: "agency", field: service.id, message: `Seleziona almeno un giorno per il servizio ${id}.` });
  }

  if (draft.stops.length < 2) issues.push({ step: "stops", message: "Crea almeno due fermate sulla mappa." });
  const stopIds = new Set<string>();
  for (const stop of draft.stops) {
    const id = safeGtfsId(stop.id, "");
    if (!id || stopIds.has(id)) issues.push({ step: "stops", field: stop.id, message: `ID fermata non valido o duplicato: ${stop.id || "vuoto"}.` });
    stopIds.add(id);
    if (!stop.name.trim()) issues.push({ step: "stops", field: stop.id, message: `Assegna un nome alla fermata ${id || "senza ID"}.` });
    if (!Number.isFinite(stop.lat) || stop.lat < -90 || stop.lat > 90 || !Number.isFinite(stop.lon) || stop.lon < -180 || stop.lon > 180) issues.push({ step: "stops", field: stop.id, message: `Coordinate non valide per la fermata ${id || "senza ID"}.` });
  }

  if (draft.routes.length === 0) issues.push({ step: "routes", message: "Crea almeno una linea." });
  const routeIds = new Set<string>();
  for (const route of draft.routes) {
    const id = safeGtfsId(route.id, "");
    if (!id || routeIds.has(id)) issues.push({ step: "routes", field: route.id, message: `ID linea non valido o duplicato: ${route.id || "vuoto"}.` });
    routeIds.add(id);
    if (!agencyIds.has(safeGtfsId(route.agencyId, ""))) issues.push({ step: "routes", field: route.id, message: `La linea ${id} non è associata a un’agenzia valida.` });
    if (!route.shortName.trim() && !route.longName.trim()) issues.push({ step: "routes", field: route.id, message: `Inserisci un nome per la linea ${id || "senza ID"}.` });
    if (route.stopIds.length < 2) issues.push({ step: "routes", field: route.id, message: `La linea ${id || "senza ID"} deve contenere almeno due fermate.` });
    if (route.stopIds.some((stopId) => !stopIds.has(safeGtfsId(stopId, "")))) issues.push({ step: "routes", field: route.id, message: `La linea ${id} contiene una fermata non disponibile.` });
  }

  if (draft.trips.length === 0) issues.push({ step: "service", message: "Crea almeno una corsa con i relativi orari." });
  for (const route of draft.routes) if (!draft.trips.some((trip) => trip.routeId === route.id)) issues.push({ step: "service", field: route.id, message: `Aggiungi almeno una corsa alla linea ${route.shortName || route.id}.` });
  const tripIds = new Set<string>();
  for (const trip of draft.trips) {
    const id = safeGtfsId(trip.id, "");
    if (!id || tripIds.has(id)) issues.push({ step: "service", field: trip.id, message: `ID corsa non valido o duplicato: ${trip.id || "vuoto"}.` });
    tripIds.add(id);
    if (!routeIds.has(safeGtfsId(trip.routeId, ""))) issues.push({ step: "service", field: trip.id, message: `La corsa ${id} non è associata a una linea valida.` });
    if (!serviceIds.has(safeGtfsId(trip.serviceId, ""))) issues.push({ step: "service", field: trip.id, message: `La corsa ${id} non usa un calendario valido.` });
    if (trip.stopTimes.length < 2 || trip.stopTimes.some((time) => !stopIds.has(safeGtfsId(time.stopId, "")))) {
      issues.push({ step: "service", field: trip.id, message: `La corsa ${id} deve avere almeno due fermate valide.` });
      continue;
    }
    let previousDeparture = -1;
    for (const time of trip.stopTimes) {
      const arrival = parseGtfsTime(time.arrivalTime);
      const departure = parseGtfsTime(time.departureTime);
      if (arrival === null || departure === null || arrival > departure || arrival < previousDeparture) {
        issues.push({ step: "service", field: trip.id, message: `Gli orari della corsa ${id} non sono validi o cronologici.` });
        break;
      }
      previousDeparture = departure;
    }
  }
  return issues;
}

export function issuesForStep(issues: GtfsBuilderIssue[], step: GtfsBuilderStep): GtfsBuilderIssue[] {
  return issues.filter((issue) => issue.step === step);
}
