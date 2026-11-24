import { describe, expect, it } from 'vitest';
import { invoiceProductSource } from '@/lib/ingestion/invoiceProducts';
import { parseNFeXml } from '@/lib/documentParsers';

describe('invoice product source', () => {
  it('retains each original XML product code and quantity before persistence', () => {
    const parsed=parseNFeXml('<nfeProc><NFe><infNFe><ide><nNF>123</nNF></ide><det nItem="1"><prod><cProd>SAB</cProd><xProd>Sabonete</xProd><qCom>12</qCom><uCom>CX</uCom><vUnCom>10</vUnCom><vProd>120</vProd></prod></det><det nItem="2"><prod><cProd>DES</cProd><xProd>Desodorante</xProd><qCom>2.5</qCom><uCom>UN</uCom><vUnCom>20</vUnCom><vProd>50</vProd></prod></det></infNFe></NFe></nfeProc>');
    expect(invoiceProductSource(parsed.items)?.items.map(item=>[item.code,item.quantity,item.unit])).toEqual([['SAB',12,'CX'],['DES',2.5,'UN']]);
  });
  it('keeps separate products, source codes, fractional quantities and units', () => {
    const source = invoiceProductSource([
      {code:'A',description:'Sabonete',quantity:12,unit:'CX',unitPrice:10,totalPrice:120,ncm:'',cfop:''},
      {code:'B',description:'Desodorante',quantity:2.5,unit:'UN',unitPrice:20,totalPrice:50,ncm:'',cfop:''},
    ]);
    expect(source?.items).toEqual([
      {line:1,code:'A',description:'Sabonete',quantity:12,unit:'CX',total:120},
      {line:2,code:'B',description:'Desodorante',quantity:2.5,unit:'UN',total:50},
    ]);
  });
  it('does not invent products for an old summary or accept unknown quantities', () => {
    expect(invoiceProductSource([])).toBeUndefined();
    expect(() => invoiceProductSource([{description:'Resumo sem quantidade',quantity:0,unit:'UN',unitPrice:0,totalPrice:0,ncm:'',cfop:''}])).toThrow('quantidade');
  });
});
