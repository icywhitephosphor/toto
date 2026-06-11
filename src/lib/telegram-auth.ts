// Telegram identity verification — BOTH HMAC schemes, exactly as Telegram
// specifies (architecture/07 §3). They are NOT interchangeable:
//   Mini App initData : secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
//   Login Widget      : secret = SHA256(BOT_TOKEN)  (raw 32 bytes, a plain hash)
// Both then compute HMAC_SHA256(secret, data_check_string) and compare to the
// received `hash` with timingSafeEqual.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./http";
import { env } from "./env";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedIdentity {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
}

function constantTimeHexEqual(expectedHex: string, receivedHex: string): boolean {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(receivedHex.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Allow a little clock skew between Telegram and us, but reject anything more
// than this in the FUTURE — a far-future auth_date would otherwise pass the
// "too old" check forever and widen the replay window arbitrarily.
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;

function assertFresh(authDate: number): void {
  if (!authDate || Number.isNaN(authDate)) {
    throw new AppError(401, "INVALID_TELEGRAM_HASH", "Missing auth_date");
  }
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > env.authReplayWindowSeconds) {
    throw new AppError(401, "INIT_DATA_EXPIRED", "Telegram auth_date too old (replay rejected)", {
      max_age_seconds: env.authReplayWindowSeconds,
    });
  }
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) {
    throw new AppError(401, "INIT_DATA_EXPIRED", "Telegram auth_date is in the future (rejected)");
  }
}

// ---------------------------------------------------------------------------
// Mini App initData (07 §3.2)
// ---------------------------------------------------------------------------
export function verifyMiniAppInitData(rawInitData: string): VerifiedIdentity {
  const params = new URLSearchParams(rawInitData);

  const receivedHash = params.get("hash");
  if (!receivedHash) throw new AppError(401, "INVALID_TELEGRAM_HASH", "initData missing hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(env.botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!constantTimeHexEqual(expectedHash, receivedHash)) {
    throw new AppError(401, "INVALID_TELEGRAM_HASH", "initData signature invalid");
  }

  const authDate = Number(params.get("auth_date"));
  assertFresh(authDate);

  const userJson = params.get("user");
  if (!userJson) throw new AppError(401, "INVALID_TELEGRAM_HASH", "initData missing user");
  const user: TelegramUser = JSON.parse(userJson);

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    photo_url: user.photo_url,
    auth_date: authDate,
  };
}

// ---------------------------------------------------------------------------
// Login Widget (07 §3.2) — different secret derivation (plain SHA-256).
// ---------------------------------------------------------------------------
export interface LoginWidgetPayload {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

export function verifyLoginWidget(payload: LoginWidgetPayload): VerifiedIdentity {
  const { hash: receivedHash, ...rest } = payload;
  if (!receivedHash) throw new AppError(401, "INVALID_TELEGRAM_HASH", "Missing hash");

  const dataCheckString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(env.botToken).digest(); // raw 32 bytes
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!constantTimeHexEqual(expectedHash, receivedHash)) {
    throw new AppError(401, "INVALID_TELEGRAM_HASH", "Login Widget signature invalid");
  }

  const authDate = Number(rest.auth_date);
  assertFresh(authDate);

  return {
    id: Number(rest.id),
    first_name: rest.first_name,
    last_name: rest.last_name,
    username: rest.username,
    photo_url: rest.photo_url,
    auth_date: authDate,
  };
}
