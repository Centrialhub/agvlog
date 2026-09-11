// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('driver operational expense boundary',()=>{
 it('routes drivers to the operational screen instead of the internal finance area',()=>{
  const routes=readFileSync('src/app/AppRoutes.tsx','utf8'),page=readFileSync('src/pages/driver/DriverOperationalExpenses.tsx','utf8');
  expect(routes).toContain('<DriverOperationalExpenses />');expect(routes).not.toContain('O financeiro é acessível somente à equipe interna autorizada.');
  expect(page).toContain('Nenhum pagamento é lançado por esta tela.');expect(page).not.toMatch(/bank_transactions|finance_ledger|financial_obligations|ledgerClient/);
 });
 it('requires a receipt in the driver form and exposes the approval decision reason',()=>{
  const form=readFileSync('src/components/driver/DriverExpenseForm.tsx','utf8'),page=readFileSync('src/pages/driver/DriverOperationalExpenses.tsx','utf8');
  expect(form).toContain('Comprovante obrigatório');expect(form).toContain('required capture="environment"');expect(form).not.toContain('Sem comprovante');
  expect(page).toContain('Motivo da decisão:');
 });
});
