import { getEditableGtfs } from "@/lib/gtfs-builder-store";

type Params = { params: Promise<{ cityCode: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { cityCode } = await params;
    const draft = await getEditableGtfs(cityCode);
    if (!draft) return Response.json({ error: "Città o feed modificabile non trovato." }, { status: 404 });
    return Response.json({ draft });
  } catch (error) {
    return Response.json({ error: "Impossibile aprire questa città nello Studio.", details: error instanceof Error ? error.message : "Errore sconosciuto" }, { status: 500 });
  }
}
