import { NextResponse } from "next/server";
import { getGtfsByCityCode } from "@/lib/gtfs";

type Params = {
  params: Promise<{
    cityCode: string;
  }>;
};

export async function GET(_: Request, { params }: Params) {
  const { cityCode } = await params;

  try {
    const payload = await getGtfsByCityCode(cityCode);
    if (!payload) {
      return NextResponse.json({ error: "Citta non trovata" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Impossibile leggere il GTFS della citta richiesta",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  }
}
