import {expect,test} from '@playwright/test';
import {accounts} from './fixtures/accounts';
import {loginThroughUi} from './fixtures/session';

const routes=[
 ['/financial','Financeiro'],
 ['/financial/movements','Movimentações registradas'],
 ['/financial/recorded-expenses','Gastos conferidos'],
 ['/financial/statements','Extratos importados'],
 ['/financial/audit','Auditoria financeira'],
 ['/financial/fiscal-queue','Recebíveis fiscais'],
] as const;

test('financial pages load their actual backend queries for an internal operator',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop-chromium','A verificação completa de disponibilidade é executada uma vez.');
 test.setTimeout(120_000);
 await loginThroughUi(page,accounts.operator);
 for(const [path,heading] of routes){
  await test.step(path,async()=>{
   const failures:string[]=[];
   const capture=(response:import('@playwright/test').Response)=>{
    if(response.url().includes('/rest/v1/rpc/')&&response.status()>=400)failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
   };
   page.on('response',capture);
   try{
    await page.goto(path);
    await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
    await expect(page.locator('[role="status"]').filter({hasText:/Carregando|Consultando|Verificando/})).toHaveCount(0,{timeout:20_000});
    await expect(page.getByRole('alert').filter({hasText:/Não foi possível|não está disponível|não permitido/})).toHaveCount(0);
    expect(failures,'RPCs devem existir e aceitar a consulta autorizada').toEqual([]);
   }finally{page.off('response',capture);}
  });
 }
});
