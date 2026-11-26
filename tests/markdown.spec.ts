import { expect, test } from '@playwright/test';
import { desktopMock } from './desktop-mock';

test.beforeEach(async ({ page }) => { await desktopMock(page); await page.goto('/'); });

test('Markdown renders while editing and copying preserve the exact source', async ({ page }) => {
  const source = '# Plan\n\n**Keep this** and `npm test`.\n\n- [ ] Check Windows\n- [x] Check clipboard\n\n```rust\nfn main() {\n    println!("hello");\n}\n```\n\n| OS | Status |\n| --- | --- |\n| Windows | Ready |\n\n[Docs](https://example.com/docs) · [local file](C:/Users/example/app.ts:14)';
  await page.getByLabel('Capture text').fill(source);
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body h1')).toHaveText('Plan');
  await expect(page.locator('.item-body strong')).toHaveText('Keep this');
  await expect(page.locator('.item-body pre code')).toHaveText('fn main() {\n    println!("hello");\n}\n');
  await expect(page.locator('.item-body table')).toContainText('Windows');
  await expect(page.locator('.item-body input:checked')).toHaveCount(1);
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.openedUrl)).toBe('https://example.com/docs');
  await expect(page.getByRole('link', { name: 'local file' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy item', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.copied)).toBe(source);
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await expect(page.getByLabel('Edit item text')).toHaveValue(source);
  await page.getByRole('button', { name: 'Save item changes', exact: true }).click();
  await page.reload();
  await expect(page.locator('.item-body h1')).toHaveText('Plan');
});

test('Markdown MIME paste replaces the selection and retains the caret', async ({ page }) => {
  await page.getByLabel('Capture text').fill('Before REPLACE after');
  await page.getByLabel('Capture text').evaluate(element => {
    const input = element as HTMLTextAreaElement; input.focus(); input.setSelectionRange(7, 14);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/markdown', '**Markdown**'); clipboardData.setData('text/plain', 'Markdown');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Capture text')).toHaveValue('Before **Markdown** after');
  await expect.poll(() => page.getByLabel('Capture text').evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(19);
  await expect(page.getByLabel('Capture text')).toBeFocused();
});

test('pasted Markdown cannot execute HTML, open unsafe links, or fetch remote images', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('example.invalid')) requests.push(request.url()); });
  const source = '<script>window.markdownExecuted = true</script>\n\n<img src="https://example.invalid/tracker" onerror="window.markdownExecuted=true">\n\n[Unsafe](javascript:alert(1))\n\n![Private image](https://example.invalid/image.png)';
  await page.getByLabel('Capture text').fill(source);
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item-body')).toContainText('Private image');
  await expect(page.locator('.item-body img, .item-body script, .item-body a')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).markdownExecuted)).toBeUndefined();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Copy item', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testNative.copied)).toBe(source);
});
