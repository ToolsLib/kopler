import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// Focus the isolated app's actual desktop window before running this check.
// A hidden/inactive WebView intentionally uses the low-memory target.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
try {
  if (!await page.evaluate(() => document.hasFocus())) throw new Error('Focus the native application before measuring interactive search.');
  const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bootstrap'));
  if (!initial.dataPath.includes('benchmark-data')) throw new Error('Use the isolated benchmark database.');
  if (await page.getByRole('button', {name:'Search and filters',exact:true}).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', {name:'Search and filters',exact:true}).click();
  await page.getByLabel('All projects', { exact: true }).check();
  await page.getByLabel('Search items').fill('');
  await expect(page.locator('.item')).toHaveCount(60);
  await page.evaluate(() => {
    window.activeSearchSamples = [];
    const list = document.querySelector('.item-list');
    new MutationObserver(() => {
      const search = document.querySelector('input[aria-label="Search items"]').value;
      const bodies = [...list.querySelectorAll('.item-body')];
      if (search && bodies.length && bodies.every(body => body.textContent.includes(search))) {
        requestAnimationFrame(() => requestAnimationFrame(() => window.activeSearchSamples.push({ search, end: performance.now() })));
      }
    }).observe(list, { childList: true, subtree: true, characterData: true });
  });
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const search = `reference-${i} `;
    const start = await page.evaluate(() => performance.now());
    await page.getByLabel('Search items').fill(search);
    await expect.poll(() => page.evaluate(search => window.activeSearchSamples.find(sample => sample.search === search), search)).toBeTruthy();
    samples.push(await page.evaluate(search => window.activeSearchSamples.find(sample => sample.search === search).end, search) - start);
  }
  samples.sort((a, b) => a - b);
  const result = { samples: 30, p95Ms: samples[28], maxMs: samples[29], method: 'Foreground native window; before filling search to two frames after actual filtered DOM changes. Includes debounce, IPC, rendering and test input overhead.' };
  const previous = JSON.parse(readFileSync('.cache/native-performance.json', 'utf8'));
  previous.inactiveOrBuildLoadSearch = previous.search;
  previous.search = result;
  writeFileSync('.cache/native-performance.json', JSON.stringify(previous, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
