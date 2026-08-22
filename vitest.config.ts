import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The acceptance suite talks to the real Supabase database and shares one throwaway
    // partnership across its steps, so the steps must run in order and in one process.
    include: ['backend/src/**/*.test.ts', 'src/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
