import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // ExcelJS разбирает большой regression fixture. Последовательный запуск
    // исключает конкуренцию за CPU и случайные таймауты на CI.
    fileParallelism: false,
  },
});
