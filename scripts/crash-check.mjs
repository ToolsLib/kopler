import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const executable = resolve(process.env.KOPLER_TEST_EXE ?? 'src-tauri/target/release/kopler.exe');
const directory = resolve(`.cache/crash-smoke-${randomUUID()}`);
const body = 'Committed native crash fixture\n  Exact original text.  ';
const draft = 'An unfinished draft, saved before termination';
let app;
let browser;
let page;
async function start() {
  app = spawn(executable, [], { windowsHide: true, env: { ...process.env, KOPLER_DATA_DIR: directory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' } });
  for (let i = 0; i < 200; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 500 });
      page = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
      if (page) {
        await expect(page.getByLabel('Capture text')).toBeVisible();
        const state = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bootstrap'));
        if (state.dataPath !== directory) throw new Error('Another application instance is running.');
        return;
      }
    } catch (error) { if (error.message.includes('Another application')) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Isolated crash test did not start.');
}
try {
  await start();
  await page.getByLabel('Capture text').fill(body);
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body')).toHaveText(body);
  await page.getByLabel('Capture text').fill(draft);
  await expect.poll(() => page.evaluate(async () => (await window.__TAURI_INTERNALS__.invoke('bootstrap')).data.draft.body)).toBe(draft);
  const exited = new Promise(resolve => app.once('exit', resolve));
  app.kill('SIGKILL'); await exited; await browser.close().catch(() => {});
  const database = new DatabaseSync(resolve(directory, 'kopler.sqlite3'), { readOnly: true });
  expect(database.prepare('SELECT body FROM items').get().body).toBe(body);
  expect(JSON.parse(database.prepare("SELECT value FROM settings WHERE key='draft'").get().value).body).toBe(draft);
  database.close();
  await start();
  await expect(page.getByLabel('Capture text')).toHaveValue(draft);
  await expect(page.locator('.item-body')).toHaveText(body);
  const cleanExit = new Promise(resolve => app.once('exit', resolve));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('finish_window_action', { action: 'quit' })).catch(() => {});
  await cleanExit;
  const result = { committedItemSurvivesProcessTermination: true, persistedDraftSurvivesProcessTermination: true, cleanRestartVerified: true };
  writeFileSync('.cache/crash-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (app?.exitCode === null) app.kill('SIGKILL');
}
