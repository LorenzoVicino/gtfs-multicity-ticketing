import { db } from "@/lib/db";
import { formatGtfsTime, normalizeHexColor } from "@/lib/gtfs-builder-model";
import type { GtfsBuilderDraft, GtfsBuilderRoute, GtfsBuilderTrip } from "@/types/gtfs-builder";

type Row = Record<string, string | number | boolean | null>;

export async function getEditableGtfs(cityCode: string): Promise<GtfsBuilderDraft | null> {
  const cityResult = await db.query<Row>(
    `SELECT city_id, city_code, name FROM transport.city WHERE city_code = $1 LIMIT 1`,
    [cityCode.trim().toUpperCase()]
  );
  if (!cityResult.rowCount) return null;
  const city = cityResult.rows[0];
  const cityId = Number(city.city_id);

  const [agencyResult, serviceResult, stopResult, routeResult, tripResult, stopTimeResult] = await Promise.all([
    db.query<Row>(`SELECT gtfs_agency_id, name, COALESCE(url, '') AS url, timezone, COALESCE(lang_code, '') AS lang_code, COALESCE(phone, '') AS phone FROM transport.agency WHERE city_id = $1 AND is_active ORDER BY agency_id`, [cityId]),
    db.query<Row>(`SELECT gtfs_service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date::text, end_date::text FROM transport.calendar WHERE city_id = $1 AND (EXISTS (SELECT 1 FROM transport.trip t JOIN transport.stop_time st ON st.trip_id = t.trip_id WHERE t.calendar_id = calendar.calendar_id) OR NOT EXISTS (SELECT 1 FROM transport.trip t2 JOIN transport.stop_time st2 ON st2.trip_id = t2.trip_id WHERE t2.city_id = $1)) ORDER BY calendar_id`, [cityId]),
    db.query<Row>(`SELECT gtfs_stop_id, COALESCE(code, '') AS code, name, lat::text, lon::text, COALESCE(zone_id, '') AS zone_id, location_type, COALESCE((SELECT gtfs_stop_id FROM transport.stop parent WHERE parent.stop_id = child.parent_stop_id), '') AS parent_station, COALESCE(wheelchair_boarding, 0) AS wheelchair_boarding FROM transport.stop child WHERE city_id = $1 AND is_active ORDER BY stop_id`, [cityId]),
    db.query<Row>(`SELECT r.gtfs_route_id, a.gtfs_agency_id, COALESCE(r.short_name, '') AS short_name, COALESCE(r.long_name, '') AS long_name, r.route_type, COALESCE(r.color_hex, '') AS color_hex, COALESCE(r.text_color_hex, '') AS text_color_hex FROM transport.route r JOIN transport.agency a ON a.agency_id = r.agency_id WHERE r.city_id = $1 AND r.is_active ORDER BY r.route_id`, [cityId]),
    db.query<Row>(`WITH current_trips AS (SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.gtfs_trip_id ORDER BY t.service_date DESC, t.trip_id DESC) AS rn FROM transport.trip t WHERE t.city_id = $1 AND EXISTS (SELECT 1 FROM transport.stop_time st WHERE st.trip_id = t.trip_id)) SELECT t.trip_id, t.gtfs_trip_id, r.gtfs_route_id, c.gtfs_service_id, COALESCE(t.headsign, '') AS headsign, COALESCE(t.short_name, '') AS short_name, COALESCE(t.direction_id, 0) AS direction_id, COALESCE(t.block_id, '') AS block_id, COALESCE(t.wheelchair_accessible, 0) AS wheelchair_accessible, COALESCE(t.bikes_allowed, 0) AS bikes_allowed FROM current_trips t JOIN transport.route r ON r.route_id = t.route_id JOIN transport.calendar c ON c.calendar_id = t.calendar_id WHERE t.rn = 1 AND r.is_active ORDER BY t.trip_id`, [cityId]),
    db.query<Row>(`WITH current_trips AS (SELECT t.trip_id, t.gtfs_trip_id, ROW_NUMBER() OVER (PARTITION BY t.gtfs_trip_id ORDER BY t.service_date DESC, t.trip_id DESC) AS rn FROM transport.trip t WHERE t.city_id = $1 AND EXISTS (SELECT 1 FROM transport.stop_time present WHERE present.trip_id = t.trip_id)) SELECT ct.trip_id, s.gtfs_stop_id, EXTRACT(EPOCH FROM st.arrival_time)::int AS arrival_seconds, EXTRACT(EPOCH FROM st.departure_time)::int AS departure_seconds, st.pickup_type, st.drop_off_type, st.stop_sequence FROM current_trips ct JOIN transport.stop_time st ON st.trip_id = ct.trip_id JOIN transport.stop s ON s.stop_id = st.stop_id WHERE ct.rn = 1 AND s.is_active ORDER BY ct.trip_id, st.stop_sequence`, [cityId])
  ]);

  const agencies = agencyResult.rows.map((row) => ({ id: String(row.gtfs_agency_id), name: String(row.name), url: String(row.url), timezone: String(row.timezone), lang: String(row.lang_code), phone: String(row.phone) }));
  if (agencies.length === 0) return null;
  const services = serviceResult.rows.map((row) => ({
    id: String(row.gtfs_service_id), startDate: String(row.start_date), endDate: String(row.end_date),
    days: { monday: Boolean(row.monday), tuesday: Boolean(row.tuesday), wednesday: Boolean(row.wednesday), thursday: Boolean(row.thursday), friday: Boolean(row.friday), saturday: Boolean(row.saturday), sunday: Boolean(row.sunday) }
  }));
  const stops = stopResult.rows.map((row) => ({ id: String(row.gtfs_stop_id), code: String(row.code), name: String(row.name), lat: Number(row.lat), lon: Number(row.lon), zoneId: String(row.zone_id), locationType: String(row.location_type) as "0" | "1" | "2" | "3" | "4", parentStation: String(row.parent_station), wheelchairBoarding: String(row.wheelchair_boarding) as "0" | "1" | "2" }));
  const routes: GtfsBuilderRoute[] = routeResult.rows.map((row) => ({ id: String(row.gtfs_route_id), agencyId: String(row.gtfs_agency_id), shortName: String(row.short_name), longName: String(row.long_name), type: Number(row.route_type), color: normalizeHexColor(String(row.color_hex), "0F7B3E"), textColor: normalizeHexColor(String(row.text_color_hex), "FFFFFF"), stopIds: [] }));
  const stopTimesByTrip = new Map<number, GtfsBuilderTrip["stopTimes"]>();
  for (const row of stopTimeResult.rows) {
    const tripId = Number(row.trip_id);
    const times = stopTimesByTrip.get(tripId) ?? [];
    times.push({ stopId: String(row.gtfs_stop_id), arrivalTime: formatGtfsTime(Number(row.arrival_seconds)), departureTime: formatGtfsTime(Number(row.departure_seconds)), pickupType: String(row.pickup_type) as "0" | "1" | "2" | "3", dropOffType: String(row.drop_off_type) as "0" | "1" | "2" | "3" });
    stopTimesByTrip.set(tripId, times);
  }
  const trips: GtfsBuilderTrip[] = tripResult.rows.map((row) => ({ id: String(row.gtfs_trip_id), routeId: String(row.gtfs_route_id), serviceId: String(row.gtfs_service_id), headsign: String(row.headsign), shortName: String(row.short_name), directionId: Number(row.direction_id) === 1 ? 1 : 0, blockId: String(row.block_id), wheelchairAccessible: String(row.wheelchair_accessible) as "0" | "1" | "2", bikesAllowed: String(row.bikes_allowed) as "0" | "1" | "2", stopTimes: stopTimesByTrip.get(Number(row.trip_id)) ?? [] }));
  for (const route of routes) {
    const patterns = trips.filter((trip) => trip.routeId === route.id).map((trip) => trip.stopTimes.map((time) => time.stopId));
    route.stopIds = patterns.sort((a, b) => b.length - a.length)[0] ?? [];
  }

  return { version: 2, project: { cityCode: String(city.city_code), cityName: String(city.name) }, agencies, services, stops, routes, trips, updatedAt: new Date().toISOString() };
}
