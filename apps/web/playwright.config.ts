import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end golden path (P-14): a real browser against a real API and database, with
 * Gemini replaced by e2e/fake-gemini.ts. Sign-in uses the real Supabase project and a dedicated
 * test account.
 *
 * Needs: DATABASE_URL (a throwaway Postgres with the migrations applied, never the shared one),
 * SUPABASE_URL, SUPABASE_ANON_KEY, E2E_EMAIL and E2E_PASSWORD. CI sets them; locally, export them.
 */
const API_PORT = 3100;
const WEB_PORT = 5174;
const FAKE_GEMINI_PORT = 4100;

const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const;
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} must be set to run the end-to-end test`);
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bun e2e/fake-gemini.ts',
      env: { FAKE_GEMINI_PORT: String(FAKE_GEMINI_PORT) },
      port: FAKE_GEMINI_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun ../api/src/server.ts',
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: process.env.DATABASE_URL!,
        SUPABASE_URL: process.env.SUPABASE_URL!,
        // The API only verifies sign-in tokens here, which the public anon key can do.
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_ANON_KEY!,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        GEMINI_API_KEY: 'e2e-fake-key',
        GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${FAKE_GEMINI_PORT}`,
      },
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `bunx vite --port ${WEB_PORT} --strictPort`,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}/api`,
        VITE_SUPABASE_URL: process.env.SUPABASE_URL!,
        VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
      },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
