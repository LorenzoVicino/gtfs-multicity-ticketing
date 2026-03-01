import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AgencyTicketCatalogItem, CityTicketCatalog } from "@/types/ticketing";

type Params = {
  params: Promise<{
    cityCode: string;
  }>;
};

type TicketCatalogRow = {
  city_id: number;
  city_code: string;
  city_name: string;
  agency_id: number;
  gtfs_agency_id: string;
  agency_name: string;
  ticket_type_id: number | null;
  fare_id: number | null;
  ticket_type_name: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
  active: boolean | null;
};

export async function GET(_: Request, { params }: Params) {
  const { cityCode: rawCityCode } = await params;
  const cityCode = rawCityCode.trim().toUpperCase();

  if (!cityCode) {
    return NextResponse.json({ error: "cityCode mancante" }, { status: 400 });
  }

  try {
    const result = await db.query<TicketCatalogRow>(
      `
      SELECT
        c.city_id,
        c.city_code,
        c.name AS city_name,
        a.agency_id,
        a.gtfs_agency_id,
        a.name AS agency_name,
        tt.ticket_type_id,
        tt.fare_id,
        tt.name AS ticket_type_name,
        tt.duration_minutes,
        tt.price_cents,
        tt.active
      FROM transport.city c
      JOIN transport.agency a
        ON a.city_id = c.city_id
      LEFT JOIN transport.ticket_type tt
        ON tt.city_id = a.city_id
       AND tt.agency_id = a.agency_id
      WHERE c.city_code = $1
      ORDER BY a.name ASC, tt.price_cents ASC NULLS LAST, tt.duration_minutes ASC NULLS LAST, tt.name ASC NULLS LAST
      `,
      [cityCode]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Citta non trovata" }, { status: 404 });
    }

    const first = result.rows[0];
    const agencies = new Map<number, AgencyTicketCatalogItem>();

    for (const row of result.rows) {
      const current: AgencyTicketCatalogItem = agencies.get(row.agency_id) ?? {
        agencyId: row.agency_id,
        gtfsAgencyId: row.gtfs_agency_id,
        agencyName: row.agency_name,
        ticketTypes: []
      };

      if (
        row.ticket_type_id &&
        row.ticket_type_name &&
        row.duration_minutes !== null &&
        row.price_cents !== null &&
        row.active !== null
      ) {
        current.ticketTypes.push({
          ticketTypeId: row.ticket_type_id,
          fareId: row.fare_id,
          name: row.ticket_type_name,
          durationMinutes: row.duration_minutes,
          priceCents: row.price_cents,
          active: row.active
        });
      }

      agencies.set(row.agency_id, current);
    }

    return NextResponse.json({
      city: {
        id: first.city_id,
        cityCode: first.city_code,
        name: first.city_name
      },
      agencies: Array.from(agencies.values())
    } satisfies CityTicketCatalog);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lettura catalogo ticket fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  }
}
