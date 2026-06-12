// Stateless JWT session in an httpOnly+Secure+SameSite=Lax cookie (07 §6, 06 §1.3).
// Lax (not Strict) is required so the Login Widget redirect callback carries the
// cookie on the top-level navigation back to our origin.
import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { env } from "./env";

export const SESSION_COOKIE = "session";
// 45 days: comfortably outlives the tournament (final 19.07) + buffer, so
// nobody has to log in again mid-championship. Active sessions are re-issued
// when <7d remain, so in practice they never expire while the app is used.
const TOKEN_TTL_SECONDS = 45 * 24 * 60 * 60;
const REFRESH_WHEN_WITHIN_SECONDS = 7 * 24 * 60 * 60; // re-issue if <7d left

export interface JwtPayload {
  sub: string; // users.id
  tg: number; // users.telegram_id
  pid?: string; // participants.id (advisory; DB is authoritative)
  adm?: true; // is_admin (advisory)
}

function key(): Uint8Array {
  return new TextEncoder().encode(env.jwtSecret);
}

export async function signSession(payload: JwtPayload): Promise<string> {
  return new SignJWT({ tg: payload.tg, pid: payload.pid, adm: payload.adm })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(
  token: string,
): Promise<{ payload: JwtPayload; needsRefresh: boolean } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const exp = (payload.exp ?? 0) as number;
    const needsRefresh = exp - Date.now() / 1000 < REFRESH_WHEN_WITHIN_SECONDS;
    return {
      payload: {
        sub: String(payload.sub),
        tg: Number(payload.tg),
        pid: payload.pid as string | undefined,
        adm: payload.adm as true | undefined,
      },
      needsRefresh,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction, // http://localhost in dev would drop a Secure cookie
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
