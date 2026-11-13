import {expect,test} from '@playwright/test';
import {desktopMock} from './desktop-mock';

test.beforeEach(async({page})=>{await desktopMock(page);await page.goto('/');await expect(page.getByLabel('Capture text')).toBeVisible();});

test('custom title bar uses the native drag region and controls maximize, restore, and state changes',async({page})=>{
  await expect(page.getByRole('banner',{name:'Window title bar'})).toBeVisible();
  await expect(page.locator('.titlebar-drag')).toHaveAttribute('data-tauri-drag-region','deep');
  await page.getByRole('button',{name:'Maximize window',exact:true}).click();
  await expect(page.getByRole('button',{name:'Restore window',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Restore window',exact:true}).click();
  await expect(page.getByRole('button',{name:'Maximize window',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).testNative.emit('window-state',{maximized:false,focused:false,minimized:false}));
  await expect(page.locator('.titlebar')).toHaveClass(/titlebar-inactive/);
  await expect(page.getByRole('button',{name:'Maximize window',exact:true})).toBeVisible();
});

test('minimize and close flush drafts and a failed save prevents closing',async({page})=>{
  await page.getByLabel('Capture text').fill('Draft before minimizing');
  await page.getByRole('button',{name:'Minimize window',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.window.minimized)).toBe(true);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-native-state')!).draft.body)).toBe('Draft before minimizing');
  await page.getByLabel('Capture text').fill('Draft before closing');
  await page.getByRole('button',{name:'Close window',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.finished)).toBe('hide');
  await page.reload();
  await expect(page.getByLabel('Capture text')).toHaveValue('Draft before closing');
  await page.evaluate(()=>{(window as any).testNative.failSave=true;});
  await page.getByLabel('Capture text').fill('Keep this failed save');
  await page.getByRole('button',{name:'Close window',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Storage is full');
  expect(await page.evaluate(()=>(window as any).testNative.finished)).toBe('');
  await page.evaluate(()=>{(window as any).testNative.failSave=false;});
  await page.getByRole('button',{name:'Close window',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.finished)).toBe('hide');
});

test('recovery retains custom window controls when storage cannot open',async({page})=>{
  await page.evaluate(()=>localStorage.setItem('test-bootstrap-error','Could not open isolated test storage.'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Could not open isolated test storage');
  await expect(page.getByRole('banner',{name:'Window title bar'})).toBeVisible();
  await page.getByRole('button',{name:'Close window',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testNative.finished)).toBe('hide');
});
