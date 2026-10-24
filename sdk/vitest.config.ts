import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
  },
});
