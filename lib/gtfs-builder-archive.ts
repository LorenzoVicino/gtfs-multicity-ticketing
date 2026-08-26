import AdmZip from "adm-zip";
import { stringify } from "csv-stringify/sync";
import { normalizeHexColor, safeGtfsId, validateGtfsDraft } from "@/lib/gtfs-builder-model";
import type { GtfsBuilderDraft, GtfsBuilderStop } from "@/types/gtfs-builder";

function gtfsDate(value: string): string {
  return value.replaceAll("-", "");
}

function distanceKm(a: GtfsBuilderStop, b: GtfsBuilderStop): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(b.lat - a.lat);
  const lonDelta = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(value));
}

function csv(columns: string[], records: Record<string, string | number>[]): Buffer {
  return Buffer.from(stringify(records, { header: true, columns, record_delimiter: "windows" }), "utf8");
}

export function createGtfsArchive(draft: GtfsBuilderDraft): Buffer {
  const issues = validateGtfsDraft(draft);
  if (issues.length > 0) {
    throw new Error(issues[0].message);
  }

  const zip = new AdmZip();
  const stopById = new Map(draft.stops.map((stop) => [stop.id, stop]));
  const primaryAgency = draft.agencies[0];
  const primaryService = draft.services[0];

  zip.addFile(
    "agency.txt",
    csv(
      ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone"],
      draft.agencies.map((agency) => ({
        agency_id: safeGtfsId(agency.id, "AGENCY"),
        agency_name: agency.name.trim(),
        agency_url: agency.url.trim(),
        agency_timezone: agency.timezone.trim(),
        agency_lang: agency.lang.trim() || "it",
        agency_phone: agency.phone.trim()
      }))
    )
  );

  zip.addFile(
    "stops.txt",
    csv(
      ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon", "zone_id", "location_type", "parent_station", "wheelchair_boarding"],
      draft.stops.map((stop) => ({
        stop_id: safeGtfsId(stop.id, "STOP"),
        stop_code: stop.code.trim(),
        stop_name: stop.name.trim(),
        stop_lat: stop.lat.toFixed(6),
        stop_lon: stop.lon.toFixed(6),
        zone_id: stop.zoneId?.trim() ?? "",
        location_type: stop.locationType ?? "0",
        parent_station: stop.parentStation?.trim() ?? "",
        wheelchair_boarding: stop.wheelchairBoarding
      }))
    )
  );

  zip.addFile(
    "routes.txt",
    csv(
      ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
      draft.routes.map((route) => ({
        route_id: safeGtfsId(route.id, "ROUTE"),
        agency_id: safeGtfsId(route.agencyId, primaryAgency.id),
        route_short_name: route.shortName.trim(),
        route_long_name: route.longName.trim(),
        route_type: route.type,
        route_color: normalizeHexColor(route.color, "0F7B3E"),
        route_text_color: normalizeHexColor(route.textColor, "FFFFFF")
      }))
    )
  );

  zip.addFile(
    "calendar.txt",
    csv(
      ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
      draft.services.map((service) => ({
        service_id: safeGtfsId(service.id, "SERVICE"),
        monday: service.days.monday ? 1 : 0,
        tuesday: service.days.tuesday ? 1 : 0,
        wednesday: service.days.wednesday ? 1 : 0,
        thursday: service.days.thursday ? 1 : 0,
        friday: service.days.friday ? 1 : 0,
        saturday: service.days.saturday ? 1 : 0,
        sunday: service.days.sunday ? 1 : 0,
        start_date: gtfsDate(service.startDate),
        end_date: gtfsDate(service.endDate)
      }))
    )
  );

  zip.addFile(
    "calendar_dates.txt",
    csv(
      ["service_id", "date", "exception_type"],
      draft.services.flatMap((service) => (service.exceptions ?? []).map((exception) => ({
        service_id: safeGtfsId(service.id, "SERVICE"),
        date: gtfsDate(exception.date),
        exception_type: exception.exceptionType
      })))
    )
  );

  zip.addFile(
    "trips.txt",
    csv(
      ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", "block_id", "wheelchair_accessible", "bikes_allowed", "shape_id"],
      draft.trips.map((trip) => ({
        route_id: safeGtfsId(trip.routeId, "ROUTE"),
        service_id: safeGtfsId(trip.serviceId, primaryService.id),
        trip_id: safeGtfsId(trip.id, "TRIP"),
        trip_headsign: trip.headsign.trim(),
        trip_short_name: trip.shortName?.trim() ?? "",
        direction_id: trip.directionId,
        block_id: trip.blockId?.trim() ?? "",
        wheelchair_accessible: trip.wheelchairAccessible ?? "0",
        bikes_allowed: trip.bikesAllowed ?? "0",
        shape_id: safeGtfsId(trip.shapeId ?? "", "") || `SHAPE_${safeGtfsId(trip.id, "TRIP")}`
      }))
    )
  );

  const shapeDistanceByTrip = new Map<string, number[]>();
  const shapeRows: Record<string, string | number>[] = [];
  const generatedShapeIds = new Set<string>();
  for (const trip of draft.trips) {
    let cumulativeDistance = 0;
    const distances: number[] = [];
    const shapeId = safeGtfsId(trip.shapeId ?? "", "") || `SHAPE_${safeGtfsId(trip.id, "TRIP")}`;
    trip.stopTimes.forEach((stopTime, index) => {
      const stopId = stopTime.stopId;
      const stop = stopById.get(stopId);
      if (!stop) {
        return;
      }
      if (index > 0) {
        const previousStop = stopById.get(trip.stopTimes[index - 1].stopId);
        if (previousStop) {
          cumulativeDistance += distanceKm(previousStop, stop);
        }
      }
      const preservedDistance = Number(stopTime.shapeDistTraveled);
      const distance = Number.isFinite(preservedDistance) ? preservedDistance : cumulativeDistance;
      distances.push(distance);
      if (!generatedShapeIds.has(shapeId)) {
        shapeRows.push({
          shape_id: shapeId,
          shape_pt_lat: stop.lat.toFixed(6),
          shape_pt_lon: stop.lon.toFixed(6),
          shape_pt_sequence: index + 1,
          shape_dist_traveled: distance.toFixed(3)
        });
      }
    });
    generatedShapeIds.add(shapeId);
    shapeDistanceByTrip.set(trip.id, distances);
  }

  zip.addFile(
    "stop_times.txt",
    csv(
      ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type", "shape_dist_traveled"],
      draft.trips.flatMap((trip) => {
        const distances = shapeDistanceByTrip.get(trip.id) ?? [];
        return trip.stopTimes.map((stopTime, index) => ({
          trip_id: safeGtfsId(trip.id, "TRIP"),
          arrival_time: stopTime.arrivalTime,
          departure_time: stopTime.departureTime,
          stop_id: safeGtfsId(stopTime.stopId, "STOP"),
          stop_sequence: stopTime.stopSequence ?? index + 1,
          pickup_type: stopTime.pickupType ?? "0",
          drop_off_type: stopTime.dropOffType ?? "0",
          shape_dist_traveled: stopTime.shapeDistTraveled?.trim() || (distances[index] ?? 0).toFixed(3)
        }));
      })
    )
  );

  zip.addFile(
    "shapes.txt",
    csv(["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"], shapeRows)
  );

  zip.addFile(
    "feed_info.txt",
    csv(
      ["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version", "feed_contact_email", "feed_contact_url"],
      [{
        feed_publisher_name: draft.feedInfo?.publisherName.trim() || primaryAgency.name.trim(),
        feed_publisher_url: draft.feedInfo?.publisherUrl.trim() || primaryAgency.url.trim(),
        feed_lang: draft.feedInfo?.lang.trim() || primaryAgency.lang.trim() || "it",
        feed_start_date: gtfsDate(draft.feedInfo?.startDate || draft.services.map((service) => service.startDate).sort()[0] || primaryService.startDate),
        feed_end_date: gtfsDate(draft.feedInfo?.endDate || draft.services.map((service) => service.endDate).sort().at(-1) || primaryService.endDate),
        feed_version: draft.updatedAt,
        feed_contact_email: draft.feedInfo?.contactEmail?.trim() ?? "",
        feed_contact_url: draft.feedInfo?.contactUrl?.trim() ?? ""
      }]
    )
  );

  return zip.toBuffer();
}
