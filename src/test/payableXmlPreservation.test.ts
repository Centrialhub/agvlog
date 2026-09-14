// @vitest-environment node
import {SaxesParser} from 'saxes';
import {expect,it} from 'vitest';
import {inspectPayableXml,type PayableXmlReader} from '../../supabase/functions/finance-payable-xml/xml';
import {payableNfeXml} from './helpers/payableNfeFixture';
const inspect=(xml:string)=>inspectPayableXml(new TextEncoder().encode(xml),()=>new SaxesParser({xmlns:true}) as unknown as PayableXmlReader);
it('extracts exact NF-e summary without pretending antivirus or fiscal authorization',()=>{expect(inspect(payableNfeXml)).toMatchObject({kind:'nfe',emitter_name:'EMITENTE TESTE',amount_cents:'123456',signature_verified:false,antivirus_verified:false});});
it.each(['<!DOCTYPE nfeProc [<!ENTITY x SYSTEM "file:///etc/passwd">]>', '<?danger execute?>'])('rejects executable declarations before preserving an original: %s',prefix=>{expect(()=>inspect(prefix+payableNfeXml)).toThrow();});
it('rejects duplicate totals, fractional cents, oversized and malformed XML',()=>{for(const xml of [payableNfeXml.replace('<vNF>1234.56</vNF>','<vNF>1234.56</vNF><vNF>1</vNF>'),payableNfeXml.replace('<vNF>1234.56</vNF>','<vNF>1.005</vNF>'),payableNfeXml.slice(0,-15),' '.repeat(2_000_001)])expect(()=>inspect(xml)).toThrow();});
