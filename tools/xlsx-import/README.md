# Импорт ставок из «другого сайта» (xlsx)

Одноразовый, но повторяемый пайплайн для заливки ставок из выгрузки
тотализатора-исходника в прод-БД. Политика — **строго аддитивно**: существующие
ставки никогда не перезаписываются и не удаляются (`ON CONFLICT DO NOTHING`).

## Шаги

```bash
cd tools/xlsx-import
npm i xlsx postgres esbuild        # локальные dev-зависимости, в repo не коммитятся

# 1. xlsx → bets.json (без нормализации, честное извлечение)
node parse.js "/path/to/тотоЧМ2026.xlsx"

# 2. канонизация коротких названий («Юж. Корея» → «Южная Корея», Артем → Артём)
node canon.js

# 3. бандл импортёра (postgres-драйвер внутрь)
npx esbuild import.ts --bundle --platform=node --format=cjs --outfile=import.cjs

# 4. на прод: dry-run обязателен, валидация падает с ошибкой на любом несовпадении
scp bets.json import.cjs root@<vps>:/tmp/
ssh root@<vps> 'cd /opt/toto \
  && docker compose cp /tmp/bets.json app:/tmp/bets.json \
  && docker compose cp /tmp/import.cjs app:/tmp/import.cjs \
  && docker compose exec -T -e IMPORT_FILE=/tmp/bets.json app node /tmp/import.cjs --dry-run'

# 5. если счётчики ожидаемые — боевой прогон (без --dry-run) и пересчёт очков
#    POST /api/admin/recalculate (или кнопка «Пересчитать» в админке)
```

`bets.json` и xlsx в репозиторий не коммитим (персональные данные участников).
