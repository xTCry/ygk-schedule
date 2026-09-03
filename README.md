# ЯГК Schedule parser

Парсер учебного расписания _Ярославского градостроительного колледжа_ с дальнейшей публикацией нормализованных JSON и iCalendar данных.

На текущем этапе это CLI-утилита, а не HTTP-сервер. Она запускается по требованию, получает XLSX-файл расписания и записывает канонический JSON.

## Требования

- Node.js 24+

## Команды

### NPM

```bash
npm install
npm run check
npm run build
```

### Bash makefile

```bash
make help
make install
make check
make build
```

Значения по умолчанию уже определены в `Makefile`: URL страницы расписания,
локальная папка выгрузки `data/` и regression fixture. Их можно заменить для
одного запуска:

```bash
make update OUTPUT_DIR=../ygk-schedule-data
make update SCHEDULE_PAGE_URL=https://example.org/raspisanie.html
```

Основные команды:

```bash
make update
make update-verbose
make update-fixture
```

## Локальный запуск

Разобрать локальный XLSX и сохранить общий JSON:

```bash
npm run update -- \
  --input src/providers/ygk/schedule/fixtures/2026-09-so.xlsx \
  --output ./.tmp/ygk-schedule.json
```

Для локальной выгрузки сразу JSON и YAML используйте папку `data/`. В ветке
`main` она игнорируется Git: это безопасная рабочая копия будущих публикаций.

```bash
npm run update -- \
  --input src/providers/ygk/schedule/fixtures/2026-09-so.xlsx \
  --output-dir ./data
```

Команда создаёт:

```text
data/json/00-schedule.json
data/yaml/00-schedule.yaml
data/json/10-groups/<группа>.json
data/yaml/10-groups/<группа>.yaml
data/meta/90-diagnostics.json
data/meta/90-diagnostics.yaml
```

Групповые файлы содержат ту же каноническую модель, но только для одной группы.
Они сортируются по коду группы; имена исходных XLSX не используются как
публичная структура, так как могут меняться.

`90-diagnostics.json` и `90-diagnostics.yaml` содержат сводку diagnostics,
источник с hash и временем загрузки. Черновики GitHub Issue находятся в
отдельном массиве `issues`:
повторения одной проблемы объединяются по fingerprint и перечисляют все
затронутые ячейки в Markdown-таблице.

Для загрузки XLSX по известному URL вместо `--input` используется `--url`. Этот режим выполняет сетевой запрос:

```bash
npm run update -- \
  --url https://example.org/schedule.xlsx \
  --output ./.tmp/ygk-schedule.json
```

Для обычного обновления со страницы ЯГК используется `--page-url`: команда
находит актуальные XLSX базового расписания, скачивает каждый файл и собирает
единый JSON. Этот режим выполняет несколько сетевых запросов.

```bash
npm run update -- \
  --page-url https://ygk.edu.yar.ru/raspisanie.html \
  --output-dir ./data
```

Команда выводит сведения о записи файла, смене версии и смысловых изменениях расписания. При `fatal`-диагностике новый JSON не записывается.

По умолчанию CLI выводит краткий diff по группам. Чтобы вывести изменения
отдельных пар (`lessonChanges`), добавьте флаг `--verbose-diff`:

```bash
npm run update -- \
  --input src/providers/ygk/schedule/fixtures/2026-09-so.xlsx \
  --output-dir ./data \
  --verbose-diff
```

<!-- ## Документация

Основные правила проекта перечислены в [`docs/README.md`](./docs/README.md). -->
