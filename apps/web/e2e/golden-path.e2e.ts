import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { FAKE_SUMMARY } from './fake-gemini.ts';

const RESUME = fileURLToPath(new URL('./fixtures/resume.pdf', import.meta.url));

/**
 * The main flow a candidate takes: sign in, upload a resume, set up a typed interview,
 * answer two questions, end it, and read the written feedback.
 */
test('a candidate can practise a typed interview and get feedback', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, 'E2E_EMAIL and E2E_PASSWORD are not set');

  await test.step('sign in', async () => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  await test.step('upload a resume', async () => {
    await page.getByLabel('Upload PDF resume').setInputFiles(RESUME);
    await page.getByRole('button', { name: /analyze resume/i }).click();
    await expect(page.getByText(/analyzed with ai/i)).toBeVisible({ timeout: 30_000 });
  });

  await test.step('set up a typed interview', async () => {
    await page.goto('/new-interview');
    await page.getByRole('radio', { name: /software engineer/i }).click();
    await page.getByRole('radio', { name: /^typed/i }).click();
    await page.getByRole('button', { name: /start interview/i }).click();
    await expect(page).toHaveURL(/\/interview\/[^/]+$/);
  });

  const answerBox = page.getByLabel('Type your interview answer');
  for (const [i, answer] of [
    'I built a job queue in Postgres so feedback survives a restart.',
    'I picked SKIP LOCKED over a separate broker to keep the system small.',
  ].entries()) {
    await test.step(`answer question ${i + 1}`, async () => {
      await expect(page.getByText(`Question ${i + 1}:`).first()).toBeVisible({ timeout: 30_000 });
      await expect(answerBox).toBeEnabled();
      await answerBox.fill(answer);
      await page.getByRole('button', { name: /submit answer/i }).click();
    });
  }

  await test.step('end the interview', async () => {
    await expect(page.getByText('Question 3:').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^end interview$/i }).click();
    await page.getByRole('button', { name: /yes, end interview/i }).click();
    await expect(page).toHaveURL(/\/interview\/[^/]+\/feedback$/);
  });

  await test.step('read the feedback', async () => {
    await expect(page.getByText(FAKE_SUMMARY)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Overall Summary')).toBeVisible();
  });
});
