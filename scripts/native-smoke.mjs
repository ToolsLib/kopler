import { chromium, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

// Launch the local release app with isolated KOPLER_DATA_DIR and
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 first.
let browser;
let page;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 1000 });
    page = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
    if (page) break;
    await browser.close();
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!page) throw new Error('The isolated native app is not running.');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const native = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const report = [];

try {
  await expect(page.getByLabel('Capture text')).toBeVisible();
  const initial = await native('bootstrap');
  if (!initial.dataPath.includes('native-smoke')) throw new Error('Refusing to run outside isolated native-smoke data.');
  expect(initial.trayAvailable).toBe(true);
  expect(initial.shortcutError).toBeNull();
  report.push('Windows tray initialized and global shortcut registered');
  const text = `Native check ${Date.now()}\n<script>literal text</script>\n**Prompt for later**`;
  await page.getByLabel('Capture text').fill(text);
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.locator('.item-body').first()).toHaveText(text);
  await page.getByRole('button', { name: 'Copy item', exact: true }).first().click();
  expect(await native('read_clipboard')).toEqual({type:'text',text});
  report.push('Native SQLite capture and exact system-clipboard copy passed');

  await page.getByRole('button', { name: 'Complete task', exact: true }).first().click();
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.item-body').first()).toHaveText(text);
  await page.getByRole('button', { name: 'Reopen task', exact: true }).first().click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(page.locator('.item-body').first()).toHaveText(text);
  await page.getByRole('button', { name: 'Edit item', exact: true }).first().click();
  await page.getByLabel('Edit item text').fill(`${text}\nEdited natively`);
  await page.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(page.locator('.item-body').first()).toHaveText(`${text}\nEdited natively`);
  report.push('Native task completion, reopening, and edit autosave passed');

  const draft = `Unfinished native draft ${Date.now()}`;
  await page.getByLabel('Capture text').fill(draft);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await native('bootstrap')).data.draft.body).toBe(draft);
  await promisify(execFile)(resolve('src-tauri/target/release/kopler.exe'), ['--show'], { windowsHide: true });
  await expect(page.getByLabel('Capture text')).toHaveValue(draft);
  report.push('Native hide flush and single-instance reveal passed');

  await page.emulateMedia({ colorScheme: 'light' });
  mkdirSync('.cache', { recursive: true });
  await page.screenshot({ path: '.cache/native-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '.cache/native-dark.png' });
  report.push('Native light and dark screenshots captured');
  expect(errors).toEqual([]);
  writeFileSync('.cache/native-smoke-result.json', JSON.stringify({ passed: report, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: report, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
