import { expect, test, type Page } from '@playwright/test';
import { desktopMock } from './desktop-mock';

async function pasteImage(page: Page, target = 'Capture text', count = 1, type = 'image/png') {
  await page.getByLabel(target, {exact:true}).focus();
  return page.getByLabel(target, {exact:true}).evaluate((element, {count,type}) => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#5a7950'; context.fillRect(0,0,320,180);
    context.fillStyle = '#edf1e7'; context.fillRect(20,20,140,80);
    const data = canvas.toDataURL(type);
    const bytes = Uint8Array.from(atob(data.split(',')[1]), letter=>letter.charCodeAt(0));
    const clipboardData = new DataTransfer();
    for(let i=0;i<count;i++) clipboardData.items.add(new File([bytes],`clipboard-${i}.png`,{type}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    return data;
  }, {count,type});
}

test.beforeEach(async ({page})=>{await desktopMock(page);await page.goto('/');await expect(page.getByLabel('Capture text')).toBeVisible();});

for (const button of ['Copy item', 'Copy text only', 'Copy image 1']) {
  test(`${button} keeps the UI editable and copies without saving pending edits`, async ({page}) => {
    const png = await pasteImage(page);
    await page.getByLabel('Capture text').fill('Saved caption');
    await page.getByRole('button', {name:'Save item',exact:true}).click();
    await page.getByRole('button', {name:'Edit item',exact:true}).click();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 10_000));
    await page.getByLabel('Edit item text').fill('**Latest unsaved caption**');
    await page.getByLabel('Capture text').fill('An unrelated unfinished draft');
    await page.evaluate(() => {
      const native = (window as any).testNative;
      native.failSave = true;
      native.copyGate = new Promise(resolve => { native.releaseCopy = resolve; });
    });
    await page.getByRole('button', {name:button,exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).testNative.copyRequests)).toBe(1);
    await expect(page.getByLabel('Capture text')).toBeEditable();
    await expect(page.getByLabel('Edit item text')).toBeEditable();
    await expect(page.getByRole('button', {name:'New project',exact:true})).toBeEnabled();
    await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => { (window as any).testNative.releaseCopy(); });
    await expect(page.locator('.toast')).toContainText('copied');
    await expect.poll(() => page.evaluate(() => (window as any).testNative.copied)).toBe(button === 'Copy image 1' ? '' : '**Latest unsaved caption**');
    await expect.poll(() => page.evaluate(() => (window as any).testNative.copiedImage)).toBe(button === 'Copy text only' ? '' : png);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-native-state')!));
    expect(saved.items[0].body).toBe('Saved caption');
    expect(saved.draft.body).toBe('');
    // A failed autosave must not block subsequent copies either.
    await page.clock.fastForward(301);
    await expect(page.locator('.save-status')).toContainText('Save failed');
    await page.getByRole('button', {name:button,exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).testNative.copyRequests)).toBe(2);
    await expect(page.locator('.save-status')).toContainText('Save failed');
    await expect(page.getByLabel('Edit item text')).toHaveValue('**Latest unsaved caption**');
  });
}

test('image import keeps the capture textarea focused throughout processing', async ({page}) => {
  await page.getByLabel('Capture text').fill('Keep the caret here');
  await page.getByLabel('Capture text').evaluate(element => {
    (window as any).testNative.importDelay = 500;
    (window as any).captureBlurCount = 0;
    element.addEventListener('blur', () => (window as any).captureBlurCount++);
    (element as HTMLTextAreaElement).setSelectionRange(5, 8);
  });
  await pasteImage(page);
  await expect(page.getByLabel('Capture text')).toBeFocused();
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toBeFocused();
  expect(await page.evaluate(() => (window as any).captureBlurCount)).toBe(0);
  expect(await page.getByLabel('Capture text').evaluate(element => [(element as HTMLTextAreaElement).selectionStart, (element as HTMLTextAreaElement).selectionEnd])).toEqual([5, 8]);
});

