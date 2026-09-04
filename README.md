# Данные расписания ЯГК

Ветка содержит автоматически сформированные данные расписания _Ярославского градостроительного колледжа_.
Исходный код, тесты и GitHub Actions находятся в
[`main`](https://github.com/xTCry/ygk-schedule/tree/main).

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

Общие `generatedAt`, версии и сведения об источниках находятся в полных
файлах `00-*.json`/`00-*.yaml` и diagnostics. Файлы в `10-groups/` содержат
только данные соответствующей группы и её diagnostics, поэтому обновление
metadata не меняет сразу все группы.
