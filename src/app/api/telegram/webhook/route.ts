// POST /api/telegram/webhook — Telegram bot update handler. On any message
// (e.g. /start) the bot replies with a welcome + an inline web_app button that
// launches the Mini App. Always returns 200 so Telegram doesn't retry.
// Verified via the X-Telegram-Bot-Api-Secret-Token header when the secret is set.
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

const APP_URL = "https://toto.icywhitephosphor.tech";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ok = () => NextResponse.json({ ok: true });
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return ok(); // ignore unverified callers silently
    }

    const update = (await req.json().catch(() => null)) as
      | { message?: { chat?: { id?: number }; text?: string } }
      | null;
    const chatId = update?.message?.chat?.id;
    if (!chatId) return ok();

    const text =
      "⚽️ <b>ТОТО ЧМ-2026</b>\n\nДружеский тотализатор на Чемпионат мира. Жми «Открыть», " +
      "выбери своё имя и делай прогнозы. Удачи!";

    await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⚽️ Открыть ТОТО", web_app: { url: APP_URL } }]] },
      }),
    }).catch(() => {});

    return ok();
  } catch {
    return ok();
  }
}
