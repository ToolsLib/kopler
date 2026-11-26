import { expect, test } from '@playwright/test';
import { desktopMock } from './desktop-mock';

test.beforeEach(async ({ page }) => { await desktopMock(page); await page.goto('/'); await expect(page.getByLabel('Capture text')).toBeVisible(); });

test('capture, exact copy, completion, edit, delete and undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const text = 'A useful <script>literal</script>\n**next prompt**';
  await page.getByLabel('Capture text').fill(text);
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('');
  await page.getByRole('button', { name: 'Copy item', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.copied)).toBe(text);
  await expect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reopen task', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await page.locator('.item-body').click();
  await expect(page.getByLabel('Edit item text')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await expect(page.getByLabel('Edit item text')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Edit item', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await page.getByLabel('Edit item text').fill('Edited content');
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByLabel('Edit item text')).toHaveValue('Edited content');
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit item', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Items', exact: true })).toBeFocused();
  await expect(page.locator('.item-body')).toHaveText('Edited content');
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this task?' })).toBeVisible();
  await expect(page.locator('.item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.item-body')).toHaveText('Edited content');
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.item-body')).toHaveText('Edited content');
  await page.reload();
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.item-body')).toHaveText('Edited content');
});

test('delete confirmation preserves edits on cancel and failure, and permits retry and Undo', async ({ page }) => {
  await page.getByLabel('Capture text').fill('Original note');
  await page.getByLabel('Capture text').press('Control+Enter');
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await page.getByLabel('Edit item text').fill('Latest edit before deletion');
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this note?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Edit item text')).toHaveValue('Latest edit before deletion');
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Storage is full');
  await expect(page.locator('.item')).toHaveCount(1);
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.item-body')).toHaveText('Latest edit before deletion');
});

for (const kind of ['Note','Task'] as const) {
  test(`Ctrl-click deletes a ${kind.toLowerCase()} immediately and Undo restores it`, async ({page}) => {
    await page.getByLabel('Capture text').fill(`Quick delete ${kind}`);
    await page.getByRole('button',{name:kind,exact:true}).click();
    await page.getByLabel('Capture text').press('Control+Enter');
    const remove = page.getByRole('button',{name:'Delete item',exact:true});
    await expect(remove).toHaveAttribute('title','Delete (Ctrl+click to skip confirmation)');
    await remove.click({modifiers:['Control']});
    await expect(page.locator('.item')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.locator('.item-body')).toHaveText(`Quick delete ${kind}`);
  });
}

test('quick deletion preserves pending edits on failure and restores them with Undo after retry', async ({page}) => {
  await page.getByLabel('Capture text').fill('Original note');
  await page.getByLabel('Capture text').press('Control+Enter');
  await page.getByRole('button',{name:'Edit item',exact:true}).click();
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByLabel('Edit item text').fill('Latest edit before quick deletion');
  await page.getByRole('button',{name:'Delete item',exact:true}).click({modifiers:['Control']});
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByLabel('Edit item text')).toHaveValue('Latest edit before quick deletion');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('button',{name:'Delete item',exact:true}).click({modifiers:['Control']});
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.item-body')).toHaveText('Latest edit before quick deletion');
});

test('macOS quick deletion uses Command while Control keeps confirmation', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(navigator,'platform',{get:()=>'MacIntel'}); });
  await page.reload();
  await page.getByLabel('Capture text').fill('Command-click note');
  await page.getByLabel('Capture text').press('Meta+Enter');
  await page.getByRole('button',{name:'Delete item',exact:true}).click({modifiers:['Control']});
  await expect(page.getByRole('dialog',{name:'Delete this note?'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Delete item',exact:true}).click({modifiers:['Meta']});
  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.item-body')).toHaveText('Command-click note');
});

test('draft persists across restart and clipboard replacement requires confirmation', async ({ page }) => {
  await page.getByLabel('Capture text').fill('Unfinished draft');
  await expect(page.locator('.save-status')).toBeEmpty();
  await page.reload();
  await expect(page.getByLabel('Capture text')).toHaveValue('Unfinished draft');
  await page.getByRole('button', { name: 'Capture clipboard', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await expect(page.getByLabel('Capture text')).toHaveValue('Unfinished draft');
  await page.getByRole('button', { name: 'Capture clipboard', exact: true }).click();
  await page.getByRole('button', { name: 'Replace with clipboard', exact: true }).click();
  await expect(page.getByLabel('Capture text')).toHaveValue('clipboard text');
});

test('failed saves retain content and prevent hiding until retry succeeds', async ({ page }) => {
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByLabel('Capture text').fill('Do not lose this');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByLabel('Capture text')).toHaveValue('Do not lose this');
  expect(await page.evaluate(() => (window as any).testNative.finished)).toBe('');
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).testNative.finished)).toBe('hide');
  await page.reload(); await expect(page.getByLabel('Capture text')).toHaveValue('Do not lose this');
});

