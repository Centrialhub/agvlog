import {render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import {ExpenseUnloadingHistory} from '@/components/financial/ExpenseUnloadingHistory';
import {unloadingEffectiveOriginSchema} from '@/lib/financial/unloadingOriginCorrectionContract';
const tenant='11111111-1111-4111-8111-111111111111',charge='22222222-2222-4222-8222-222222222222',receivable='33333333-3333-4333-8333-333333333333',supplier='44444444-4444-4444-8444-444444444444';
const before={status:'active',supplier_id:supplier,supplier_name:'Fornecedor original',amount_cents:'15000'};
const after={status:'active',supplier_id:'55555555-5555-4555-8555-555555555555',supplier_name:'Fornecedor corrigido',amount_cents:'12000'};
function origin(){return unloadingEffectiveOriginSchema.parse({version:1,tenant_id:tenant,charge_id:charge,receivable_id:receivable,verified:true,issue:null,original:before,effective:after,revision:'a'.repeat(32),last_effective_on:'2026-08-03',history:[{id:crypto.randomUUID(),previous_id:null,ordinal:1,revision_after:'a'.repeat(32),operation:'amend_origin',effective_on:'2026-08-03',created_at:'2026-08-04T12:00:00Z',actor_id:crypto.randomUUID(),actor_name:'Maria Financeiro',reason:'Correção da cobrança conferida',before,after,economic_effects:[{leg:'release',supplier_id:supplier,supplier_name:'Fornecedor original',amount_cents:'-15000'},{leg:'recognize',supplier_id:after.supplier_id,supplier_name:after.supplier_name,amount_cents:'12000'}]}]});}
const row={tenant_id:tenant,unloading_id:charge,receivable_id:receivable,amount_cents:15000,supplier_name:'Prestador do serviço'};
describe('expense unloading history',()=>{
 it('separates original cost, current collection right and the dated audit history',()=>{
  render(<ExpenseUnloadingHistory row={{...row,unloading_origin:origin()}}/>);
  expect(screen.getByText('Custo original registrado: R$ 150,00 · Prestador do serviço')).toBeInTheDocument();
  expect(screen.getByText('Direito de cobrança vigente: R$ 120,00 · Fornecedor corrigido')).toBeInTheDocument();
  expect(screen.getByText('Registro original da cobrança: R$ 150,00 · Fornecedor original')).toBeInTheDocument();
  expect(screen.getByText('Maria Financeiro · Correção da cobrança conferida')).toBeInTheDocument();
  expect(screen.getByText(/Baixas e saldo em aberto devem ser consultados no título/)).toBeInTheDocument();
 });
 it('shows cancelled collection without reporting that the cost was cancelled',()=>{
  const value=origin();value.effective={...value.effective!,status:'cancelled',amount_cents:'0'};
  render(<ExpenseUnloadingHistory row={{...row,unloading_origin:value}}/>);
  expect(screen.getByText(/Direito de cobrança cancelado: R\$ 0,00/)).toBeInTheDocument();
  expect(screen.getByText(/Custo original registrado: R\$ 150,00/)).toBeInTheDocument();
 });
 it.each(['absent','unverified','wrong tenant','wrong charge'])('does not substitute expense amount for an unconfirmed right: %s',kind=>{
  const value=origin();if(kind==='unverified'){value.verified=false;value.effective=null;value.issue='chain_unverified';}if(kind==='wrong tenant')value.tenant_id=crypto.randomUUID();if(kind==='wrong charge')value.charge_id=crypto.randomUUID();
  render(<ExpenseUnloadingHistory row={{...row,unloading_origin:kind==='absent'?undefined:value}}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Cobrança vigente não confirmada');
  expect(screen.queryByText(/Direito de cobrança vigente:/)).not.toBeInTheDocument();
 });
});
