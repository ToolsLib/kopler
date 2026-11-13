import { expect, test, type Page } from '@playwright/test';
import { desktopMock } from './desktop-mock';

async function pasteImage(page: Page, target = 'Capture text', count = 1, type = 'image/png') {
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

test('pasted images retain captions and survive draft recovery, space switching, editing, and copying', async ({page})=>{
  await page.getByLabel('Capture text').fill('A caption worth keeping');
  const png=await pasteImage(page);
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('A caption worth keeping');
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
  await page.getByRole('button',{name:'Copy text only',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe('');
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copied)).toBe('A caption worth keeping');
  await page.getByRole('button',{name:'Open image 1',exact:true}).click();
  await expect(page.getByRole('dialog').getByAltText('Attached image')).toBeVisible();
  await page.getByRole('button',{name:'Copy image',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.copiedImage)).toBe(png);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Edit item',exact:true}).click();
  await page.getByRole('button',{name:'Remove image 2',exact:true}).click();
  await pasteImage(page,'Edit item text');
  await expect(page.locator('.item-editor img')).toHaveCount(2);
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
    const input=element as HTMLTextAreaElement;input.setSelectionRange(7,14);
    const canvas=document.createElement('canvas');canvas.width=30;canvas.height=20;
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),letter=>letter.charCodeAt(0));
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain','caption');
    clipboardData.items.add(new File([bytes],'image.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('.capture-card img')).toHaveCount(1);
  await expect(page.getByLabel('Capture text')).toHaveValue('Before caption after');
});
