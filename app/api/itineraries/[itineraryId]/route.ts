import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{
    itineraryId: string;
  }>;
};

type ItineraryRow = {
  itinerary_id: number;
  city_id: number;
  created_at: string;
};

type SegmentRow = {
  segment_id: number;
  segment_seq: number;
  trip_id: number;
  from_stop_id: number;
  to_stop_id: number;
};

export async function GET(_: Request, { params }: Params) {
  const { itineraryId: rawItineraryId } = await params;
  const itineraryId = Number.parseInt(rawItineraryId, 10);

  if (Number.isNaN(itineraryId) || itineraryId <= 0) {
    return NextResponse.json({ error: "itineraryId non valido" }, { status: 400 });
  }

  const client = await db.connect();

  try {
    await client.query("SET search_path TO transport, public");

    const itineraryResult = await client.query<ItineraryRow>(
      `
      SELECT itinerary_id, city_id, created_at::text
      FROM itinerary
      WHERE itinerary_id = $1
      LIMIT 1
      `,
      [itineraryId]
    );

    if (itineraryResult.rowCount === 0) {
      return NextResponse.json({ error: "Itinerario non trovato" }, { status: 404 });
    }

    const itinerary = itineraryResult.rows[0];

    const segmentsResult = await client.query<SegmentRow>(
      `
      SELECT
        segment_id,
        segment_seq,
        trip_id,
        from_stop_id,
        to_stop_id
      FROM itinerary_segment
      WHERE itinerary_id = $1
      ORDER BY segment_seq ASC
      `,
      [itineraryId]
    );

    return NextResponse.json({
      itineraryId: itinerary.itinerary_id,
      cityId: itinerary.city_id,
      createdAt: itinerary.created_at,
      segments: segmentsResult.rows.map((segment) => ({
        segmentId: segment.segment_id,
        segmentSeq: segment.segment_seq,
        tripId: segment.trip_id,
        fromStopId: segment.from_stop_id,
        toStopId: segment.to_stop_id
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lettura itinerario fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}