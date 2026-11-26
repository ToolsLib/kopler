import { expect, test } from '@playwright/test';
import { desktopMock } from './desktop-mock';

test.beforeEach(async ({page}) => { await desktopMock(page); await page.goto('/'); await expect(page.getByLabel('Capture text')).toBeVisible(); });

test('manual checks report the actual app version, up-to-date state, and retry after a network failure', async ({page}) => {
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await expect(page.getByText('Kopler 0.1.2', {exact:true}).last()).toBeVisible();
  await page.evaluate(() => { (window as any).testNative.failUpdateCheck = true; });
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not check for updates');
  await page.evaluate(() => { (window as any).testNative.failUpdateCheck = false; });
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await expect(page.locator('.updates-setting')).toContainText('latest version');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('automatic checks notify without taking capture focus, and the opt-out persists', async ({page}) => {
  await page.clock.install();
  await page.reload(); await expect(page.getByLabel('Capture text')).toBeVisible();
  await page.evaluate(() => { (window as any).testNative.availableUpdate = {version:'0.1.3',notes:'Next release'}; });
  await page.getByLabel('Capture text').fill('Keep working');
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('button', {name:'Update available',exact:true})).toBeVisible();
  await expect(page.getByLabel('Capture text')).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.installRequests ?? 0)).toBe(0);
  await page.getByRole('button', {name:'Update available',exact:true}).click();
  await page.getByRole('checkbox', {name:'Check for updates automatically'}).uncheck();
  await expect(page.getByRole('checkbox', {name:'Check for updates automatically'})).not.toBeChecked();
  await page.reload(); await expect(page.getByLabel('Capture text')).toBeVisible();
  await page.clock.fastForward(7 * 60 * 60 * 1000);
  expect(await page.evaluate(() => (window as any).testNative.updateChecks ?? 0)).toBe(0);
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await expect(page.getByRole('checkbox', {name:'Check for updates automatically'})).not.toBeChecked();
});

test('install waits for pending writes and a failed save prevents the installer from running', async ({page}) => {
  await page.evaluate(() => { (window as any).testNative.availableUpdate = {version:'0.1.3',notes:'Next release'}; });
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('button', {name:'Install and restart',exact:true})).toBeVisible();
  // Simulate a late input event while the settings dialog is already open.
  await page.getByLabel('Capture text').evaluate(element => {
    (window as any).testNative.failSave = true;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(element,'A draft that must survive');
    element.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.getByRole('button', {name:'Install and restart',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  expect(await page.evaluate(() => (window as any).testNative.installRequests ?? 0)).toBe(0);
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('button', {name:'Install and restart',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.finished)).toBe('update');
  expect(await page.evaluate(() => (window as any).testNative.draftAtInstall.body)).toBe('A draft that must survive');
});

test('signature or download failure retains the draft and permits retry', async ({page}) => {
  await page.getByLabel('Capture text').fill('Keep my unfinished prompt');
  await page.evaluate(() => { Object.assign((window as any).testNative,{availableUpdate:{version:'0.1.3',notes:'Next release'},failUpdateInstall:true}); });
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await page.getByRole('button', {name:'Install and restart',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('signature verification failed');
  await expect(page.getByLabel('Capture text')).toHaveValue('Keep my unfinished prompt');
  await expect(page.getByRole('button', {name:'Install and restart',exact:true})).toBeEnabled();
  await page.evaluate(() => { (window as any).testNative.failUpdateInstall = false; });
  await page.getByRole('button', {name:'Install and restart',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.finished)).toBe('update');
});

test('package-managed builds offer the release download instead of self-installation', async ({page}) => {
  await page.evaluate(() => {
    localStorage.setItem('test-no-self-install','true');
    localStorage.setItem('test-available-update',JSON.stringify({version:'0.1.3',notes:'Next release'}));
  });
  await page.reload(); await expect(page.getByLabel('Capture text')).toBeVisible();
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await expect(page.getByRole('button', {name:'Install and restart',exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Download update',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.openedUrl)).toBe('https://github.com/ToolsLib/kopler/releases/tag/v0.1.3');
});
