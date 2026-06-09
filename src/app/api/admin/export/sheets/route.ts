// POST /api/admin/export/sheets — push current state to the private Google Sheet
// (06 §3.18, 09). Phase 1 writes a single private spreadsheet (SHEET_ID).
import { route, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/auth";
import { runSheetsExport } from "@/lib/sheets";

export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  enforceRateLimit(req, "admin", ctx.user.id);

  let mode: "FULL" | "AUDIT_APPEND" = "FULL";
  try {
    const body = await req.json();
    if (body?.mode === "AUDIT_APPEND") mode = "AUDIT_APPEND";
  } catch {
    // default FULL
  }

  const result = await runSheetsExport(mode);
  return ok({ rows_written: result.rowsWritten, sheet_export_log_id: result.exportLogId, ok: true });
});
