import {expect,test} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import type {DriverOfflineHarness} from './fixtures/driver-offline-harness';

type HarnessGlobal=typeof globalThis&{driverOfflineHarness:DriverOfflineHarness};
let server:ViteDevServer;
let harnessUrl:string;

test.beforeAll(async()=>{
  server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
  await server.listen();
  const baseUrl=server.resolvedUrls?.local[0];
  if(!baseUrl)throw new Error('Vite did not expose the offline harness URL.');
  harnessUrl=new URL('/e2e/fixtures/driver-offline-harness.html',baseUrl).href;
});
test.afterAll(async()=>{await server.close();});

test.describe('driver durable IndexedDB',()=>{
  test.describe.configure({mode:'serial'});
  test('persiste canhoto, assinatura e foto após reload e reabertura real do banco',async({page})=>{
    await page.goto(harnessUrl);
    await expect(page.locator('#ready')).toHaveText('Pronto');
    await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.reset());
    await expect(page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.queueDelivery())).resolves.toMatchObject({queued:true,request_id:'71000000-0000-4000-8000-000000000005'});
    const before=await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.inspect());
    expect(before.row?.files.map(file=>file.slot)).toEqual(['photo:0','receipt:original','receipt:processed','receipt:thumbnail','signature']);
    expect(before.row?.files.map(file=>file.text)).toEqual(['foto-entrega','canhoto-original','canhoto-processado','canhoto-miniatura','assinatura']);
    expect(before.row?.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256??''))).toBe(true);

    await page.reload();
    await expect(page.locator('#ready')).toHaveText('Pronto');
    const reopened=await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.inspect());
    expect(reopened).toEqual(before);
    expect(reopened.pending).toMatchObject([{requestId:'71000000-0000-4000-8000-000000000005',fileCount:5}]);
  });

  test('atualiza snapshot de cache sem apagar a outbox persistente',async({page})=>{
    await page.goto(harnessUrl);
    await expect(page.locator('#ready')).toHaveText('Pronto');
    await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.reset());
    await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.queueDelivery());
    await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.writeCache());
    await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.updateCache());
    const cache=await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.readCache());
    expect(cache?.payload).toEqual({version:2,stops:[{status:'arrived'},{status:'pending'}]});
    expect((await page.evaluate(()=>(globalThis as HarnessGlobal).driverOfflineHarness.inspect())).row?.id).toBe('71000000-0000-4000-8000-000000000005');
  });
});
