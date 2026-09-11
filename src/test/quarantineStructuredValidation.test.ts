// @vitest-environment node
import {expect,it} from 'vitest';
import {validateQuarantinedData} from '../../supabase/functions/secure-upload/quarantine-validation';
import {ofxFile} from './helpers/financeOfxFixture';
const encode=(value:string)=>new TextEncoder().encode(value);
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
it.each(['pdf','xlsx','xls','jpeg','png','html'])('keeps %s quarantined until a supported sanitizer exists',format=>{
 expect(validateQuarantinedData(format,encode('synthetic'))).toMatchObject({state:'quarantined'});
});
it('enforces original and cell limits',()=>{
 expect(()=>validateQuarantinedData('csv',new Uint8Array(10*1024*1024+1),';')).toThrow('size_limit');
 expect(()=>validateQuarantinedData('csv',encode('a;b\n'+ 'x'.repeat(16385)+';1'),';')).toThrow('csv_shape');
});

