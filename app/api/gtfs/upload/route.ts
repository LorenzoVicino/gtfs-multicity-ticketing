import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { importGtfsZip } from "@/lib/gtfs-upload";

function sanitizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

function sanitizeName(value: string): string {
  return value.trim().slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const cityCodeRaw = String(formData.get("cityCode") ?? "");
    const cityNameRaw = String(formData.get("cityName") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File GTFS non trovato" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Formato non supportato. Usa un file .zip" }, { status: 400 });
    }

    const cityCode = sanitizeCode(cityCodeRaw);
    const cityName = sanitizeName(cityNameRaw || cityCodeRaw);

    if (!cityCode || cityCode.length < 2) {
      return NextResponse.json({ error: "Inserisci un city code valido (es. BRI)" }, { status: 400 });
    }

    if (!cityName) {
      return NextResponse.json({ error: "Inserisci un nome citta valido" }, { status: 400 });
    }

    const uploadsRoot = path.join(process.cwd(), "data", "gtfs", "incoming", "uploads");
    await fs.mkdir(uploadsRoot, { recursive: true });

    const stamp = Date.now();
    const zipPath = path.join(uploadsRoot, `${cityCode}_${stamp}.zip`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(zipPath, buffer);

    const serviceDate = new Date().toISOString().slice(0, 10);
    await importGtfsZip({
      zipPath,
      cityCode,
      cityName,
      serviceDate
    });

    return NextResponse.json({ ok: true, cityCode, cityName });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Import GTFS fallito",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  }
}