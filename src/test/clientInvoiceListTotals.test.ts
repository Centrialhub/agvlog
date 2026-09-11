import {expect,it} from 'vitest';
import {invoiceListTotals} from '@/lib/financial/clientInvoiceList';
const now=new Date('2026-09-11T12:00:00Z');
const row={status:'generated',due_date:null,received_amount:0,open_amount:0,requires_reconciliation:false};
it('sums500 maximum values and their final cent without Number precision loss',()=>{
 const invoices=Array.from({length:500},()=>({...row,status:'sent',due_date:'2026-01-01',received_amount:999999999999.99,open_amount:999999999999.99}));
 const expected=(99999999999999n*500n).toString();expect(invoiceListTotals(invoices,now)).toEqual({open:expected,overdue:expected,sent:expected,paid:expected});
 expect(invoiceListTotals([...invoices,{...row,received_amount:0.01,open_amount:0.01}],now)).toMatchObject({paid:(BigInt(expected)+1n).toString(),open:(BigInt(expected)+1n).toString()});
});
it('preserves category rules, cancelled exclusion and total settled label semantics',()=>{
 expect(invoiceListTotals([{...row,received_amount:0.29,open_amount:0.71},{...row,status:'sent',due_date:'2026-01-01',received_amount:40,open_amount:10},{...row,status:'paid',received_amount:50,open_amount:0},{...row,status:'cancelled',received_amount:999,open_amount:999}],now)).toEqual({open:'1071',overdue:'1000',sent:'1000',paid:'9029'});
});
it('does not turn unknown or inconsistent legacy money into zero',()=>{
 for(const patch of [{received_amount:null},{open_amount:null},{received_amount:1.005},{open_amount:NaN},{requires_reconciliation:true}])expect(invoiceListTotals([{...row,...patch}],now)).toEqual({open:null,overdue:null,sent:null,paid:null});
 expect(invoiceListTotals([],now)).toEqual({open:'0',overdue:'0',sent:'0',paid:'0'});
});