test('pasted images retain captions and survive draft recovery, space switching, editing, and copying', async ({page})=>{
  await page.getByLabel('Capture text').fill('A caption worth keeping');
  const png=await pasteImage(page);
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('A caption worth keeping');
  await expect(page.getByLabel('Capture text')).toBeFocused();
  await expect(page.locator('.save-status')).toBeEmpty();
  await page.reload();
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name').fill('Pictures');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Pictures',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await pasteImage(page,'Capture text',1,'image/jpeg');
  await expect(page.locator('.capture-card img')).toHaveCount(2);
  await page.getByRole('button',{name:'Save item',exact:true}).click();
  await expect(page.locator('.item img')).toHaveCount(2);
  await expect(page.locator('.item-body')).toHaveText('A caption worth keeping');
  await expect(page.locator('.capture-card img')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.item img')).toHaveCount(2);
  await page.getByRole('button',{name:'Copy item',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copied)).toBe('A caption worth keeping');
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImages.length)).toBe(2);
  const secondImage=await page.evaluate(()=>(window as any).testNative.copiedImages[1]);
  await page.getByRole('button',{name:'Copy text only',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe('');
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copied)).toBe('A caption worth keeping');
  await page.getByRole('button',{name:'Copy image 2',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe(secondImage);
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copied)).toBe('');
  await expect(page.getByRole('status')).toContainText('Image copied');
  expect(page.context().pages()).toHaveLength(1);
  const opened = page.waitForEvent('popup');
  await page.getByRole('button',{name:'Open image 1',exact:true}).click();
  const viewer = await opened;
  await expect(viewer.getByAltText('Attached image')).toBeVisible();
  await expect(viewer.getByLabel('Zoom level')).toHaveText('100%');
  await viewer.setViewportSize({width:1100,height:840});
  await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(viewer.getByLabel('Zoom level')).toHaveText('125%');
  await viewer.getByRole('button',{name:'Actual size',exact:true}).click();
  await expect(viewer.getByLabel('Zoom level')).toHaveText('100%');
  await viewer.getByRole('button',{name:'Copy image',exact:true}).click();
  await expect.poll(()=>viewer.evaluate(()=>(window as any).testNative.copiedImage)).toBe(png);
  await viewer.getByRole('button',{name:'Close window',exact:true}).click();
  await expect.poll(()=>viewer.isClosed()).toBe(true);
  await page.getByRole('button',{name:'Edit item',exact:true}).click();
  await page.getByRole('button',{name:'Remove image 2',exact:true}).click();
  await pasteImage(page,'Edit item text');
  await expect(page.locator('.item-editor img')).toHaveCount(2);
  await expect(page.getByLabel('Edit item text')).toBeFocused();
  await page.getByRole('button',{name:'Save item changes',exact:true}).click();
  await page.reload();
  await expect(page.locator('.item img')).toHaveCount(2);
  await expect(page.locator('.item-body')).toHaveText('A caption worth keeping');
});

test('Capture clipboard accepts an image-only task and Undo retains its attachment', async ({page})=>{
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=30;return c.toDataURL('image/png');});
  await page.evaluate(png=>{(window as any).testNative.clipboardImage=png;},png);
  await page.getByRole('button',{name:'Capture clipboard',exact:true}).click();
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('');
  await page.getByRole('button',{name:'Task',exact:true}).click();
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item img')).toHaveCount(1);
  await page.getByRole('button',{name:'Copy item',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe(png);
  await page.getByRole('button',{name:'Complete task',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reopen task',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit item',exact:true}).click();
  await page.getByRole('button',{name:'Delete item',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delete this task?'})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Delete item',exact:true}).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.item img')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.item img')).toHaveCount(1);
});

