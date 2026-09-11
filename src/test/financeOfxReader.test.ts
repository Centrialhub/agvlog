// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {ofxDate,ofxMoney,readOfxStatement} from '../../supabase/functions/_shared/finance-ofx-reader';
const encode=(text:string)=>new TextEncoder().encode(text);
import {ofxTransaction as transaction,ofxFile as file} from './helpers/financeOfxFixture';
describe('native OFX evidence reader',()=>{
 it('preserves native identity, civil bank date, exact amount and separate balances without inventing opening balance',()=>{
  const result=readOfxStatement(encode(file()));expect(result.account).toEqual({bank_id:'001',branch_id:'1234',account_id:'000123-4',account_type:'CHECKING'});
  expect(result.rows[0]).toMatchObject({posted_on:'2026-09-09',amount_cents:-50000,bank_id:'abc',counterparty_name:'João & Maria'});
  expect(result.posted_dates[0]).toMatchObject({offset_minutes:-180,instant:'2026-09-09T13:30:00.000Z'});
  expect(result.ledger_balance?.amount_cents).toBe(100000);expect(result.available_balance?.amount_cents).toBe(80000);
  expect(result).toMatchObject({opening_balance:null,account_verification:'pending',coverage_verification:'pending',net_cents:'-50000'});
 });
 it('reads SGML leaf tags without closing tags using the declared Windows encoding',()=>{
  const body=file().replace(/<\?xml[^>]+>/,'').replace(/<\/(TRNTYPE|DTPOSTED|TRNAMT|FITID|NAME|MEMO|CODE|SEVERITY|CURDEF|BANKID|BRANCHID|ACCTID|ACCTTYPE|DTSTART|DTEND|BALAMT|DTASOF)>/g,'');
  const text='OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n\n'+body;
  const result=readOfxStatement(Uint8Array.from([...text].map(char=>char.charCodeAt(0))));expect(result.syntax).toBe('sgml');expect(result.rows[0].counterparty_name).toBe('João & Maria');
 });
 it('keeps repeated FITIDs and equal transactions for identity review rather than dropping occurrences',()=>{
  const result=readOfxStatement(encode(file(transaction()+transaction())));expect(result.rows).toHaveLength(2);expect(result.repeated_bank_ids).toEqual(['abc']);expect(result.outflow_cents).toBe('100000');
 });
 it('retains backdated rows outside the declared interval and flags coverage uncertainty',()=>{
  const result=readOfxStatement(encode(file().replace('20260909103000','20260831103000')));expect(result.rows[0].posted_on).toBe('2026-08-31');expect(result.outside_declared_period).toBe(true);
 });
 it('accepts an empty transaction list as balance evidence without inventing a transaction',()=>{
  const result=readOfxStatement(encode(file('')));expect(result.rows).toEqual([]);expect(result.net_cents).toBe('0');expect(result.ledger_balance?.amount_cents).toBe(100000);
 });
 it.each([
  [()=>file().replace('</OFX>',''),'ofx_incomplete_document'],
  [()=>file().replace('<CURDEF>BRL</CURDEF>','<CURDEF>BRL</CURDEF><CURDEF>USD</CURDEF>'),'ofx_duplicate_field'],
  [()=>file().replace('<OFX>','<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///secret">]><OFX>'),'ofx_unsupported_markup'],
  [()=>file().replace('<FITID>abc</FITID>','<FITID>abc</FITID><CORRECTFITID>old</CORRECTFITID>'),'ofx_corrections_require_review'],
  [()=>file().replace('<CODE>0</CODE>','<CODE>2000</CODE>'),'ofx_bank_response_not_successful'],
  [()=>file(transaction('abc','500.00')),'ofx_direction_conflict'],
  [()=>file().replace('<CURDEF>BRL</CURDEF>','<CURDEF>USD</CURDEF>'),'ofx_unsupported_currency'],
 ])('rejects malformed or unsupported financial evidence %#',(source,error)=>{expect(()=>readOfxStatement(encode(source()))).toThrow(error);});
 it('keeps exact cents and rejects fractional money, invalid civil dates and excess precision',()=>{
  expect(ofxMoney('-500.0000')).toBe(-50000);expect(()=>ofxMoney('10.001')).toThrow('ofx_fractional_cent');expect(()=>ofxMoney('1e3')).toThrow();
  expect(()=>ofxDate('20260230000000')).toThrow('ofx_invalid_date');expect(()=>ofxDate('20260909246000')).toThrow('ofx_invalid_date');
  expect(ofxDate('20260909')).toMatchObject({date:'2026-09-09',offset_minutes:null,precision:'date'});
 });
});
