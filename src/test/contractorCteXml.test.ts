import { describe, expect, it } from 'vitest';
import { calculateNfeAccessKeyCheckDigit } from '@/lib/fiscalDocuments/nfeAccessKey';
import { contractorCteSchema, cteIdentityFromKey, parseContractorCteXml } from '@/lib/ingestion/contractorCte';

const cnpj = '12345678000195';
const base = `312611${cnpj}57001000000123100000001`;
const key = base + calculateNfeAccessKeyCheckDigit(base);
const fixture = (prefix = '') => {
  const xml = `<cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe${key}" versao="4.00">
    <ide><mod>57</mod><tpAmb>1</tpAmb><nCT>123</nCT><serie>1</serie><dhEmi>2026-11-03T10:00:00-03:00</dhEmi>
    <cMunIni>3143302</cMunIni><cMunFim>3550308</cMunFim></ide>
    <emit><CNPJ>${cnpj}</CNPJ><IE>123456789</IE><xNome>Transportadora sintética</xNome><enderEmit>
    <xLgr>Rua QA</xLgr><nro>1</nro><xBairro>Centro</xBairro><xMun>Montes Claros</xMun><cMun>3143302</cMun><UF>MG</UF><CEP>39400000</CEP>
    </enderEmit></emit><infCTeNorm><infDoc/></infCTeNorm></infCte></CTe>
    <protCTe><infProt><tpAmb>1</tpAmb><chCTe>${key}</chCTe><nProt>123456789012345</nProt><cStat>100</cStat></infProt></protCTe></cteProc>`;
  return prefix ? xml.replace('xmlns=', `xmlns:${prefix}=`).replace(/<(\/?)(\w+)(?=[\s/>])/g, `<$1${prefix}:$2`) : xml;
};

describe('contractor CT-e XML ingestion', () => {
  it.each(['', 'fiscal'])('reads a processed original with namespace prefix %s', prefix => {
    expect(parseContractorCteXml(fixture(prefix))).toMatchObject({ access_key: key, issuer_cnpj: cnpj,
      number: '123', series: '1', environment: 'production', source_format: 'xml', authorization_declared: true });
  });
  it('derives identity from the access key and rejects NF-e or a bad check digit', () => {
    expect(cteIdentityFromKey(key)).toEqual({ access_key: key, issuer_cnpj: cnpj, number: '123', series: '1' });
    expect(() => cteIdentityFromKey(key.slice(0, -1) + (key.endsWith('0') ? '1' : '0'))).toThrow();
    expect(() => cteIdentityFromKey(key.slice(0, 20) + '55' + key.slice(22))).toThrow();
  });
  it.each([
    (xml: string) => '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///untrusted">]>' + xml,
    () => '<CTe>',
    (xml: string) => xml.replace('<mod>57</mod>', '<mod>67</mod>'),
    (xml: string) => xml.replace('<cStat>100</cStat>', '<cStat>101</cStat>'),
    (xml: string) => xml.replace('<chCTe>', '<chCTe>9'),
    (xml: string) => xml.replace('<CNPJ>', '<CNPJ xmlns="urn:foreign">'),
    (xml: string) => xml.replace('</CNPJ>', `</CNPJ><CNPJ>${cnpj}</CNPJ>`),
    (xml: string) => xml.replace(`<CNPJ>${cnpj}`, '<CNPJ>99999999000199'),
  ])('rejects malformed, cancelled, conflicting or foreign-namespace identity', mutate => {
    expect(() => parseContractorCteXml(mutate(fixture()))).toThrow();
  });
  it('does not invent authorization for a bare XML or a PDF/DACTE', () => {
    const standalone = fixture().match(/<CTe>.*?<\/CTe>/s)![0].replace('<CTe>', '<CTe xmlns="http://www.portalfiscal.inf.br/cte">');
    expect(parseContractorCteXml(standalone).authorization_declared).toBe(false);
    const data = parseContractorCteXml(fixture());
    expect(contractorCteSchema.safeParse({ ...data, source_format: 'pdf' }).success).toBe(false);
    expect(contractorCteSchema.safeParse({ ...data, source_format: 'pdf', authorization_protocol: null, authorization_declared: false }).success).toBe(true);
  });
});
