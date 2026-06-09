// GET /api/health — liveness + DB check (architecture/12 §5.6). Used by the
// Docker healthcheck, the deploy script, and UptimeRobot.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true, status: "ok", db: "up", service: "toto", ts: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, status: "error", db: "down", error: String(e), ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
