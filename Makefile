SCHEDULE_PAGE_URL ?= https://ygk.edu.yar.ru/raspisanie.html
OUTPUT_DIR ?= data
FIXTURE_PATH ?= src/providers/ygk/schedule/fixtures/2026-09-so.xlsx

.PHONY: help install check build typecheck lint test format format-check update update-verbose update-fixture

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
		'  make update-fixture   Выгрузить regression fixture локально'

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
