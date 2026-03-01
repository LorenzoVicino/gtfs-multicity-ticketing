import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { asTicketingError, validateTicketWithClient } from "@/lib/ticketing";

type ValidationBody = {
  ticketCode?: string;
  qrToken?: string;
  stopId?: number;
  segmentId?: number;
  validatorDevice?: string;
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
    throw new HttpError(400, "Body JSON non valido");
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

  if (body.ticketCode !== undefined && typeof body.ticketCode !== "string") {
    throw new HttpError(400, "ticketCode deve essere una stringa");
  }

  if (body.qrToken !== undefined && typeof body.qrToken !== "string") {
    throw new HttpError(400, "qrToken deve essere una stringa");
  }

  if (body.validatorDevice !== undefined && typeof body.validatorDevice !== "string") {
    throw new HttpError(400, "validatorDevice deve essere una stringa");
  }

  const result = {
    ticketCode: typeof body.ticketCode === "string" ? body.ticketCode.trim() : undefined,
    qrToken: typeof body.qrToken === "string" ? body.qrToken.trim() : undefined,
    stopId: asPositiveInt(body.stopId, "stopId") ?? undefined,
    segmentId: asPositiveInt(body.segmentId, "segmentId") ?? undefined,
    validatorDevice:
      typeof body.validatorDevice === "string" ? body.validatorDevice.trim().slice(0, 64) : undefined
  };

  if (!result.ticketCode && !result.qrToken) {
    throw new HttpError(400, "ticketCode o qrToken obbligatorio");
  }

  return result;
}

export async function POST(request: Request) {
  let body: ValidationBody;
  try {
    body = parseBody(await request.text());
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

    const result = await validateTicketWithClient(client, body);

    await client.query("COMMIT");
    txStarted = false;

    return NextResponse.json(result);
  } catch (error) {
    if (txStarted) {
      await client.query("ROLLBACK");
    }

    const ticketingError = asTicketingError(error);
    if (ticketingError) {
      return NextResponse.json({ error: ticketingError.message }, { status: ticketingError.status });
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
