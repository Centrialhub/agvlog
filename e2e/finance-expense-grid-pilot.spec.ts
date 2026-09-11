import {expect,test} from '@playwright/test';
import {accounts} from './fixtures/accounts';
import {loginThroughUi} from './fixtures/session';

// Real stack and existing deterministic auth seed. No interception, database writes,
// fictitious trip completion or finance movement fixture is used by this draft test.
test('trip expense grid supports keyboard entry, totals and draft recovery against real readers',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop-chromium','Piloto de teclado executado no desktop.');
 test.setTimeout(90_000);
 await loginThroughUi(page,accounts.operator);
 await page.goto('/financial/recorded-expenses');
 await expect(page.getByRole('heading',{name:'Gastos conferidos',exact:true})).toBeVisible();
 const writes:string[]=[];
 page.on('request',request=>{if(request.url().includes('/rest/v1/rpc/')&&/\/(record_finance_expense_batch|record_finance_movement)$/.test(new URL(request.url()).pathname))writes.push(request.url());});
 await page.getByRole('button',{name:'Conferir gastos em lote',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Conferir gastos em lote'});
 await expect(dialog.getByLabel('Origem dos gastos',{exact:true})).toHaveValue('trip');
 const options=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/rpc/get_finance_expense_options')&&response.request().method()==='POST');
 await dialog.getByRole('button',{name:'Viagem finalizada: Selecionar',exact:true}).click();
 expect((await options).ok(),'Consulta real de opções precisa estar disponível').toBeTruthy();
 await dialog.getByLabel('Buscar Viagem finalizada',{exact:true}).press('Escape');
 await expect(dialog.getByRole('group',{name:'Selecionar Viagem finalizada'})).toHaveCount(0);
 await dialog.getByLabel('Categoria 1',{exact:true}).selectOption('fuel');
 await dialog.getByLabel('Descrição 1',{exact:true}).fill('Combustível do retorno');
 await dialog.getByLabel('Valor 1',{exact:true}).fill('300,00');
 await dialog.getByLabel('Valor 1',{exact:true}).press('Control+Enter');
 await expect(dialog.getByLabel('Categoria 2',{exact:true})).toBeFocused();
 await dialog.getByLabel('Categoria 2',{exact:true}).selectOption('food');
 await dialog.getByLabel('Descrição 2',{exact:true}).fill('Alimentação do retorno');
 await dialog.getByLabel('Valor 2',{exact:true}).fill('150,00');
 await dialog.getByRole('button',{name:'Reutilizar dados do gasto 2',exact:true}).click();
 await expect(dialog.getByLabel('Valor 3',{exact:true})).toBeFocused();
 await expect(dialog.getByLabel('Valor 3',{exact:true})).toHaveValue('');
 await expect(dialog.getByLabel('Descrição 3',{exact:true})).toHaveValue('Alimentação do retorno');
 await dialog.getByLabel('Valor 3',{exact:true}).fill('30,00');
 const summary=dialog.getByLabel('Resumo do lote',{exact:true});
 await expect(summary).toContainText('3 gastos · Total R$ 480,00 · Vinculado R$ 0,00');
 await expect(summary).toContainText('Complementos a pagar: R$ 480,00');
 await dialog.getByRole('button',{name:'Remover gasto 2',exact:true}).click();
 await expect(dialog.getByLabel('Categoria 2',{exact:true})).toBeFocused();
 await expect(dialog.getByLabel('Valor 2',{exact:true})).toHaveValue('30,00');
 await expect(summary).toContainText('2 gastos · Total R$ 330,00');
 await dialog.getByRole('button',{name:'Fechar e guardar rascunho',exact:true}).click();
 await page.getByRole('button',{name:'Conferir gastos em lote',exact:true}).click();
 await expect(dialog.getByLabel('Valor 1',{exact:true})).toHaveValue('300,00');
 await expect(dialog.getByLabel('Valor 2',{exact:true})).toHaveValue('30,00');
 expect(writes,'Este teste não registra lote nem movimento').toEqual([]);
});
