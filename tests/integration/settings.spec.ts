// Playwright: the settings panel (src/ui/settings.ts) on the single-file build. What a player picks is
// kept for the next visit.
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const build = (query: string): string => `${pathToFileURL(resolve('dist-single/index.html')).href}?${query}`;

test('keeps the volume and the effects switch for the next visit', async ({ page }) => {
  // Arrange: the title screen, nothing kept yet
  await page.goto(build('manual=1&seed=7'));
  await page.evaluate(() => localStorage.removeItem('tpdv-prefs'));
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  expect(await page.evaluate(() => document.documentElement.classList.contains('chibi'))).toBe(true); // chibi by default
  const b = (await page.locator('#game').boundingBox())!;
  await page.evaluate(() => window.game!.step(3));
  await page.mouse.click(b.x + 958 * b.width / 1280, b.y + 44 * b.height / 720); // the title's "Cài đặt"
  await page.evaluate(() => window.game!.step(2));

  // Act: volume 30%, effects off, then a new visit
  await page.locator('#st-vol').fill('30');
  await page.locator('#st-vol').dispatchEvent('input');
  await page.locator('#st-fx button[data-k="1"]').click();
  await page.reload();

  // Assert: kept, and the panel opens with them
  await expect.poll(() => page.evaluate(() => typeof window.game?.step)).toBe('function');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('tpdv-prefs') || '{}'))).toEqual({ volume: 0.3, effects: false });
  await page.evaluate(() => window.game!.step(3));
  await page.mouse.click(b.x + 958 * b.width / 1280, b.y + 44 * b.height / 720);
  await page.evaluate(() => window.game!.step(2));
  await expect(page.locator('#st-vol-v')).toHaveText('30%');
  await expect(page.locator('#st-fx button.on')).toHaveText('Tắt');
  expect(await page.locator('#st-theme').count()).toBe(0); // no choice of look
});
