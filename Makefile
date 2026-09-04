SCHEDULE_PAGE_URL ?= https://ygk.edu.yar.ru/raspisanie.html
REPLACEMENT_FIRST_URL ?= https://menu.sttec.yar.ru/timetable/rasp_first.html
REPLACEMENT_SECOND_URL ?= https://menu.sttec.yar.ru/timetable/rasp_second.html
OUTPUT_DIR ?= data
FIXTURE_PATH ?= src/providers/ygk/schedule/fixtures/2026-09-so.xlsx
DIAGNOSTICS_PATH ?= $(OUTPUT_DIR)/base/90-diagnostics.json
ACTUAL_DIAGNOSTICS_PATH ?= $(OUTPUT_DIR)/actual/90-diagnostics.json
BASE_SCHEDULE_PATH ?= $(OUTPUT_DIR)/base/00-schedule.json
BASE_DATA_REVISION ?=
REPLACEMENT_FIRST_FIXTURE_PATH ?= src/providers/ygk/replacements/fixtures/2026-09-04-first.html
REPLACEMENT_SECOND_FIXTURE_PATH ?= src/providers/ygk/replacements/fixtures/2026-09-04-second.html

.PHONY: help install check build typecheck lint test format format-check update update-verbose update-fixture regenerate-artifacts update-replacements update-replacements-fixtures sync-issues

help:
	@printf '%s\n' \
		'Доступные команды:' \
		'  make install          Установить зависимости из package-lock.json' \
		'  make check            TypeScript, ESLint, тесты и форматирование' \
		'  make build            Собрать TypeScript в dist/' \
		'  make test             Запустить тесты' \
		'  make format           Отформатировать проект' \
		'  make update           Скачать и выгрузить актуальное расписание' \
		'  make update-verbose   То же, с подробным diff занятий' \
		'  make update-fixture   Выгрузить regression fixture локально' \
		'  make regenerate-artifacts Пересобрать data из полного JSON без сети' \
		'  make update-replacements Скачать и применить актуальные замены' \
		'  make update-replacements-fixtures Обработать локальные HTML-фикстуры замен' \
		'  make sync-issues      Синхронизировать диагностические GitHub Issue'

install:
	npm ci

check:
	npm run check

build:
	npm run build

typecheck:
	npm run typecheck

lint:
	npm run lint

test:
	npm run test

format:
	npm run format

format-check:
	npm run format:check

update:
	npm run update -- --page-url "$(SCHEDULE_PAGE_URL)" --output-dir "$(OUTPUT_DIR)"

update-verbose:
	npm run update -- --page-url "$(SCHEDULE_PAGE_URL)" --output-dir "$(OUTPUT_DIR)" --verbose-diff

update-fixture:
	npm run update -- --input "$(FIXTURE_PATH)" --output-dir "$(OUTPUT_DIR)"

regenerate-artifacts:
	npm run regenerate-artifacts -- --input "$(BASE_SCHEDULE_PATH)" --output-dir "$(OUTPUT_DIR)"

update-replacements:
	npm run update-replacements -- --base-schedule "$(BASE_SCHEDULE_PATH)" --output-dir "$(OUTPUT_DIR)" --first-url "$(REPLACEMENT_FIRST_URL)" --second-url "$(REPLACEMENT_SECOND_URL)" $(if $(BASE_DATA_REVISION),--base-data-revision "$(BASE_DATA_REVISION)")

update-replacements-fixtures:
	npm run update-replacements -- --base-schedule "$(BASE_SCHEDULE_PATH)" --output-dir "$(OUTPUT_DIR)" --first-input "$(REPLACEMENT_FIRST_FIXTURE_PATH)" --second-input "$(REPLACEMENT_SECOND_FIXTURE_PATH)" $(if $(BASE_DATA_REVISION),--base-data-revision "$(BASE_DATA_REVISION)")

sync-issues:
	test -n "$(GITHUB_REPOSITORY)"
	set -- --diagnostics "$(DIAGNOSTICS_PATH)"; \
	if test -f "$(ACTUAL_DIAGNOSTICS_PATH)"; then set -- "$$@" --diagnostics "$(ACTUAL_DIAGNOSTICS_PATH)"; fi; \
	npm run sync-issues -- "$$@" --repo "$(GITHUB_REPOSITORY)"
