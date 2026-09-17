// @vitest-environment node
import {expect,it} from 'vitest';
import {validateQuarantinedData} from '../../supabase/functions/secure-upload/quarantine-validation';
import {ofxFile} from './helpers/financeOfxFixture';
import * as XLSX from 'xlsx';
const encode=(value:string)=>new TextEncoder().encode(value);
const workbookBytes=(type:'xls'|'xlsx')=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Data','Descrição','Valor'],['01/01/2026','PIX',-500]]),'Extrato');return new Uint8Array(XLSX.write(book,{type:'array',bookType:type==='xls'?'biff8':'xlsx'}));};
it('derives native OFX JSON without attesting bank authenticity or antivirus',()=>{
 const result=validateQuarantinedData('ofx',encode(ofxFile()));expect(result.state).toBe('validated_data');
 if(result.state!=='validated_data')throw new Error('Expected parsed data');
 expect(JSON.parse(new TextDecoder().decode(result.bytes))).toMatchObject({account_verification:'pending',rows:[{amount_cents:-50000}]});expect(result).not.toHaveProperty('scanned');expect(result).not.toHaveProperty('clean');
});
it('rejects external entities and malformed CSV without producing a usable derivative',()=>{
 expect(()=>validateQuarantinedData('ofx',encode('<!DOCTYPE OFX SYSTEM "https://invalid.example/test">'+ofxFile()))).toThrow();
 expect(()=>validateQuarantinedData('csv',encode('date;amount\n"unterminated'),';')).toThrow();
 expect(()=>validateQuarantinedData('csv',encode('a;b\n\u0000x;1'),';')).toThrow();
 expect(()=>validateQuarantinedData('csv',encode('a;b'))).toThrow();
});
it('preserves CSV as inert data and requires financial mapping',()=>{
 const result=validateQuarantinedData('csv',encode('description;amount\n"=HYPERLINK(""url"")";12'),';');expect(result.state).toBe('validated_data');
 if(result.state==='validated_data'){expect(result.financialMappingRequired).toBe(true);expect(result.mime).toBe('application/json');}
});
it('creates deterministic inert XLSX derivatives only after server-side signature and workbook validation',()=>{
 for(const format of ['xlsx'] as const){
  const source=workbookBytes(format),first=validateQuarantinedData(format,source,undefined,0),second=validateQuarantinedData(format,source,undefined,0);
  expect(first).toMatchObject({state:'validated_data',method:'strict-workbook-matrix-v1',mime:'application/json',financialMappingRequired:true});
  if(first.state!=='validated_data'||second.state!=='validated_data')throw new Error('Expected workbook data');
  expect(first.bytes).toEqual(second.bytes);expect(JSON.parse(new TextDecoder().decode(first.bytes))).toEqual({version:1,format,sheet_index:0,sheet_count:1,sheet_names:['Extrato'],date1904:false,rows:[['Data','Descrição','Valor'],['01/01/2026','PIX',-500]]});
 }
 expect(validateQuarantinedData('xls',workbookBytes('xls'),undefined,0)).toEqual({state:'quarantined',issue:'legacy_workbook_requires_review'});
 expect(()=>validateQuarantinedData('xlsx',workbookBytes('xls'),undefined,0)).toThrow('workbook_signature');
 expect(()=>validateQuarantinedData('xls',workbookBytes('xlsx'),undefined,0)).toThrow('workbook_signature');
 expect(()=>validateQuarantinedData('xlsx',workbookBytes('xlsx'))).toThrow('sheet_required');
});
it.each(['pdf','jpeg','png','html'])('keeps %s quarantined until a supported sanitizer exists',format=>{
 expect(validateQuarantinedData(format,encode('synthetic'))).toMatchObject({state:'quarantined'});
});
it('enforces original and cell limits',()=>{
 expect(()=>validateQuarantinedData('csv',new Uint8Array(10*1024*1024+1),';')).toThrow('size_limit');
 expect(()=>validateQuarantinedData('csv',encode('a;b\n'+ 'x'.repeat(16385)+';1'),';')).toThrow('csv_shape');
});

