import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type BookingRow = {
  booking_id: number;
  booking_code: string;
  status: string;
  created_at: string;
  total_cents: number;
};

type DetailRow = {
  row_type: "ticket" | "payment";
  booking_id: number;
  ticket_code: string | null;
  ticket_status: string | null;
  valid_until: string | null;
  passenger_name: string | null;
  qr_token: string | null;
  agency_id: number | null;
  agency_name: string | null;
  ticket_type_id: number | null;
  ticket_type_name: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
  provider: string | null;
  payment_status: string | null;
  paid_at: string | null;
  external_ref: string | null;
};

type BookingResponse = {
  bookingCode: string;
  status: string;
  createdAt: string;
  totalCents: number;
  tickets: Array<{
    ticketCode: string;
    status: string;
    validUntil: string | null;
    passengerName: string | null;
    qrToken: string | null;
    agencyId: number | null;
    agencyName: string | null;
    ticketTypeId: number | null;
    ticketTypeName: string | null;
    durationMinutes: number | null;
    priceCents: number | null;
  }>;
  payments: Array<{
    provider: string;
    status: string;
    paidAt: string | null;
    externalRef: string | null;
  }>;
};

function parseLimit(value: string | null): number {
  if (!value) {
    return 20;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(parsed, 100);
}

function parseOffset(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const limit = parseLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));

  if (!email) {
    return NextResponse.json({ error: "email query param obbligatorio" }, { status: 400 });
  }

  const client = await db.connect();

  try {
    await client.query("SET search_path TO transport, public");

    const customerResult = await client.query<{ customer_id: number }>(
      `
      SELECT customer_id
      FROM customer
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (customerResult.rowCount === 0) {
      return NextResponse.json({ error: "Customer non trovato" }, { status: 404 });
    }

    const customerId = customerResult.rows[0].customer_id;

    const bookingsResult = await client.query<BookingRow>(
      `
      SELECT
        booking_id,
        booking_code,
        status,
        created_at::text,
        total_cents
      FROM booking
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      OFFSET $3
      `,
      [customerId, limit, offset]
    );

    if (bookingsResult.rowCount === 0) {
      return NextResponse.json({ email, bookings: [] });
    }

    const bookingIds = bookingsResult.rows.map((row: BookingRow) => row.booking_id);

    const detailsResult = await client.query<DetailRow>(
      `
      SELECT
        'ticket'::text AS row_type,
        t.booking_id,
        t.ticket_code,
        t.status AS ticket_status,
        t.valid_until::text,
        p.full_name AS passenger_name,
        t.qr_payload AS qr_token,
        tt.agency_id,
        a.name AS agency_name,
        tt.ticket_type_id,
        tt.name AS ticket_type_name,
        tt.duration_minutes,
        tt.price_cents,
        NULL::text AS provider,
        NULL::text AS payment_status,
        NULL::text AS paid_at,
        NULL::text AS external_ref
      FROM ticket t
      LEFT JOIN passenger p ON p.passenger_id = t.passenger_id
      LEFT JOIN ticket_type tt ON tt.ticket_type_id = t.ticket_type_id
      LEFT JOIN agency a ON a.agency_id = tt.agency_id AND a.city_id = tt.city_id
      WHERE t.booking_id = ANY($1::bigint[])

      UNION ALL

      SELECT
        'payment'::text AS row_type,
        pay.booking_id,
        NULL::text AS ticket_code,
        NULL::text AS ticket_status,
        NULL::text AS valid_until,
        NULL::text AS passenger_name,
        NULL::text AS qr_token,
        NULL::bigint AS agency_id,
        NULL::text AS agency_name,
        NULL::bigint AS ticket_type_id,
        NULL::text AS ticket_type_name,
        NULL::integer AS duration_minutes,
        NULL::integer AS price_cents,
        pay.provider,
        pay.status AS payment_status,
        pay.paid_at::text,
        pay.external_ref
      FROM payment pay
      WHERE pay.booking_id = ANY($1::bigint[])
      `,
      [bookingIds]
    );

    const bookingMap = new Map<number, BookingResponse>();

    for (const booking of bookingsResult.rows as BookingRow[]) {
      bookingMap.set(booking.booking_id, {
        bookingCode: booking.booking_code,
        status: booking.status,
        createdAt: booking.created_at,
        totalCents: booking.total_cents,
        tickets: [],
        payments: []
      });
    }

    for (const row of detailsResult.rows) {
      const target = bookingMap.get(row.booking_id);
      if (!target) {
        continue;
      }

      if (row.row_type === "ticket") {
        if (row.ticket_code && row.ticket_status) {
          target.tickets.push({
            ticketCode: row.ticket_code,
            status: row.ticket_status,
            validUntil: row.valid_until,
            passengerName: row.passenger_name,
            qrToken: row.qr_token,
            agencyId: row.agency_id,
            agencyName: row.agency_name,
            ticketTypeId: row.ticket_type_id,
            ticketTypeName: row.ticket_type_name,
            durationMinutes: row.duration_minutes,
            priceCents: row.price_cents
          });
        }
      } else if (row.provider && row.payment_status) {
        target.payments.push({
          provider: row.provider,
          status: row.payment_status,
          paidAt: row.paid_at,
          externalRef: row.external_ref
        });
      }
    }

    return NextResponse.json({
      email,
      bookings: bookingsResult.rows
        .map((row: BookingRow) => bookingMap.get(row.booking_id))
        .filter((value: BookingResponse | undefined): value is BookingResponse => Boolean(value))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lettura storico prenotazioni fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