test('an image-only draft requires project deletion confirmation and survives the move to Inbox', async ({page})=>{
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name',{exact:true}).fill('Pictures');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  const png=await pasteImage(page);
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await page.getByRole('tab',{name:'Pictures',exact:true}).click({button:'middle'});
  await expect(page.getByRole('dialog',{name:'Delete Pictures?'})).toBeVisible();
  await page.getByRole('button',{name:'Delete project',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Pictures',exact:true})).toHaveCount(0);
  await expect(page.getByRole('tab',{name:'Inbox',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await page.getByRole('button',{name:'Save item',exact:true}).click();
  await expect(page.locator('.item img')).toHaveCount(1);
  await page.getByRole('button',{name:'Copy item',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe(png);
});

test('failed image paste and attachment limits preserve the existing draft', async ({page})=>{
  await page.getByLabel('Capture text').fill('Keep this draft');
  await pasteImage(page);
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.locator('.save-status')).toBeEmpty();
  await page.evaluate(()=>{(window as any).testNative.failSave=true;});
  await pasteImage(page);
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  await expect(page.getByLabel('Capture text')).toBeFocused();
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('Keep this draft');
  await page.evaluate(()=>{(window as any).testNative.failSave=false;});
  await pasteImage(page,'Capture text',8);
  await expect(page.getByRole('alert')).toContainText('at most 8 images');
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await page.getByRole('button',{name:'Remove image 1',exact:true}).click();
  await expect(page.locator('.capture-card img')).toHaveCount(0);
  await expect(page.getByLabel('Capture text')).toHaveValue('Keep this draft');
});

test('dropping images preserves the draft, saves in the selected space, and rejects mixed files atomically', async ({page})=>{
  await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name').fill('References');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.getByLabel('Capture text').fill('Existing caption');
  await page.getByRole('form',{name:'Capture box'}).evaluate(element=>{
    const canvas=document.createElement('canvas');canvas.width=30;canvas.height=20;
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),letter=>letter.charCodeAt(0));
    const dataTransfer=new DataTransfer();
    dataTransfer.items.add(new File([bytes],'first.png',{type:'image/png'}));
    dataTransfer.items.add(new File([bytes],'second.png',{type:''}));
    element.dispatchEvent(new DragEvent('dragenter',{dataTransfer,bubbles:true,cancelable:true}));
    element.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('.capture-card img')).toHaveCount(2);
  await expect(page.getByLabel('Capture text')).toHaveValue('Existing caption');
  await expect(page.locator('.capture-card')).not.toHaveClass(/drag-over/);
  await page.getByRole('form',{name:'Capture box'}).evaluate(element=>{
    const canvas=document.createElement('canvas');canvas.width=30;canvas.height=20;
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),letter=>letter.charCodeAt(0));
    const dataTransfer=new DataTransfer();
    dataTransfer.items.add(new File([bytes],'good.png',{type:'image/png'}));
    dataTransfer.items.add(new File(['bad'],'other.txt',{type:'text/plain'}));
    element.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
  });
  await expect(page.getByRole('alert')).toContainText('image files');
  await expect(page.locator('.capture-card img')).toHaveCount(2);
  await page.getByLabel('Capture text').press('Control+Enter');
  await expect(page.locator('.item img')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('tab',{name:'References',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.item img')).toHaveCount(2);
  await expect(page.locator('.item-body')).toHaveText('Existing caption');
});

test('mixed clipboard paste keeps both text and image at the text selection', async ({page})=>{
  await page.getByLabel('Capture text').fill('Before REPLACE after');
  await page.getByLabel('Capture text').evaluate(element=>{
    const input=element as HTMLTextAreaElement;input.focus();input.setSelectionRange(7,14);
    const canvas=document.createElement('canvas');canvas.width=30;canvas.height=20;
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),letter=>letter.charCodeAt(0));
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain','caption');
    clipboardData.items.add(new File([bytes],'image.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('Before caption after');
  await expect(page.getByLabel('Capture text')).toBeFocused();
  await expect.poll(()=>page.getByLabel('Capture text').evaluate(element=>(element as HTMLTextAreaElement).selectionStart)).toBe(14);
  await page.getByLabel('Capture text').press('!');
  await expect(page.getByLabel('Capture text')).toHaveValue('Before caption! after');
});

test('a large image fits a resized viewer and supports keyboard zoom and panning', async ({page}) => {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    (window as any).testNative.clipboardImage = canvas.toDataURL();
  });
  await page.getByRole('button', {name:'Capture clipboard',exact:true}).click();
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', {name:'Open image 1',exact:true}).click();
  const viewer = await opened;
  await expect(viewer.getByAltText('Attached image')).toBeVisible();
  await viewer.setViewportSize({width:1000,height:760});
  const before = await viewer.getByAltText('Attached image').boundingBox();
  await viewer.setViewportSize({width:600,height:440});
  await expect.poll(async () => (await viewer.getByAltText('Attached image').boundingBox())!.width).toBeLessThan(before!.width);
  await viewer.getByRole('button', {name:'Actual size',exact:true}).click();
  await expect(viewer.getByLabel('Zoom level')).toHaveText('100%');
  await expect.poll(() => viewer.getByAltText('Attached image').evaluate(image => image.clientWidth)).toBe(2400);
  await viewer.getByLabel('Image canvas').focus();
  await viewer.keyboard.press('Control+=');
  await expect(viewer.getByLabel('Zoom level')).toHaveText('125%');
  const canvas = viewer.getByLabel('Image canvas');
  await canvas.evaluate(element => { element.scrollLeft = 100; element.scrollTop = 100; });
  const bounds = (await canvas.boundingBox())!;
  await viewer.mouse.move(bounds.x + 150, bounds.y + 150);
  await viewer.mouse.down(); await viewer.mouse.move(bounds.x + 70, bounds.y + 70); await viewer.mouse.up();
  await expect.poll(() => canvas.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  await viewer.keyboard.press('Control+0');
  await expect(viewer.getByRole('button', {name:'Fit image',exact:true})).toHaveAttribute('aria-pressed','true');
  await viewer.keyboard.press('Escape').catch(error => { if (!viewer.isClosed()) throw error; });
  await expect.poll(() => viewer.isClosed()).toBe(true);
  await expect(page.getByLabel('Capture text')).toBeVisible();
});
