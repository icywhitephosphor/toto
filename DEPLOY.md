# Деплой TOTO WC-2026 на VPS

Цель: `https://toto.icywhitephosphor.tech` на VPS `72.56.232.82`, стек
`caddy + app + worker + db` через Docker Compose, HTTPS от Let's Encrypt.

## 0. Что нужно подготовить (вручную, один раз)

| Шаг | Действие |
|-----|----------|
| **DNS** | `A  toto.icywhitephosphor.tech → 72.56.232.82` (и `AAAA`, если есть IPv6). Проверить: `dig +short toto.icywhitephosphor.tech`. Caddy не получит сертификат, пока DNS не указывает на сервер. |
| **BotFather** | `/newbot` → получить `BOT_TOKEN` и `BOT_USERNAME`. Затем `/setdomain → toto.icywhitephosphor.tech` (для Login Widget) и Menu Button / `/newapp` URL = `https://toto.icywhitephosphor.tech` (для Mini App). |
| **Firewall** | `ufw allow 22,80,443/tcp`; Postgres наружу НЕ открывать (он только во внутренней docker-сети). |
| **Docker** | Установить Docker + Compose v2+. Желательно отдельный пользователь `toto` в группе `docker`. |
| **(опц.) Google Sheets** | Сервис-аккаунт + JSON-ключ (`GOOGLE_SA_JSON`), создать приватную таблицу, расшарить на email сервис-аккаунта, `SHEET_ID` = id из URL. Phase 1 — одна приватная таблица. |
| **football-data.org** | `FD_TOKEN` — боевой источник результатов/live-счёта/standings. Тариф **«Free w/ Livescores» (€12/мес)**: счёт публикуется мгновенно + live по ходу матча; на бесплатном тарифе финальный счёт появляется с непредсказуемой задержкой (минуты–часы), live отсутствует. Токен один и тот же, апгрейд применяется к аккаунту. |

## 1. Код на сервере

```bash
sudo mkdir -p /opt/toto && sudo chown "$USER" /opt/toto
git clone <repo-url> /opt/toto
cd /opt/toto
```

## 2. Секреты — `/opt/toto/.env` (root-only, НЕ в git)

```bash
umask 077
cat > /opt/toto/.env <<'EOF'
# Postgres (контейнер db)
POSTGRES_USER=toto
POSTGRES_PASSWORD=<надёжный-пароль>
POSTGRES_DB=toto
# DATABASE_URL внутри compose переопределяется на host=db; здесь — резерв.
DATABASE_URL=postgres://toto:<надёжный-пароль>@db:5432/toto

# Auth
JWT_SECRET=<openssl rand -hex 32>
BOT_TOKEN=<из BotFather>
BOT_USERNAME=<имя_бота>
NEXT_PUBLIC_BOT_USERNAME=<имя_бота>
ADMIN_TELEGRAM_ID=<ваш numeric telegram id>   # этот аккаунт станет админом при входе

# В проде dev-вход ДОЛЖЕН быть выключен
ALLOW_DEV_LOGIN=false

# Опционально (Phase 1 можно пусто)
FD_TOKEN=
GOOGLE_SA_JSON=
SHEET_ID=
EOF
chmod 600 /opt/toto/.env
```

> `NEXT_PUBLIC_ALLOW_DEV_LOGIN` НЕ задавать в проде (по умолчанию выключено).
> Свой numeric `telegram_id` можно узнать у `@userinfobot`.

## 3. Запуск

```bash
cd /opt/toto
./scripts/deploy.sh
```

Скрипт: `git pull` → `docker compose build` → `docker compose up -d`. Compose-сервис
`migrate` применит миграции и сиды (48 команд, 104 матча, 7 бонусов, 21 участник)
до старта `app`/`worker`. Затем проверит `https://toto.icywhitephosphor.tech/api/health`.

## 4. Назначить администратора

`ADMIN_TELEGRAM_ID` из `.env` авторазмечает админа при первом входе. Альтернатива — вручную:

```bash
docker compose exec db psql -U toto -d toto \
  -c "UPDATE users SET is_admin = true WHERE telegram_id = <ваш_tg_id>;"
```

## 5. Проверка после деплоя

```bash
curl -fsS https://toto.icywhitephosphor.tech/api/health   # {"status":"ok","db":"up",...}
docker compose ps                                          # все Up, db healthy, migrate Exited(0)
docker compose logs --tail=50 caddy                        # сертификат получен
```

Открыть Mini App в Telegram → claim имени → ставка на групповой матч. Админка: «Результаты»
(внести счёт → авто-пересчёт), «Сервис» (пересчёт, экспорт), «Бонусы» (подведение итогов).

## 6. Бэкапы (architecture/12 §6)

```bash
# /opt/toto/scripts/backup.sh по root-крону: 0 3 * * *
docker compose exec -T db pg_dump -U toto toto | gzip > backups/toto_$(date +%F).sql.gz
```

## 7. Обновление

```bash
cd /opt/toto && ./scripts/deploy.sh    # пересборка + up; миграции идемпотентны, сиды — upsert
```

## Откат / починка — см. `architecture/12 §8` (рунбук).

---

### Что НЕ автоматизируется этим репозиторием

- DNS-запись и BotFather — внешние сервисы.
- Реальные секреты (`BOT_TOKEN`, `GOOGLE_SA_JSON`) — вводятся в `/opt/toto/.env` на сервере.
- SSH-доступ к VPS.

Всё остальное (схема, сиды, сборка, миграции, HTTPS, healthcheck) выполняется автоматически
через `docker compose up` / `scripts/deploy.sh`.
