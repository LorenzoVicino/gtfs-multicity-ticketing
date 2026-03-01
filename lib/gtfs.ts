import { db } from "@/lib/db";
import type { City, RouteLine, StopPoint } from "@/types/gtfs";

type CityRow = {
  city_id: number;
  city_code: string;
  city_name: string;
};

type StopRow = {
  stop_id: number;
  stop_code: string | null;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
};

type RoutePointRow = {
  route_id: number;
  agency_id: number | null;
  agency_name: string | null;
  short_name: string | null;
  long_name: string | null;
  line_name: string;
  color_hex: string | null;
  stop_id: number;
  stop_lat: string;
  stop_lon: string;
};

type RouteStatsRow = {
  route_id: number;
  trips_count: number;
  stop_events: number;
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) {
    return 0;
  }
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh >= 0 && hh < 1) {
    r1 = c;
    g1 = x;
  } else if (hh >= 1 && hh < 2) {
    r1 = x;
    g1 = c;
  } else if (hh >= 2 && hh < 3) {
    g1 = c;
    b1 = x;
  } else if (hh >= 3 && hh < 4) {
    g1 = x;
    b1 = c;
  } else if (hh >= 4 && hh < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

function vibrantColorFromSeed(seed: number): string {
  const hue = Math.abs(seed * 137.508) % 360;
  const sat = 0.74;
  const light = 0.46;
  const [r, g, b] = hslToRgb(hue, sat, light);
  return rgbToHex(r, g, b);
}

function normalizeInputColor(colorHex: string, routeId: number): string {
  const [r, g, b] = hexToRgb(colorHex);
  const lum = luminance(r, g, b);
  const sat = saturation(r, g, b);

  // If feed color is usable, keep it as-is (preserves Bari style).
  if (lum < 0.86 && sat >= 0.22) {
    return `#${colorHex.toUpperCase()}`;
  }

  // White/gray/pastel feeds (e.g. Bologna) get a vivid deterministic palette.
  return vibrantColorFromSeed(routeId);
}

function normalizeRouteColor(colorHex: string | null, routeId: number): string {
  if (colorHex && /^[0-9A-Fa-f]{6}$/.test(colorHex)) {
    return normalizeInputColor(colorHex, routeId);
  }
  return vibrantColorFromSeed(routeId);
}

function assignRouteCategories(routes: RouteLine[]): RouteLine[] {
  if (routes.length === 0) {
    return routes;
  }

  const scored = routes
    .map((route) => {
      const score = route.tripsCount + route.stopEvents * 0.02;
      return { ...route, routeScore: Number(score.toFixed(2)), routeCategory: "local" as const };
    })
    .sort((a, b) => b.routeScore - a.routeScore || a.routeId - b.routeId);

  const total = scored.length;
  const coreCut = Math.max(3, Math.ceil(total * 0.22));
  const secondaryCut = Math.max(coreCut + 2, Math.ceil(total * 0.58));

  return scored.map((route, idx) => {
    if (idx < coreCut) {
      return { ...route, routeCategory: "core" as const };
    }
    if (idx < secondaryCut) {
      return { ...route, routeCategory: "secondary" as const };
    }
    return { ...route, routeCategory: "local" as const };
  });
}

export async function getCities(): Promise<City[]> {
  const result = await db.query<CityRow>(
    `
    SELECT city_id, city_code, name AS city_name
    FROM transport.city
    ORDER BY name ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.city_id,
    cityCode: row.city_code,
    name: row.city_name
  }));
}

export async function getGtfsByCityCode(cityCode: string): Promise<{
  city: City;
  stops: StopPoint[];
  routes: RouteLine[];
} | null> {
  const cityResult = await db.query<CityRow>(
    `
    SELECT city_id, city_code, name AS city_name
    FROM transport.city
    WHERE city_code = $1
    LIMIT 1
    `,
    [cityCode.toUpperCase()]
  );

  if (cityResult.rowCount === 0) {
    return null;
  }

  const cityRow = cityResult.rows[0];
  const cityId = cityRow.city_id;

  const stopsResult = await db.query<StopRow>(
    `
    SELECT
      stop_id,
      code AS stop_code,
      name AS stop_name,
      lat::text AS stop_lat,
      lon::text AS stop_lon
    FROM transport.stop
    WHERE city_id = $1
    ORDER BY name ASC
    LIMIT 5000
    `,
    [cityId]
  );

  const routePointsResult = await db.query<RoutePointRow>(
    `
    WITH ranked_trips AS (
      SELECT
        t.trip_id,
        t.route_id,
        r.agency_id,
        a.name AS agency_name,
        r.short_name,
        r.long_name,
        r.color_hex,
        COALESCE(NULLIF(r.short_name, ''), NULLIF(r.long_name, ''), r.gtfs_route_id) AS line_name,
        ROW_NUMBER() OVER (
          PARTITION BY t.route_id
          ORDER BY t.service_date DESC, t.trip_id
        ) AS rn
      FROM transport.trip t
      JOIN transport.route r
        ON r.route_id = t.route_id
       AND r.city_id = t.city_id
      LEFT JOIN transport.agency a
        ON a.agency_id = r.agency_id
       AND a.city_id = r.city_id
      WHERE t.city_id = $1
    )
    SELECT
      rt.route_id,
      rt.agency_id,
      rt.agency_name,
      rt.short_name,
      rt.long_name,
      rt.line_name,
      rt.color_hex,
      s.stop_id,
      s.lat::text AS stop_lat,
      s.lon::text AS stop_lon
    FROM ranked_trips rt
    JOIN transport.stop_time st
      ON st.trip_id = rt.trip_id
     AND st.city_id = $1
    JOIN transport.stop s
      ON s.stop_id = st.stop_id
     AND s.city_id = $1
    WHERE rt.rn = 1
    ORDER BY rt.route_id, st.stop_sequence
    LIMIT 15000
    `,
    [cityId]
  );

  const routeStatsResult = await db.query<RouteStatsRow>(
    `
    WITH trip_counts AS (
      SELECT route_id, COUNT(*)::int AS trips_count
      FROM transport.trip
      WHERE city_id = $1
      GROUP BY route_id
    ),
    stop_events AS (
      SELECT t.route_id, COUNT(*)::int AS stop_events
      FROM transport.trip t
      JOIN transport.stop_time st
        ON st.trip_id = t.trip_id
       AND st.city_id = t.city_id
      WHERE t.city_id = $1
      GROUP BY t.route_id
    )
    SELECT
      r.route_id,
      COALESCE(tc.trips_count, 0) AS trips_count,
      COALESCE(se.stop_events, 0) AS stop_events
    FROM transport.route r
    LEFT JOIN trip_counts tc ON tc.route_id = r.route_id
    LEFT JOIN stop_events se ON se.route_id = r.route_id
    WHERE r.city_id = $1
    `,
    [cityId]
  );

  const statsByRouteId = new Map<number, { tripsCount: number; stopEvents: number }>();
  for (const row of routeStatsResult.rows) {
    statsByRouteId.set(row.route_id, {
      tripsCount: row.trips_count,
      stopEvents: row.stop_events
    });
  }

  const groupedRoutes = new Map<number, RouteLine>();
  for (const point of routePointsResult.rows) {
    const stats = statsByRouteId.get(point.route_id) ?? { tripsCount: 0, stopEvents: 0 };
    const item = groupedRoutes.get(point.route_id) ?? {
      routeId: point.route_id,
      agencyId: point.agency_id,
      agencyName: point.agency_name,
      lineName: point.line_name,
      shortName: point.short_name,
      longName: point.long_name,
      color: normalizeRouteColor(point.color_hex, point.route_id),
      points: [],
      stopIds: [],
      tripsCount: stats.tripsCount,
      stopEvents: stats.stopEvents,
      routeScore: 0,
      routeCategory: "local"
    };

    item.points.push([Number(point.stop_lat), Number(point.stop_lon)]);
    item.stopIds.push(point.stop_id);
    groupedRoutes.set(point.route_id, item);
  }

  const routes = assignRouteCategories(
    Array.from(groupedRoutes.values()).filter((route) => route.points.length > 1)
  );

  return {
    city: {
      id: cityRow.city_id,
      cityCode: cityRow.city_code,
      name: cityRow.city_name
    },
    stops: stopsResult.rows.map((row) => ({
      stopId: row.stop_id,
      stopCode: row.stop_code,
      stopName: row.stop_name,
      lat: Number(row.stop_lat),
      lon: Number(row.stop_lon)
    })),
    routes
  };
}
