import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type StopRow = {
  stop_name: string;
};

type DepartureRow = {
  departure_ts: string;
  line_name: string;
  route_id: number;
  trip_id: number;
};

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function isValidServiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cityId = parsePositiveInt(searchParams.get("cityId"));
  const stopId = parsePositiveInt(searchParams.get("stopId"));
  const serviceDate = searchParams.get("serviceDate")?.trim() ?? todayIsoDate();

  if (!cityId || !stopId) {
    return NextResponse.json(
      { error: "cityId e stopId sono obbligatori e devono essere interi positivi" },
      { status: 400 }
    );
  }

  if (!isValidServiceDate(serviceDate)) {
    return NextResponse.json(
      { error: "serviceDate non valido, usa formato YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const client = await db.connect();

  try {
    await client.query("SET search_path TO transport, public");

    const stopResult = await client.query<StopRow>(
      `
      SELECT name AS stop_name
      FROM stop
      WHERE city_id = $1
        AND stop_id = $2
      LIMIT 1
      `,
      [cityId, stopId]
    );

    if (stopResult.rowCount === 0) {
      return NextResponse.json({ error: "Fermata non trovata per la citta indicata" }, { status: 404 });
    }

    const departuresResult = await client.query<DepartureRow>(
      `
      SELECT
          to_char(t.service_date + st.departure_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS departure_ts,
          COALESCE(NULLIF(r.short_name, ''), NULLIF(r.long_name, ''), r.gtfs_route_id) AS line_name,
          r.route_id,
          t.trip_id
      FROM stop_time st
      JOIN trip t
        ON t.trip_id = st.trip_id
       AND t.city_id = st.city_id
      JOIN route r
        ON r.route_id = t.route_id
       AND r.city_id = t.city_id
      WHERE st.city_id = $1
        AND st.stop_id = $2
        AND t.service_date = $3::date
        AND (t.service_date + st.departure_time) >= NOW()
      ORDER BY t.service_date + st.departure_time
      LIMIT 10
      `,
      [cityId, stopId, serviceDate]
    );

    return NextResponse.json({
      cityId,
      stopId,
      stopName: stopResult.rows[0].stop_name,
      serviceDate,
      departures: departuresResult.rows.map((row: DepartureRow) => ({
        departureTs: row.departure_ts,
        lineName: row.line_name,
        routeId: row.route_id,
        tripId: row.trip_id
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Impossibile leggere le prossime partenze",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