test('new projects become the current capture space and deletion keeps content', async ({ page }) => {
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await page.getByLabel('Capture text').fill('Something in Work');
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await page.getByLabel('Search items').fill('Previous search');
  await page.getByLabel('All projects', { exact: true }).check();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Work');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Capture text')).toHaveValue('Something in Work');
  await expect(page.getByLabel('Search items')).toHaveValue('');
  await expect(page.getByLabel('All projects', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.save-status')).toBeEmpty();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.locator('.item-body')).toHaveText('Something in Work');
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByLabel('All projects', { exact: true }).check();
  await expect(page.locator('.item-body')).toHaveText('Something in Work');
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Manage project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByLabel('All projects', { exact: true }).uncheck();
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveCount(0);
  await expect(page.locator('.item-body')).toHaveText('Something in Work');
});

test('keyboard navigation, literal search and minimum window layout', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await page.getByLabel('Capture text').fill('First note'); await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item')).toHaveCount(1);
  await page.getByLabel('Capture text').fill('Second note'); await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item')).toHaveCount(2);
  await page.getByRole('region', { name: 'Items', exact: true }).focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => (window as any).testNative.copied)).toBe('First note');
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search items')).toBeFocused();
  await page.getByLabel('Search items').fill('SECOND');
  await expect(page.locator('.item-body')).toHaveText(['Second note']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('search and filters start hidden, toggle together, and retain an active-search indicator', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Search and filters', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Search items')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Active', exact: true })).toHaveCount(0);
  for (const text of ['Alpha note', 'Beta note']) {
    await page.getByLabel('Capture text').fill(text);
    await page.getByLabel('Capture text').press('Control+Enter');
  }
  await expect(page.locator('.item')).toHaveCount(2);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Search items')).toBeFocused();
  await expect(page.getByLabel('All projects', { exact: true })).toBeVisible();
  await page.getByLabel('Search items').fill('Alpha');
  await expect(page.locator('.item-body')).toHaveText(['Alpha note']);
  await toggle.click();
  await expect(page.getByLabel('Search items')).toBeHidden();
  await expect(toggle).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.item-body')).toHaveText(['Alpha note']);
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search items')).toBeFocused();
  await expect(page.getByLabel('Search items')).toHaveValue('Alpha');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(toggle).toHaveAttribute('data-active', 'false');
  await expect(page.locator('.item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-active', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Search and filters', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Search items')).toBeHidden();
  await expect(page.locator('.item')).toHaveCount(2);
});

test('notes and tasks save into the selected space after switching with a draft', async ({ page }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Work');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('Capture text').fill('A note started in Work');
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  await expect(page.getByLabel('Capture text')).toHaveValue('A note started in Work');
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body')).toHaveText('A note started in Work');

  await page.getByLabel('Capture text').fill('A task started in Inbox');
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await expect(page.getByLabel('Capture text')).toHaveValue('A task started in Inbox');
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await page.getByLabel('All projects', { exact: true }).check();
  await expect(page.locator('.item-body')).toHaveText('A note started in Work');
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item')).toHaveCount(2);
  await page.getByLabel('All projects', { exact: true }).uncheck();
  await expect(page.locator('.item-body')).toHaveText('A task started in Inbox');
  await expect(page.getByRole('button', { name: 'Complete task', exact: true })).toBeVisible();

  await expect(page.locator('.save-status')).toBeEmpty();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.item-body')).toHaveText('A task started in Inbox');
});

