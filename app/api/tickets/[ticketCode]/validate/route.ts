import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{
    ticketCode: string;
  }>;
};

type ValidationBody = {
  stopId?: number;
  segmentId?: number;
  validatorDevice?: string;
};

type TicketRow = {
  ticket_id: number;
  ticket_code: string;
  status: string;
  first_validated_at: string | null;
  valid_until: string | null;
  duration_minutes: number;
};

type UpdateRow = {
  first_validated_at: string | null;
  valid_until: string | null;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function asPositiveInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new HttpError(400, `${field} deve essere un intero positivo`);
  }

  return value as number;
}

function parseBody(raw: string): ValidationBody {
  if (!raw.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Body JSON non valido");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Body JSON non valido");
  }

  const body = parsed as Record<string, unknown>;

  if (body.validatorDevice !== undefined && typeof body.validatorDevice !== "string") {
    throw new HttpError(400, "validatorDevice deve essere una stringa");
  }

  return {
    stopId: asPositiveInt(body.stopId, "stopId") ?? undefined,
    segmentId: asPositiveInt(body.segmentId, "segmentId") ?? undefined,
    validatorDevice:
      typeof body.validatorDevice === "string" ? body.validatorDevice.trim().slice(0, 64) : undefined
  };
}

export async function POST(request: Request, { params }: Params) {
  const { ticketCode: rawTicketCode } = await params;
  const ticketCode = rawTicketCode.trim();

  if (!ticketCode) {
    return NextResponse.json({ error: "ticketCode mancante" }, { status: 400 });
  }

  let body: ValidationBody;
  try {
    const rawBody = await request.text();
    body = parseBody(rawBody);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const client = await db.connect();
  let txStarted = false;

  try {
    await client.query("BEGIN");
    txStarted = true;
    await client.query("SET search_path TO transport, public");

    const ticketResult = await client.query<TicketRow>(
      `
      SELECT
        t.ticket_id,
        t.ticket_code,
        t.status,
        t.first_validated_at::text,
        t.valid_until::text,
        tt.duration_minutes
      FROM ticket t
      JOIN ticket_type tt ON tt.ticket_type_id = t.ticket_type_id
      WHERE t.ticket_code = $1
      FOR UPDATE
      `,
      [ticketCode]
    );

    if (ticketResult.rowCount === 0) {
      throw new HttpError(404, "Ticket non trovato");
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status !== "ISSUED") {
      throw new HttpError(409, "Ticket non valido per la validazione");
    }

    await client.query(
      `
      INSERT INTO validation (ticket_id, validated_at, stop_id, segment_id, validator_device)
      VALUES ($1, NOW(), $2, $3, $4)
      `,
      [ticket.ticket_id, body.stopId ?? null, body.segmentId ?? null, body.validatorDevice ?? null]
    );

    let firstValidatedAt = ticket.first_validated_at;
    let validUntil = ticket.valid_until;

    if (!ticket.first_validated_at) {
      const updateResult = await client.query<UpdateRow>(
        `
        UPDATE ticket
        SET
          first_validated_at = NOW(),
          valid_until = NOW() + ($2 * INTERVAL '1 minute')
        WHERE ticket_id = $1
        RETURNING first_validated_at::text, valid_until::text
        `,
        [ticket.ticket_id, ticket.duration_minutes]
      );

      firstValidatedAt = updateResult.rows[0].first_validated_at;
      validUntil = updateResult.rows[0].valid_until;
    }

    const nowResult = await client.query<{ now_ts: string }>("SELECT NOW()::text AS now_ts");
    const nowTs = new Date(nowResult.rows[0].now_ts);
    const validUntilTs = validUntil ? new Date(validUntil) : null;
    const isValid = validUntilTs ? nowTs.getTime() <= validUntilTs.getTime() : false;

    await client.query("COMMIT");
    txStarted = false;

    return NextResponse.json({
      ticketCode: ticket.ticket_code,
      firstValidatedAt,
      validUntil,
      isValid,
      durationMinutes: ticket.duration_minutes
    });
  } catch (error) {
    if (txStarted) {
      await client.query("ROLLBACK");
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: "Validazione ticket fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}