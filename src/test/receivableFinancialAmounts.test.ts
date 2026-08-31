import {describe,expect,it} from 'vitest';
import {parseMoneyCents} from '@/lib/financial/receivableCommands';
import {receivableTotals} from '@/lib/financial/receivableTotals';
describe('exact financial amounts and summaries',()=>{
 it('parses decimal strings directly into integer cents',()=>{expect(parseMoneyCents('10,01')).toBe(1001);expect(parseMoneyCents('0.01')).toBe(1);expect(parseMoneyCents('1.1')).toBe(110);});
 it('rejects ambiguous or nonpositive amounts',()=>{for(const raw of ['1.000,00','1e3','1,001','0','-10','NaN','Infinity'])expect(()=>parseMoneyCents(raw)).toThrow();});
 it('includes partial receipts and their remaining balance without counting canceled titles',()=>{
  expect(receivableTotals([{status:'partial',amount:100,received_amount:40,client_invoice_id:'invoice'},{status:'partial',amount:80,received_amount:20,client_invoice_id:null},{status:'received',amount:30,received_amount:30,client_invoice_id:null},{status:'cancelled',amount:999,received_amount:0,client_invoice_id:null}])).toEqual({pending:60,invoiced:60,received:90});
 });
});