test('native quit event flushes an edit before exit', async ({ page }) => {
  await page.getByLabel('Capture text').fill('Original'); await page.getByLabel('Capture text').press('Control+Enter');
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await page.getByLabel('Edit item text').fill('Just typed before quit');
  await page.evaluate(() => (window as any).testNative.emit('window-action', 'quit'));
  await expect.poll(() => page.evaluate(() => (window as any).testNative.finished)).toBe('quit');
  await page.reload(); await expect(page.locator('.item-body')).toHaveText('Just typed before quit');
});

test('inbox tabs support keyboard switching and overflow while preserving the draft', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  for (const name of ['Client work', 'Ideas and research']) {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name').fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByLabel('Capture text').fill('Keep this draft across tabs');
  await page.getByRole('tab', { name: 'Inbox', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Client work', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: 'Client work', exact: true })).toBeVisible();
  await expect(page.getByLabel('Capture text')).toHaveValue('Keep this draft across tabs');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Ideas and research', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('tab', { name: 'Ideas and research', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.getByRole('tablist', { name: 'Inboxes' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body')).toHaveText('Keep this draft across tabs');
  await expect(page.getByRole('tab', { name: 'Ideas and research', exact: true }).locator('.count')).toHaveText('1');
  await expect(page.locator('.project-actions .count')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true }).locator('.count')).toHaveText('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an unapplied shortcut never changes the active shortcut hint', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Global shortcut', { exact: true }).fill('Ctrl+Alt+K');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ctrl + Shift + Space', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Global shortcut', { exact: true })).toHaveValue('Ctrl+Shift+Space');
});

test('empty projects close from background-tab menus or middle click without confirmation', async ({ page }) => {
  for (const name of ['Empty', 'Current']) {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name').fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByLabel('Capture text').fill('Stay in Current');
  const empty = page.getByRole('tab', { name: 'Empty', exact: true });
  await empty.click({ button: 'right' });
  await expect(page.getByRole('tab', { name: 'Current', exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testNative.finished)).toBe('');
  await empty.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await expect(empty).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Current', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Capture text')).toHaveValue('Stay in Current');
  await page.getByLabel('Capture text').fill('');
  await page.getByRole('tab', { name: 'Current', exact: true }).click({ button: 'middle' });
  await expect(page.getByRole('tab', { name: 'Current', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click({ button: 'middle' });
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('hidden completed content requires confirmation and failed project deletion can be retried', async ({ page }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Work');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByLabel('Capture text').fill('Completed work');
  await page.getByLabel('Capture text').press('Control+Enter');
  await page.getByRole('button', { name: 'Complete task', exact: true }).click();
  await page.getByRole('button', { name: 'Search and filters', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await page.getByLabel('Search items').fill('No match');
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Inbox', exact: true }).click();
  const work = page.getByRole('tab', { name: 'Work', exact: true });
  await work.click({ button: 'middle' });
  await expect(page.getByRole('dialog', { name: 'Delete Work?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(work).toBeVisible();
  await work.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByRole('tab', { name: 'Work', exact: true, includeHidden: true })).toBeVisible();
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(work).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('.item-body')).toHaveText('Completed work');
  await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeVisible();
});

test('draft-only projects confirm removal and preserve their draft in Inbox', async ({ page }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('Draft');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('Capture text').fill('Unfinished thought');
  await page.getByRole('tab', { name: 'Draft', exact: true }).click({ button: 'middle' });
  await expect(page.getByRole('dialog', { name: 'Delete Draft?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Draft', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Capture text')).toHaveValue('Unfinished thought');
  await page.getByRole('button', { name: 'Manage project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Draft', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Inbox', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Capture text')).toHaveValue('Unfinished thought');
  await page.reload();
  await expect(page.getByLabel('Capture text')).toHaveValue('Unfinished thought');
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body')).toHaveText('Unfinished thought');
});

test('project context menus support keyboard rename at minimum window size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('A long project name');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('tab', { name: 'A long project name', exact: true }).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', { name: 'Rename project', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Project name', { exact: true }).fill('Renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Renamed', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('appearance follows the system or persists an explicit override', async ({ page }) => {
  const root = page.locator('html');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(root).toHaveCSS('background-color', 'rgb(250, 249, 246)');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(root).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('a failed appearance save keeps the applied mode and permits retry', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => { (window as any).testNative.failSave = true; });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => { (window as any).testNative.failSave = false; });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

test('export feedback remains accessible while settings is open', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status').filter({hasText:'Exported 0 items'})).toBeVisible();
});
