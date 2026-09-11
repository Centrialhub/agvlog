import { expect, test } from '@playwright/test';

test.describe('PWA offline shell',()=>{
  test('reabre o build sem rede após o primeiro carregamento @critical',async({page,context})=>{
    const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto('/auth',{waitUntil:'networkidle'});
    await page.waitForFunction(async()=>{
      if(!('serviceWorker' in navigator))return false;
      await navigator.serviceWorker.ready;
      return true;
    });
    await page.reload({waitUntil:'networkidle'});
    const onlineText=(await page.locator('body').innerText()).trim();
    expect(onlineText.length).toBeGreaterThan(20);
    await expect(page.locator('.vite-error-overlay')).toHaveCount(0);
    const cacheNames=await page.evaluate(()=>caches.keys());
    expect(cacheNames.some(name=>name.startsWith('agvlog-driver-shell-'))).toBe(true);
    const offlineEvidence=await page.evaluate(async()=>({
      controlled:!!navigator.serviceWorker.controller,
      entries:(await Promise.all((await caches.keys()).map(async name=>(await (await caches.open(name)).keys()).map(request=>request.url)))).flat(),
    }));
    expect(offlineEvidence.controlled).toBe(true);
    expect(offlineEvidence.entries.some(url=>url.includes('/assets/DriverDeliveries-'))).toBe(true);

    await context.setOffline(true);
    await page.goto('/auth',{waitUntil:'domcontentloaded'});
    await expect.poll(async()=>(await page.locator('body').innerText()).trim().length).toBeGreaterThan(20);
    await expect(page.locator('.vite-error-overlay')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
