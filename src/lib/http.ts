// HTTP envelope + error model for all API route handlers (architecture/06 §1).
// Every response carries a top-level `server_time` (ISO 8601 UTC) so clients
// calibrate countdowns from the server clock, never their own (11 §3.3).
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

export function serverTime(): string {
  return new Date().toISOString();
}

/** A controlled API error. `code` is a machine constant from 06 §6. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

type JsonBody = Record<string, unknown>;

/** Success response with `server_time` merged in. */
export function ok(body: JsonBody = {}, init?: ResponseInit): NextResponse {
  return NextResponse.json({ server_time: serverTime(), ...body }, init);
}

export function errorResponse(err: AppError): NextResponse {
  return NextResponse.json(
    {
      server_time: serverTime(),
      error: { code: err.code, message: err.message, detail: err.detail ?? null },
    },
    { status: err.status },
  );
}

/**
 * Wrap a route handler so thrown AppErrors and ZodErrors become the canonical
 * envelope, and anything unexpected becomes a 500 with a request id for log
 * correlation (06 §1.4). Generic over the Next.js context (params) argument.
 */
export function route<Ctx = unknown>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse> | NextResponse,
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err);
      if (err instanceof ZodError) {
        return errorResponse(
          new AppError(400, "BAD_REQUEST", "Invalid request body", err.issues),
        );
      }
      const requestId = crypto.randomUUID();
      console.error(`[${requestId}] Unhandled error:`, err);
      return NextResponse.json(
        {
          server_time: serverTime(),
          error: {
            code: "INTERNAL_ERROR",
            message: "Unexpected server error",
            detail: { request_id: requestId },
          },
        },
        { status: 500 },
      );
    }
  };
}

/** Parse + validate a JSON body with a Zod schema; 400 BAD_REQUEST on bad JSON. */
export async function parseJson<T>(req: NextRequest, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Malformed JSON body");
  }
  return schema.parse(raw);
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export function clientMeta(req: NextRequest): ClientMeta {
  // Trust the RIGHTMOST X-Forwarded-For entry, not the leftmost. Our only
  // ingress is Caddy (the app binds 127.0.0.1:3000), and Caddy *appends* the
  // real peer IP to whatever the client sent. The leftmost value is fully
  // client-controlled, so reading it lets anyone spoof a fresh rate-limit
  // bucket per request; the rightmost is the address Caddy actually observed.
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd
    ? fwd.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? null
    : req.headers.get("x-real-ip");
  return { ip: ip || null, userAgent: req.headers.get("user-agent") };
}
