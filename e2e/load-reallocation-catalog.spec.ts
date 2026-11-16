import {expect,test} from '@playwright/test';
import {accounts} from './fixtures/accounts';
import {loginThroughUi} from './fixtures/session';

test('@critical reallocation lists loads using the tenant-scoped fiscal relationship',async({page})=>{
 await loginThroughUi(page,accounts.operator);
 const metadata=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/rest/v1/load_items'&&!!url.searchParams.get('select')?.includes('orders(order_number)');
 });
 await page.goto('/reallocation');
 const response=await metadata;
 expect(response.status()).toBe(200);
 expect(new URL(response.url()).searchParams.get('select')).toContain('fiscal_documents!load_items_fiscal_tenant_fkey(');
 await expect(page.getByLabel('Carga Origem',{exact:true})).toBeEnabled();
 await expect(page.getByLabel('Carga Destino',{exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Tentar novamente',exact:true})).toHaveCount(0);
});
