import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const executable = resolve(process.env.KOPLER_TEST_EXE ?? 'src-tauri/target/release/kopler.exe');
const directory = resolve('.cache/benchmark-data');
const samples = [];
const percentile = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
let app;
let browser;
let page;

async function connect() {
  for (let i = 0; i < 200; i++) {
    try {
      const response = await fetch('http://127.0.0.1:9223/json/version');
      if (response.ok) {
        const connected = await chromium.connectOverCDP('http://127.0.0.1:9223');
        const target = connected.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
        if (target) return { browser: connected, page: target };
        await connected.close();
      }
    } catch {}
    await sleep(25);
  }
  throw new Error('App did not expose its isolated test WebView.');
}

for (let i = 0; i < 20; i++) {
  const start = performance.now();
  app = spawn(executable, [], { windowsHide: true, env: { ...process.env, KOPLER_DATA_DIR: directory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' } });
  const exited = new Promise(resolve => app.once('exit', resolve));
  ({ browser, page } = await connect());
  await expect(page.getByLabel('Capture text')).toBeVisible();
  const state = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('bootstrap'));
  if (state.dataPath !== directory) throw new Error('Another app instance is running; stop it before benchmarking.');
  samples.push(performance.now() - start);
  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/startup-performance.json', JSON.stringify({ samples, p95Ms: percentile(samples) }, null, 2));
  if (i !== 19) {
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('finish_window_action', { action: 'quit' })).catch(() => {});
    await exited; await browser.close().catch(() => {}); await sleep(75);
  }
}

await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
await page.getByLabel('All projects', { exact: true }).check();
await expect(page.locator('.item')).toHaveCount(60);
await page.evaluate(() => {
  window.performanceSamples = [];
  const list = document.querySelector('.item-list');
  new MutationObserver(() => {
    const search = document.querySelector('input[aria-label="Search items"]').value;
    const bodies = [...list.querySelectorAll('.item-body')];
    if (search && bodies.length && bodies.every(body => body.textContent.includes(search))) {
      requestAnimationFrame(() => requestAnimationFrame(() => window.performanceSamples.push({ search, end: performance.now() })));
    }
  }).observe(list, { childList: true, subtree: true, characterData: true });
});
const searchTimes = [];
for (let i = 0; i < 30; i++) {
  const search = `reference-${i} `;
  const start = await page.evaluate(() => performance.now());
  await page.getByLabel('Search items').fill(search);
  await expect.poll(() => page.evaluate(search => window.performanceSamples.find(sample => sample.search === search), search)).toBeTruthy();
  const end = await page.evaluate(search => window.performanceSamples.find(sample => sample.search === search).end, search);
  searchTimes.push(end - start);
}

const revealTimes = [];
await page.evaluate(() => {
  window.revealSamples = [];
  const internal = window.__TAURI_INTERNALS__;
  const id = internal.transformCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => window.revealSamples.push(performance.now()))));
  return internal.invoke('plugin:event|listen', { event: 'capture-focus', target: { kind: 'Any' }, handler: id });
});
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('finish_window_action', { action: 'hide' }));
  const start = await page.evaluate(() => performance.now());
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--show'], { windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  await expect.poll(() => page.evaluate(() => window.revealSamples.length)).toBeGreaterThan(i);
  const end = await page.evaluate(index => window.revealSamples[index], i);
  revealTimes.push(end - start);
}
await page.getByLabel('Search items').fill('');
await expect(page.locator('.item')).toHaveCount(60);
const result = {
  pid: app.pid, items: 10000, projects: 20, bodyBytes: 1024,
  coldLaunch: { samples: samples.length, p95Ms: percentile(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples), method: 'Process-cold, warm filesystem cache; launch to interactive capture through CDP. Includes test attachment overhead.' },
  search: { samples: searchTimes.length, p95Ms: percentile(searchTimes), maxMs: Math.max(...searchTimes), method: 'Before filling search through two frames after real native query; includes debounce, IPC, rendering and test input overhead.' },
  reveal: { samples: revealTimes.length, p95Ms: percentile(revealTimes), maxMs: Math.max(...revealTimes), method: 'Second-process --show request to two frames after focus event. Includes process launch overhead; not a global-hotkey latency measurement.' },
};
mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/native-performance.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
