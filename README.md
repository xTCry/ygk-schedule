# ЯГК Schedule parser

Парсер учебного расписания _Ярославского градостроительного колледжа_ с дальнейшей публикацией нормализованных JSON и iCalendar данных.

На текущем этапе это CLI-утилита, а не HTTP-сервер. Она запускается по требованию, получает XLSX-файл расписания и записывает канонический JSON.

## Ветки репозитория

- [`main`](https://github.com/xTCry/ygk-schedule/tree/main) — исходный код,
  тесты, workflow и документация разработки.
- [`data`](https://github.com/xTCry/ygk-schedule/tree/data) — автоматически
  опубликованные JSON/YAML, diagnostics и будущие ICS. Файлы этой ветки не
  редактируются вручную.

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
make update-replacements
make update-replacements-fixtures
make generate-ical
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
data/base/00-schedule.json
data/base/00-schedule.yaml
data/base/10-groups/<группа>.json
data/base/10-groups/<группа>.yaml
data/base/90-diagnostics.json
data/base/90-diagnostics.yaml
```

Групповые файлы содержат только данные своей группы, её diagnostics и
`semanticHash`; общие версии, источники и время генерации остаются в
`00-schedule.*` и `90-diagnostics.*`. Поэтому обновление metadata не создаёт
diff всех групп. Файлы сортируются по коду группы; имена исходных XLSX не
используются как публичная структура, так как могут меняться.

`90-diagnostics.json` и `90-diagnostics.yaml` содержат сводку diagnostics,
источник с hash и временем загрузки. Черновики GitHub Issue находятся в
отдельном массиве `issues`:
повторения одной проблемы объединяются по fingerprint и перечисляют все
затронутые ячейки в Markdown-таблице.

## Замены и actual-расписание

После базовой выгрузки можно разобрать локальные HTML-фикстуры замен и
сформировать JSON/YAML без сетевых запросов:

```bash
make update-fixture
make update-replacements-fixtures
```

Актуальные страницы замен загружаются отдельной командой:

```bash
make update-replacements
```

Она требует доступ к интернету и создает:

```text
data/replacements/00-replacements.json
data/replacements/00-replacements.yaml
data/replacements/10-groups/<группа>.json
data/replacements/10-groups/<группа>.yaml
data/replacements/90-diagnostics.json
data/replacements/90-diagnostics.yaml

data/actual/00-schedule.json
data/actual/00-schedule.yaml
data/actual/10-groups/<группа>.json
data/actual/10-groups/<группа>.yaml
data/actual/90-diagnostics.json
data/actual/90-diagnostics.yaml
```

`data/base/` остаётся базовым расписанием и не изменяется выгрузкой замен. В
`actual` применяются только однозначные замены. Для неясной строки сохраняются
`unresolvedReplacements`: в них есть номер пары, исходные столбцы и отдельное
событие `event` с текстом замены. Поэтому клиент может показать базовую пару и
дополнительное уведомление, не выдавая неподтвержденную догадку за расписание.

История страниц замен ведется независимо для каждой пары `дата + смена`.
Когда, например, первая смена переходит с 4 сентября на 5 сентября, ее снимок
за 4 сентября фиксируется (`finalized`), а вторая смена за 4 сентября может
оставаться изменяемой (`mutable`). Повторное обновление страницы на ту же дату
заменяет только ее mutable-снимок. Для финализированных групп `actual` хранит
компактный снимок базовых пар, поэтому позднее обновление XLSX не перепишет
расписание уже прошедшего дня.

Ручные aliases для resolver-а находятся в
[`config/ygk/replacements.json`](config/ygk/replacements.json). Они помогают
сопоставить сокращения групп, предметов, преподавателей и кабинетов, но
применение всё равно допускается только при единственном кандидате.

Групповые файлы `replacements/10-groups/` и `actual/10-groups/` также не
дублируют общие версии, источники и время генерации. При изменении одной
группы Git обновляет только относящиеся к ней артефакты и общие файлы.

## iCalendar

Календари создаются из уже опубликованных JSON-артефактов, без повторного
чтения XLSX:

```bash
make generate-ical OUTPUT_DIR=./data \
  CALENDAR_GROUP=СТ1-11 \
  CALENDAR_PROFILE=a-m
```

Явные соответствия `группа → профиль звонков` для автоматической публикации
находятся в [`config/ygk/calendar.yaml`](config/ygk/calendar.yaml). Полная
таблица звонков и регламент хранятся рядом в `bells.yaml` и `regulations.yaml`.
Пока корпус или профиль группы не подтвержден, генератор не угадывает его и
не публикует для этой группы ICS. Параметры `CALENDAR_GROUP` и
`CALENDAR_PROFILE` предназначены только для локальной проверки одного
календаря.

Пока GitHub Pages не настроен, в файле ICS указывается прямой URL ветки `data`
на `raw.githubusercontent.com`. Его можно использовать и для подписки:

```text
https://raw.githubusercontent.com/xTCry/ygk-schedule/data/ical/base/СТ1-11.ics
https://raw.githubusercontent.com/xTCry/ygk-schedule/data/ical/actual/СТ1-11.ics
```

```text
https://xtcry.github.io/ygk-schedule/ical/base/СТ1-11.ics
https://xtcry.github.io/ygk-schedule/ical/actual/СТ1-11.ics
```

`base` содержит регулярное расписание. Для подписки лучше выбирать `actual`:
он сохраняет базовые события, применяет подтвержденные отмены и замены только
на их даты, а неясные строки замен показывает отдельным событием
«Необработанная замена».

В Google Calendar в браузере: «Другие календари» → `+` → «По URL» → вставить
URL `actual` нужной группы → «Добавить календарь». Google Calendar обновляет
подписки по собственному расписанию и кеширует их; принудительно задать
частоту обновления со стороны этого репозитория нельзя.

После настройки GitHub Pages изменится только шаблон
`publication.source_url_template` в `calendar.yaml`; пути `ical/base/` и
`ical/actual/` останутся прежними.

## Миграция generated-файлов

Если изменился только формат JSON/YAML, выгрузку можно пересобрать из уже
сохранённого `base/00-schedule.json`, без скачивания XLSX:

```bash
make regenerate-artifacts OUTPUT_DIR=../ygk-schedule-data
```

## Автоматизация

Workflow `update schedule` запускается вручную и по cron раз в два часа. После
выгрузки он создаёт, обновляет и закрывает только диагностические GitHub Issue
со скрытым маркером parser. Новые Issue получают label
`schedule-diagnostic`; при необходимости workflow создаёт его сам. Обычные
Issue репозитория workflow не изменяет.

Workflow `update replacements` запускается вручную и в 13:00, 17:00 и 20:00
по Москве. Он публикует только директории `replacements/`, `actual/` и
производные `ical/` ветки `data`, не перезаписывая базовое расписание.

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
