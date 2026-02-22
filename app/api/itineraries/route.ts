import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type SegmentInput = {
  segmentSeq?: number;
  tripId?: number;
  fromStopId?: number;
  toStopId?: number;
};

type CreateItineraryBody = {
  cityCode?: string;
  cityId?: number;
  segments?: SegmentInput[];
};

type CityRow = { city_id: number };

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function validateBody(body: CreateItineraryBody): {
  cityCode?: string;
  cityId?: number;
  segments: Array<{ segmentSeq: number; tripId: number; fromStopId: number; toStopId: number }>;
} {
  const cityCode = body.cityCode?.trim().toUpperCase();
  const cityId = body.cityId;

  if (!cityCode && !isPositiveInt(cityId)) {
    throw new HttpError(400, "Fornisci cityCode oppure cityId valido");
  }

  if (!Array.isArray(body.segments) || body.segments.length < 1 || body.segments.length > 2) {
    throw new HttpError(400, "segments deve contenere 1 o 2 elementi");
  }

  const normalized = body.segments.map((segment, idx) => {
    if (!isPositiveInt(segment.segmentSeq)) {
      throw new HttpError(400, `segments[${idx}].segmentSeq non valido`);
    }

    if (!isPositiveInt(segment.tripId)) {
      throw new HttpError(400, `segments[${idx}].tripId non valido`);
    }

    if (!isPositiveInt(segment.fromStopId)) {
      throw new HttpError(400, `segments[${idx}].fromStopId non valido`);
    }

    if (!isPositiveInt(segment.toStopId)) {
      throw new HttpError(400, `segments[${idx}].toStopId non valido`);
    }

    if (segment.fromStopId === segment.toStopId) {
      throw new HttpError(400, `segments[${idx}] deve avere fromStopId diverso da toStopId`);
    }

    return {
      segmentSeq: segment.segmentSeq,
      tripId: segment.tripId,
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId
    };
  });

  const seqSorted = [...normalized].map((s) => s.segmentSeq).sort((a, b) => a - b);
  const expected = Array.from({ length: normalized.length }, (_, i) => i + 1);

  if (JSON.stringify(seqSorted) !== JSON.stringify(expected)) {
    throw new HttpError(400, "segmentSeq deve essere unico e progressivo (1..N)");
  }

  return {
    cityCode: cityCode || undefined,
    cityId: isPositiveInt(cityId) ? cityId : undefined,
    segments: normalized
  };
}

export async function POST(request: Request) {
  let body: CreateItineraryBody;

  try {
    body = (await request.json()) as CreateItineraryBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  let payload;
  try {
    payload = validateBody(body);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Input non valido" }, { status: 400 });
  }

  const client = await db.connect();
  let txStarted = false;

  try {
    await client.query("BEGIN");
    txStarted = true;
    await client.query("SET search_path TO transport, public");

    let cityId: number;

    if (payload.cityCode) {
      const cityResult = await client.query<CityRow>(
        `SELECT city_id FROM city WHERE city_code = $1 LIMIT 1`,
        [payload.cityCode]
      );

      if (cityResult.rowCount === 0) {
        throw new HttpError(404, "Citta non trovata");
      }

      cityId = cityResult.rows[0].city_id;
    } else {
      const cityResult = await client.query<CityRow>(
        `SELECT city_id FROM city WHERE city_id = $1 LIMIT 1`,
        [payload.cityId]
      );

      if (cityResult.rowCount === 0) {
        throw new HttpError(404, "cityId non trovato");
      }

      cityId = cityResult.rows[0].city_id;
    }

    const tripIds = payload.segments.map((s) => s.tripId);
    const tripCountResult = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM trip WHERE trip_id = ANY($1::bigint[]) AND city_id = $2`,
      [tripIds, cityId]
    );

    if (Number(tripCountResult.rows[0].cnt) !== tripIds.length) {
      throw new HttpError(404, "Uno o piu trip_id non trovati per la citta richiesta");
    }

    const stopIds = Array.from(
      new Set(payload.segments.flatMap((segment) => [segment.fromStopId, segment.toStopId]))
    );

    const stopCountResult = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM stop WHERE stop_id = ANY($1::bigint[]) AND city_id = $2`,
      [stopIds, cityId]
    );

    if (Number(stopCountResult.rows[0].cnt) !== stopIds.length) {
      throw new HttpError(404, "Uno o piu stop_id non trovati per la citta richiesta");
    }

    const itineraryInsert = await client.query<{ itinerary_id: number }>(
      `INSERT INTO itinerary (city_id) VALUES ($1) RETURNING itinerary_id`,
      [cityId]
    );

    const itineraryId = itineraryInsert.rows[0].itinerary_id;

    for (const segment of payload.segments) {
      await client.query(
        `
        INSERT INTO itinerary_segment (itinerary_id, segment_seq, trip_id, from_stop_id, to_stop_id)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [itineraryId, segment.segmentSeq, segment.tripId, segment.fromStopId, segment.toStopId]
      );
    }

    await client.query("COMMIT");
    txStarted = false;

    return NextResponse.json(
      {
        itineraryId,
        cityId,
        segments: payload.segments
      },
      { status: 201 }
    );
  } catch (error) {
    if (txStarted) {
      await client.query("ROLLBACK");
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: "Creazione itinerario fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}