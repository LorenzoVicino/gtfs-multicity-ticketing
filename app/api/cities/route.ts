import { NextResponse } from "next/server";
import { getCities } from "@/lib/gtfs";

export async function GET() {
  try {
    const cities = await getCities();
    return NextResponse.json({ cities });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Impossibile leggere le citta dal database",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  }
}