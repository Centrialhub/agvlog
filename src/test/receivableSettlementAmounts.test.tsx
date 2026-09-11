import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {ReceivableSettlementAmounts} from '@/components/financial/ReceivableSettlementAmounts';
import {creditCompositionValid,receivableListSettlement} from '@/lib/financial/receivableCreditAmounts';
import {receivablesPageSchema} from '@/lib/financial/receivablesPageContract';
afterEach(cleanup);
it('separates applied credit from money and updates settled total after a partial receipt',()=>{
 const {rerender}=render(<ReceivableSettlementAmounts nominal="50000" cash="0" credit="40000" settled="40000" open="10000"/>);
 expect(screen.getByText(/Dinheiro recebido:/)).toHaveTextContent(/0,00.*400,00/);
 expect(screen.getByText(/Total liquidado:/)).toHaveTextContent(/400,00.*100,00/);
 rerender(<ReceivableSettlementAmounts nominal="50000" cash="10000" credit="40000" settled="50000" open="0"/>);
 expect(screen.getByText(/Dinheiro recebido:/)).toHaveTextContent(/100,00.*400,00/);
 expect(screen.getByText(/Total liquidado:/)).toHaveTextContent(/500,00.*0,00/);
});
it('keeps legacy composition unavailable and invalid amounts indeterminate',()=>{
 const legacy=receivableListSettlement({amount:500,received_amount:400,status:'partial'});
 const {rerender}=render(<ReceivableSettlementAmounts {...legacy}/>);
 expect(screen.getByText(/Composição entre dinheiro e crédito indisponível/)).toBeInTheDocument();
 expect(screen.queryByText(/Dinheiro recebido:/)).not.toBeInTheDocument();
 const invalid=receivableListSettlement({amount:500,received_amount:400,status:'partial',cash_received_cents:null,credit_applied_cents:null,settled_cents:null,open_cents:null});
 rerender(<ReceivableSettlementAmounts {...invalid}/>);
 expect(screen.getByText(/Total liquidado:/)).toHaveTextContent('Total liquidado: Indeterminado · em aberto: Indeterminado');
 expect(screen.getByText(/Dinheiro recebido:/)).toHaveTextContent('Dinheiro recebido: Indeterminado · crédito aplicado: Indeterminado');
});
it('does not turn a cancelled nominal amount into collectible debt',()=>{
 expect(receivableListSettlement({amount:500,received_amount:0,status:'cancelled'})).toMatchObject({nominal:'50000',settled:'0',open:'0'});
});
it('rejects partial, malformed or inconsistent composition without throwing',()=>{
 const tenant=crypto.randomUUID();const row={id:crypto.randomUUID(),tenant_id:tenant,client_id:null,description:null,invoice_number:null,notes:null,amount:500,received_amount:400,status:'partial',due_date:null,client_invoice_id:null,clients:null};
 const page={version:1,tenant_id:tenant,page:1,page_size:50,total:1,total_unfiltered:1,rows:[row]};
 expect(receivablesPageSchema.safeParse(page).success).toBe(true);
 const valid={cash_received_cents:'0',credit_applied_cents:'40000',settled_cents:'40000'};
 expect(receivablesPageSchema.safeParse({...page,rows:[{...row,...valid}]}).success).toBe(true);
 for(const fields of [{cash_received_cents:'0'},{...valid,cash_received_cents:'NaN'},{...valid,settled_cents:'39999'},{...valid,cash_received_cents:null}]){
  expect(()=>receivablesPageSchema.safeParse({...page,rows:[{...row,...fields}]})).not.toThrow();
  expect(receivablesPageSchema.safeParse({...page,rows:[{...row,...fields}]}).success).toBe(false);
 }
 expect(creditCompositionValid({cash_received_cents:100,credit_applied_cents:400,settled_cents:500},500)).toBe(true);
 expect(creditCompositionValid({cash_received_cents:null,credit_applied_cents:null,settled_cents:null})).toBe(true);
});
