import { parseGtfsArchive } from "@/lib/gtfs-builder-parser";

export const runtime = "nodejs";

function code(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const cityCode = code(String(formData.get("cityCode") ?? ""));
    const cityName = String(formData.get("cityName") ?? "").trim().slice(0, 120);
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip")) return Response.json({ error: "Seleziona un archivio GTFS .zip." }, { status: 400 });
    if (!cityCode || cityCode.length < 2 || !cityName) return Response.json({ error: "Inserisci city code e nome città prima di aprire il feed." }, { status: 400 });
    if (file.size > 60 * 1024 * 1024) return Response.json({ error: "Archivio troppo grande (massimo 60 MB)." }, { status: 413 });
    const draft = parseGtfsArchive(Buffer.from(await file.arrayBuffer()), { cityCode, cityName });
    return Response.json({ draft });
  } catch (error) {
    return Response.json({ error: "Impossibile aprire il GTFS nello Studio.", details: error instanceof Error ? error.message : "Errore sconosciuto" }, { status: 422 });
  }
}
