# ЯГК Schedule parser

Парсер учебного расписания _Ярославского градостроительного колледжа_ с дальнейшей публикацией нормализованных JSON и iCalendar данных.

На текущем этапе это CLI-утилита, а не HTTP-сервер. Она запускается по требованию, получает XLSX-файл расписания и записывает канонический JSON.

## Требования

- Node.js 24+

## Команды

```bash
npm install
npm run check
npm run build
```

## Локальный запуск

Разобрать локальный XLSX и сохранить результат вне репозитория:

```bash
npm run update -- \
  --input src/providers/ygk/schedule/fixtures/2026-09-so.xlsx \
  --output ./.tmp/ygk-schedule.json
```

Для загрузки XLSX по известному URL вместо `--input` используется `--url`. Этот режим выполняет сетевой запрос:

```bash
npm run update -- \
  --url https://example.org/schedule.xlsx \
  --output ./.tmp/ygk-schedule.json
```

Команда выводит сведения о записи файла, смене версии и смысловых изменениях расписания. При `fatal`-диагностике новый JSON не записывается.

<!-- ## Документация

Основные правила проекта перечислены в [`docs/README.md`](./docs/README.md). -->
