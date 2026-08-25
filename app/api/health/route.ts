import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.query("SELECT 1");
    return Response.json({ status: "ok", database: "connected" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
