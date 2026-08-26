import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { normalizeHexColor, safeGtfsId } from "@/lib/gtfs-builder-model";
import type {
  GtfsBuilderAgency,
  GtfsBuilderDraft,
  GtfsBuilderRoute,
  GtfsBuilderService,
  GtfsBuilderStop,
  GtfsBuilderStopTime,
  GtfsBuilderTrip,
  GtfsServiceDays
} from "@/types/gtfs-builder";

const REQUIRED_FILES = ["agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt"] as const;
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_RECORDS = 180_000;

type ParseHints = { cityCode: string; cityName: string };
type CsvRow = Record<string, string>;

function isoDate(value: string, fallback: string): string {
  const normalized = value.trim();
  if (/^\d{8}$/.test(normalized)) return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return fallback;
}

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numericChoice<T extends string>(value: string, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function daysFromRow(row: CsvRow): GtfsServiceDays {
  return {
    monday: row.monday === "1",
    tuesday: row.tuesday === "1",
    wednesday: row.wednesday === "1",
    thursday: row.thursday === "1",
    friday: row.friday === "1",
    saturday: row.saturday === "1",
    sunday: row.sunday === "1"
  };
}

function normalizeTime(value: string): string {
  const normalized = value.trim();
  return /^\d{1,2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
}

export function parseGtfsArchive(buffer: Buffer, hints: ParseHints): GtfsBuilderDraft {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const files = new Map<string, Buffer>();
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
    if (!name || files.has(name)) continue;
    uncompressedBytes += entry.header.size;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("Il feed supera gli 80 MB decompressi e non può essere modificato nel browser.");
    const data = entry.getData();
    files.set(name, data);
  }
  for (const required of REQUIRED_FILES) if (!files.has(required)) throw new Error(`File GTFS mancante: ${required}`);

  let recordCount = 0;
  function rows(fileName: string): CsvRow[] {
    const data = files.get(fileName);
    if (!data) return [];
    const records = parse(data.toString("utf8"), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as CsvRow[];
    recordCount += records.length;
    if (recordCount > MAX_RECORDS) throw new Error("Il feed supera il limite di 180.000 record modificabili nello Studio.");
    return records;
  }

  const agencyRows = rows("agency.txt");
  const stopRows = rows("stops.txt");
  const routeRows = rows("routes.txt");
  const calendarRows = rows("calendar.txt");
  const calendarDateRows = rows("calendar_dates.txt");
  const tripRows = rows("trips.txt");
  const stopTimeRows = rows("stop_times.txt");
  const feedInfoRows = rows("feed_info.txt");

  const agencies: GtfsBuilderAgency[] = agencyRows.map((row, index) => ({
    id: safeGtfsId(row.agency_id, `AGENCY_${index + 1}`),
    name: row.agency_name?.trim() || `Agenzia ${index + 1}`,
    url: row.agency_url?.trim() || "",
    timezone: row.agency_timezone?.trim() || "Europe/Rome",
    lang: row.agency_lang?.trim() || "it",
    phone: row.agency_phone?.trim() || ""
  }));
  if (agencies.length === 0) throw new Error("agency.txt non contiene agenzie valide.");
  const agencyIds = new Set(agencies.map((agency) => agency.id));

  const now = new Date();
  const nextYear = new Date(now);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const fallbackStart = dateValue(now);
  const fallbackEnd = dateValue(nextYear);
  const exceptionsByService = new Map<string, GtfsBuilderService["exceptions"]>();
  for (const row of calendarDateRows) {
    const serviceId = safeGtfsId(row.service_id, "");
    const date = isoDate(row.date, "");
    if (!serviceId || !date || (row.exception_type !== "1" && row.exception_type !== "2")) continue;
    const exceptions = exceptionsByService.get(serviceId) ?? [];
    exceptions.push({ date, exceptionType: row.exception_type });
    exceptionsByService.set(serviceId, exceptions);
  }

  const services: GtfsBuilderService[] = calendarRows
    .filter((row) => row.service_id)
    .map((row) => {
      const id = safeGtfsId(row.service_id, "SERVICE");
      return {
        id,
        startDate: isoDate(row.start_date, fallbackStart),
        endDate: isoDate(row.end_date, fallbackEnd),
        days: daysFromRow(row),
        exceptions: exceptionsByService.get(id) ?? []
      };
    });
  const serviceIds = new Set(services.map((service) => service.id));
  for (const row of tripRows) {
    const id = safeGtfsId(row.service_id, "SERVICE");
    if (!serviceIds.has(id)) {
      const exceptions = exceptionsByService.get(id) ?? [];
      const dates = exceptions.map((exception) => exception.date).sort();
      services.push({
        id,
        startDate: dates[0] ?? fallbackStart,
        endDate: dates[dates.length - 1] ?? fallbackEnd,
        days: {
          monday: exceptions.length === 0,
          tuesday: exceptions.length === 0,
          wednesday: exceptions.length === 0,
          thursday: exceptions.length === 0,
          friday: exceptions.length === 0,
          saturday: exceptions.length === 0,
          sunday: exceptions.length === 0
        },
        exceptions
      });
      serviceIds.add(id);
    }
  }

  const stops: GtfsBuilderStop[] = stopRows
    .map((row) => ({
      id: safeGtfsId(row.stop_id, ""),
      code: row.stop_code?.trim() || "",
      name: row.stop_name?.trim() || row.stop_id?.trim() || "",
      lat: row.stop_lat?.trim() ? Number(row.stop_lat) : Number.NaN,
      lon: row.stop_lon?.trim() ? Number(row.stop_lon) : Number.NaN,
      zoneId: row.zone_id?.trim() || "",
      locationType: numericChoice(row.location_type, ["0", "1", "2", "3", "4"] as const, "0"),
      parentStation: row.parent_station?.trim() || "",
      wheelchairBoarding: numericChoice(row.wheelchair_boarding, ["0", "1", "2"] as const, "0")
    }))
    .filter((stop) => stop.id && Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
  const stopIds = new Set(stops.map((stop) => stop.id));

  const routes: GtfsBuilderRoute[] = routeRows
    .map((row) => {
      const type = Number(row.route_type);
      return {
        id: safeGtfsId(row.route_id, ""),
        agencyId: agencyIds.has(safeGtfsId(row.agency_id, "")) ? safeGtfsId(row.agency_id, "") : agencies[0].id,
        shortName: row.route_short_name?.trim() || "",
        longName: row.route_long_name?.trim() || "",
        type: [0, 1, 2, 3, 4, 5, 6, 7, 11, 12].includes(type) ? type : 3,
        color: normalizeHexColor(row.route_color || "", "0F7B3E"),
        textColor: normalizeHexColor(row.route_text_color || "", "FFFFFF"),
        stopIds: []
      };
    })
    .filter((route) => route.id);
  const routeIds = new Set(routes.map((route) => route.id));

  const stopTimesByTrip = new Map<string, Array<GtfsBuilderStopTime & { sequence: number }>>();
  for (const row of stopTimeRows) {
    const tripId = safeGtfsId(row.trip_id, "");
    const stopId = safeGtfsId(row.stop_id, "");
    if (!tripId || !stopIds.has(stopId)) continue;
    const time = normalizeTime(row.arrival_time || row.departure_time || "");
    const departure = normalizeTime(row.departure_time || row.arrival_time || "");
    const item = {
      stopId,
      arrivalTime: time,
      departureTime: departure,
      pickupType: numericChoice(row.pickup_type, ["0", "1", "2", "3"] as const, "0"),
      dropOffType: numericChoice(row.drop_off_type, ["0", "1", "2", "3"] as const, "0"),
      shapeDistTraveled: row.shape_dist_traveled?.trim() || undefined,
      sequence: Number(row.stop_sequence) || 0
    };
    stopTimesByTrip.set(tripId, [...(stopTimesByTrip.get(tripId) ?? []), item]);
  }

  const trips: GtfsBuilderTrip[] = tripRows
    .map((row) => {
      const id = safeGtfsId(row.trip_id, "");
      const stopTimes = (stopTimesByTrip.get(id) ?? []).sort((a, b) => a.sequence - b.sequence).map((time) => ({
        stopId: time.stopId,
        arrivalTime: time.arrivalTime,
        departureTime: time.departureTime,
        stopSequence: time.sequence,
        pickupType: time.pickupType,
        dropOffType: time.dropOffType,
        shapeDistTraveled: time.shapeDistTraveled
      }));
      return {
        id,
        routeId: safeGtfsId(row.route_id, ""),
        serviceId: safeGtfsId(row.service_id, services[0]?.id ?? "SERVICE"),
        headsign: row.trip_headsign?.trim() || "",
        shortName: row.trip_short_name?.trim() || "",
        directionId: row.direction_id === "1" ? 1 : 0,
        blockId: row.block_id?.trim() || "",
        shapeId: row.shape_id?.trim() || undefined,
        wheelchairAccessible: numericChoice(row.wheelchair_accessible, ["0", "1", "2"] as const, "0"),
        bikesAllowed: numericChoice(row.bikes_allowed, ["0", "1", "2"] as const, "0"),
        stopTimes
      } as GtfsBuilderTrip;
    })
    .filter((trip) => trip.id && routeIds.has(trip.routeId) && trip.stopTimes.length >= 2);

  for (const route of routes) {
    const patterns = trips.filter((trip) => trip.routeId === route.id).map((trip) => trip.stopTimes.map((time) => time.stopId));
    route.stopIds = patterns.sort((a, b) => b.length - a.length)[0] ?? [];
  }

  const feedInfoRow = feedInfoRows[0];
  const primaryService = services[0];
  const feedInfo = feedInfoRow ? {
    publisherName: feedInfoRow.feed_publisher_name?.trim() || agencies[0].name,
    publisherUrl: feedInfoRow.feed_publisher_url?.trim() || agencies[0].url,
    lang: feedInfoRow.feed_lang?.trim() || agencies[0].lang || "it",
    startDate: isoDate(feedInfoRow.feed_start_date, primaryService?.startDate ?? fallbackStart),
    endDate: isoDate(feedInfoRow.feed_end_date, primaryService?.endDate ?? fallbackEnd),
    version: feedInfoRow.feed_version?.trim() || "",
    contactEmail: feedInfoRow.feed_contact_email?.trim() || undefined,
    contactUrl: feedInfoRow.feed_contact_url?.trim() || undefined
  } : undefined;

  return {
    version: 2,
    project: { cityCode: hints.cityCode.trim().toUpperCase(), cityName: hints.cityName.trim() },
    agencies,
    services,
    stops,
    routes,
    trips,
    feedInfo,
    updatedAt: new Date().toISOString()
  };
}
