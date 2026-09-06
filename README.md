# Данные расписания ЯГК

Ветка содержит автоматически сформированные данные расписания _Ярославского градостроительного колледжа_.
Исходный код, тесты и GitHub Actions находятся в
[`main`](https://github.com/xTCry/ygk-schedule/tree/main).

[![Расписание](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FxTCry%2Fygk-schedule%2Fdata%2Fmeta%2F10-badges%2Fschedule.json)](https://github.com/xTCry/ygk-schedule/blob/data/meta/00-status.json)
[![Замены](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FxTCry%2Fygk-schedule%2Fdata%2Fmeta%2F10-badges%2Freplacements.json)](https://github.com/xTCry/ygk-schedule/blob/data/meta/00-status.json)
[![XLSX parser](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FxTCry%2Fygk-schedule%2Fdata%2Fmeta%2F10-badges%2Fxlsx-parser.json)](https://github.com/xTCry/ygk-schedule/blob/data/meta/00-status.json)
[![HTML parser](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FxTCry%2Fygk-schedule%2Fdata%2Fmeta%2F10-badges%2Freplacements-parser.json)](https://github.com/xTCry/ygk-schedule/blob/data/meta/00-status.json)
[![Обновление расписания](https://github.com/xTCry/ygk-schedule/actions/workflows/update-schedule.yml/badge.svg?branch=main)](https://github.com/xTCry/ygk-schedule/actions/workflows/update-schedule.yml)
[![Обновление замен](https://github.com/xTCry/ygk-schedule/actions/workflows/update-replacements.yml/badge.svg?branch=main)](https://github.com/xTCry/ygk-schedule/actions/workflows/update-replacements.yml)

Метки показывают время последних публикаций по Москве и короткие версии
`parserHash`, которыми сформированы текущие данные. Полные hashes, источники,
количество групп и diagnostics находятся в
[`meta/00-status.json`](meta/00-status.json) и
[`meta/00-status.yaml`](meta/00-status.yaml).

## Ветки репозитория

- [`main`](https://github.com/xTCry/ygk-schedule/tree/main) — исходный код,
  тесты, workflow и документация разработки.
- [`data`](https://github.com/xTCry/ygk-schedule/tree/data) — эта ветка с
  автоматически опубликованными JSON/YAML, diagnostics и будущими ICS.

> Не редактируйте файлы этой ветки вручную - они обновляются через workflow

## Файлы

- `base/00-schedule.json` — полное базовое расписание в JSON.
- `base/00-schedule.yaml` — полное базовое расписание в YAML.
- `base/10-groups/` — отдельные JSON- и YAML-файлы групп.
- `base/90-diagnostics.json` и `base/90-diagnostics.yaml` — diagnostics,
  происхождение выгрузки и черновики GitHub Issue.
- `replacements/` — исходные замены из HTML-таблиц в JSON/YAML и по группам.
- `actual/` — расписание с однозначно применёнными заменами в JSON/YAML и по
  группам. Базовое расписание не изменяется.
- `meta/00-status.*` — краткая metadata для README: версии parser-а, время
  последней выгрузки, количество групп, источников и diagnostics.
- `meta/10-badges/` — endpoint JSON для динамических badges.

Общие `generatedAt`, версии и сведения об источниках находятся в полных
файлах `00-*.json`/`00-*.yaml` и diagnostics. Файлы в `10-groups/` содержат
только данные соответствующей группы и её diagnostics, поэтому обновление
metadata не меняет сразу все группы.
