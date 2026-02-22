import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type PurchaseBody = {
  cityCode?: string;
  cityId?: number;
  ticketTypeName?: string;
  ticketTypeId?: number;
  customer?: {
    email?: string;
    fullName?: string;
  };
  passengers?: Array<{
    fullName?: string;
    birthDate?: string | null;
  }>;
};

type CityRow = { city_id: number };
type TicketTypeRow = {
  ticket_type_id: number;
  name: string;
  duration_minutes: number;
  price_cents: number;
};
type CustomerRow = { customer_id: number };
type PassengerRow = { passenger_id: number };

function makeCode(prefix: string, bytes = 6): string {
  return `${prefix}-${randomBytes(bytes).toString("hex").toUpperCase()}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseBirthDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "INVALID_DATE";
  }

  return value;
}

export async function POST(request: Request) {
  let body: PurchaseBody;

  try {
    body = (await request.json()) as PurchaseBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const cityCode = body.cityCode?.trim().toUpperCase();
  const cityIdInput = body.cityId;
  const ticketTypeName = body.ticketTypeName?.trim();
  const ticketTypeIdInput = body.ticketTypeId;
  const customerEmail = body.customer?.email?.trim().toLowerCase();
  const customerFullName = body.customer?.fullName?.trim();
  const passengersInput = body.passengers ?? [];

  if (!cityCode && !cityIdInput) {
    return NextResponse.json(
      { error: "Fornisci cityCode (preferito) oppure cityId" },
      { status: 400 }
    );
  }

  if (!ticketTypeName && !ticketTypeIdInput) {
    return NextResponse.json(
      { error: "Fornisci ticketTypeName (preferito) oppure ticketTypeId" },
      { status: 400 }
    );
  }

  if (!customerEmail || !customerFullName) {
    return NextResponse.json(
      { error: "customer.email e customer.fullName sono obbligatori" },
      { status: 400 }
    );
  }

  if (!isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "Email non valida" }, { status: 400 });
  }

  if (!Array.isArray(passengersInput) || passengersInput.length === 0) {
    return NextResponse.json(
      { error: "passengers deve contenere almeno un elemento" },
      { status: 400 }
    );
  }

  for (const passenger of passengersInput) {
    if (!passenger.fullName?.trim()) {
      return NextResponse.json(
        { error: "Ogni passenger deve avere fullName" },
        { status: 400 }
      );
    }

    if (passenger.birthDate && parseBirthDate(passenger.birthDate) === "INVALID_DATE") {
      return NextResponse.json(
        { error: `birthDate non valido per passenger ${passenger.fullName}` },
        { status: 400 }
      );
    }
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET search_path TO transport, public");

    let cityId: number;

    if (cityCode) {
      const cityResult = await client.query<CityRow>(
        `SELECT city_id
         FROM city
         WHERE city_code = $1
         LIMIT 1`,
        [cityCode]
      );

      if (cityResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Citta non trovata" }, { status: 404 });
      }

      cityId = cityResult.rows[0].city_id;
    } else {
      const cityResult = await client.query<CityRow>(
        `SELECT city_id
         FROM city
         WHERE city_id = $1
         LIMIT 1`,
        [cityIdInput]
      );

      if (cityResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "cityId non trovato" }, { status: 404 });
      }

      cityId = cityResult.rows[0].city_id;
    }

    let ticketType: TicketTypeRow | null = null;

    if (ticketTypeName) {
      const ticketTypeResult = await client.query<TicketTypeRow>(
        `SELECT ticket_type_id, name, duration_minutes, price_cents
         FROM ticket_type
         WHERE city_id = $1
           AND name = $2
           AND active = TRUE
         LIMIT 1`,
        [cityId, ticketTypeName]
      );

      ticketType = ticketTypeResult.rows[0] ?? null;
    } else {
      const ticketTypeResult = await client.query<TicketTypeRow>(
        `SELECT ticket_type_id, name, duration_minutes, price_cents
         FROM ticket_type
         WHERE city_id = $1
           AND ticket_type_id = $2
           AND active = TRUE
         LIMIT 1`,
        [cityId, ticketTypeIdInput]
      );

      ticketType = ticketTypeResult.rows[0] ?? null;
    }

    if (!ticketType) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Ticket type attivo non trovato per la citta richiesta" },
        { status: 404 }
      );
    }

    const customerResult = await client.query<CustomerRow>(
      `INSERT INTO customer (email, full_name)
       VALUES ($1, $2)
       ON CONFLICT (email)
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING customer_id`,
      [customerEmail, customerFullName]
    );

    const customerId = customerResult.rows[0].customer_id;
    const totalCents = ticketType.price_cents * passengersInput.length;

    let bookingId: number | null = null;
    let bookingCode = "";

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = makeCode("BKG", 4);
      const bookingInsert = await client.query<{ booking_id: number }>(
        `INSERT INTO booking (customer_id, booking_code, status, total_cents)
         VALUES ($1, $2, 'PAID', $3)
         ON CONFLICT (booking_code) DO NOTHING
         RETURNING booking_id`,
        [customerId, candidate, totalCents]
      );

      if (bookingInsert.rowCount === 1) {
        bookingId = bookingInsert.rows[0].booking_id;
        bookingCode = candidate;
        break;
      }
    }

    if (!bookingId) {
      throw new Error("Impossibile generare booking_code univoco");
    }

    await client.query(
      `INSERT INTO payment (booking_id, provider, amount_cents, status, paid_at, external_ref)
       VALUES ($1, 'mock', $2, 'PAID', NOW(), $3)`,
      [bookingId, totalCents, makeCode("PAY", 6)]
    );

    const tickets: Array<{ ticketCode: string; passengerName: string }> = [];

    for (const passengerInput of passengersInput) {
      const passengerName = passengerInput.fullName!.trim();
      const birthDate = parseBirthDate(passengerInput.birthDate);

      const passengerInsert = await client.query<PassengerRow>(
        `INSERT INTO passenger (customer_id, full_name, birth_date)
         VALUES ($1, $2, $3)
         RETURNING passenger_id`,
        [customerId, passengerName, birthDate]
      );

      const passengerId = passengerInsert.rows[0].passenger_id;

      let ticketCode = "";
      let inserted = false;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = makeCode("TKT", 6);
        const ticketInsert = await client.query(
          `INSERT INTO ticket (booking_id, passenger_id, ticket_type_id, ticket_code, status)
           VALUES ($1, $2, $3, $4, 'ISSUED')
           ON CONFLICT (ticket_code) DO NOTHING
           RETURNING ticket_id`,
          [bookingId, passengerId, ticketType.ticket_type_id, candidate]
        );

        if (ticketInsert.rowCount === 1) {
          ticketCode = candidate;
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        throw new Error("Impossibile generare ticket_code univoco");
      }

      tickets.push({ ticketCode, passengerName });
    }

    await client.query("COMMIT");

    return NextResponse.json(
      {
        bookingCode,
        totalCents,
        tickets,
        ticketType: {
          name: ticketType.name,
          durationMinutes: ticketType.duration_minutes,
          priceCents: ticketType.price_cents
        }
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      {
        error: "Acquisto ticket fallito",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}