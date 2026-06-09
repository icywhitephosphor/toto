// Audit trail. Every bet write, result change, claim, rebind, settlement,
// recompute and export inserts an audit_log row with before/after JSON
// (architecture/04 §7, 12 §2). Accepts either the db handle or a transaction so
// the audit row is written in the same transaction as the change it records.
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;

export interface AuditEntry {
  actorUserId?: string | null;
  actorKind: "USER" | "ADMIN" | "SYSTEM";
  action: string; // 'BET_UPSERT','RESULT_OVERRIDE','RECOMPUTE','EXPORT',...
  entityType: string; // 'match_bet','bonus_bet','match_result',...
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(exec: DbExecutor, e: AuditEntry): Promise<void> {
  await exec.insert(auditLog).values({
    actorUserId: e.actorUserId ?? null,
    actorKind: e.actorKind,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
  });
}
