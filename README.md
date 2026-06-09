# TOTO WC-2026

Дружеский тотализатор на Чемпионат мира по футболу 2026 для ~21 участника.
Telegram-логин, личные прогнозы, автоматический подсчёт очков, живая таблица и
экспорт в Google Sheets. Источник истины — PostgreSQL.

> Архитектура и решения — в `architecture/` (канон в `00-README.md`). Это Phase 1 MVP
> по `architecture/13-mvp-plan-and-build-order.md`.

## Стек (Track A)

- **Next.js 16 (App Router) + React 19 + TypeScript** — UI и `/api/*` в одном приложении.
- **PostgreSQL 16 + Drizzle ORM**; миграции — рукописный SQL (`migrations/`), DDL = `architecture/04`.
- **Telegram Mini App `initData`** (основной) + **Login Widget** (запасной) — обе HMAC-схемы из `07`.
- **node-cron worker** — плановый экспорт в Sheets (поллинг провайдера — Phase 2).
- **Caddy** — авто-HTTPS (Let's Encrypt) на `toto.icywhitephosphor.tech`.
- **Docker Compose**: `caddy + app + worker + db` на одном VPS.

Движок подсчёта очков — чистый модуль `src/scoring/` (без I/O, единственный источник очков),
покрыт юнит-тестами на все примеры из `architecture/05 §6`.

## Структура

```
src/scoring/        чистый движок подсчёта (+ тесты)
src/domain/         seed-данные: команды, группы, сетка, бонусы, ростер, расписание, призы
src/db/             Drizzle-схема + ленивый клиент
src/lib/            http-обёртка, auth (telegram+JWT), recompute, leaderboard, sheets, ...
src/lib/client/     браузерный API-клиент, SWR, хуки, форматирование
src/components/     UI-компоненты (AppShell, MatchBetCard, BonusCategoryCard, ...)
src/app/            страницы и роуты /api/*
migrations/         канонический SQL (0001_init.sql)
scripts/            migrate.ts, seed.ts
e2e/                Playwright (изолированная БД toto_e2e)
```

## Локальная разработка

```bash
# 1. Поднять Postgres (docker)
docker run -d --name toto-pg -e POSTGRES_USER=toto -e POSTGRES_PASSWORD=toto \
  -e POSTGRES_DB=toto -p 5433:5432 postgres:16-alpine

# 2. .env
cp .env.example .env            # JWT_SECRET: openssl rand -hex 32

# 3. Установка, миграции + сиды
npm install
npm run db:setup                # migrate + seed (48 команд, 104 матча, 7 бонусов, 21 участник)

# 4. Запуск
npm run dev                     # http://localhost:3000

# Dev-вход без Telegram (ALLOW_DEV_LOGIN=true): на экране входа форма «dev».
# Админ: ADMIN_TELEGRAM_ID в .env (по умолчанию 100001) → этот tg_id получает is_admin.
```

## Тесты

```bash
npm test          # юнит: движок подсчёта (26 тестов, все примеры из 05 §6)
npm run typecheck # tsc --noEmit
npm run e2e       # Playwright: изолированная БД toto_e2e + свой сервер на :3100
```

`npm run e2e` сам создаёт/мигрирует/сидит базу `toto_e2e` и поднимает отдельный сервер,
так что dev-данные не затрагиваются. Перед первым запуском: `npx playwright install chromium`.

## Деплой на VPS

См. **[DEPLOY.md](./DEPLOY.md)** — пошаговый рунбук (DNS, BotFather, секреты, `docker compose up`).
Кратко, на сервере в `/opt/toto`:

```bash
./scripts/deploy.sh             # git pull + build + up (-> миграции и сиды автоматически) + healthcheck
```

## Главные правила честности (не нарушать)

- Дедлайны проверяются **на сервере** (HTTP 423 при блокировке); клиентский таймер косметический.
- Чужая ставка не видна до её дедлайна — reveal-эндпоинты авторизуются по серверным часам.
- Ставки неизменяемы после дедлайна; каждая запись ставки и изменение результата пишутся в `audit_log`.
- Очки считаются детерминированно и только движком; тесты — гейт.
