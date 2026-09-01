import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseNFeXml, type ParsedNFe } from '@/lib/documentParsers';
import { calculateNfeAccessKeyCheckDigit, isValidNfeAccessKey } from '@/lib/fiscalDocuments/nfeAccessKey';
import { getChangedOrtFields, mapOrtItems, toOrtAuditPayload } from '@/lib/ingestion/ortUtils';
import { buildValidationIndexes, validateNFe } from '@/lib/ingestionValidator';
import { parseFiscalXml } from '@/lib/nfeXmlParser';
import type { Client } from '@/hooks/useClients';
import type { FiscalDocument } from '@/hooks/useFiscalDocuments';
import type { OrtReviewDocument } from '@/lib/ingestion/types';

const firstFortyThree = '3526081234567800019055001000000123112345678';
const accessKey = `${firstFortyThree}${calculateNfeAccessKeyCheckDigit(firstFortyThree)}`;
const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${accessKey}">
  <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-08-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000190</CNPJ><xNome>EMITENTE TESTE</xNome></emit>
  <dest><CNPJ>11222333000181</CNPJ><xNome>DESTINATARIO TESTE</xNome><enderDest><xLgr>RUA DESTINO</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3509502</cMun><xMun>CAMPINAS</xMun><UF>SP</UF><CEP>13010000</CEP></enderDest></dest>
  <det nItem="1"><prod><xProd>PRODUTO TESTE</xProd><qCom>10.0000</qCom><uCom>UN</uCom><vUnCom>123.456</vUnCom><vProd>1234.56</vProd><NCM>12345678</NCM><CFOP>5102</CFOP></prod></det>
  <total><ICMSTot><vProd>1234.56</vProd><vNF>1234.56</vNF></ICMSTot></total>
  <transp><vol><qVol>2</qVol><pesoB>12.500</pesoB></vol><vol><qVol>3</qVol><pesoB>7.250</pesoB></vol></transp>
  <cobr><dup><nDup>001</nDup><dVenc>2026-08-31</dVenc><vDup>617.28</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`;

const prefixed = (source: string, prefix: string) => source
  .replace('xmlns=', `xmlns:${prefix}=`)
  .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, `<$1${prefix}:$2`);

const base = parseNFeXml(xml);
const client = {
  id: 'correct-client',
  tax_id: base.recipientCnpj,
  company_name: base.recipientName,
  address_city: base.recipientCity,
} as unknown as Client;

function validate(source: ParsedNFe, existing: FiscalDocument[] = [], clients: Client[] = [client]) {
  return validateNFe(source, 'synthetic.xml', existing, clients);
}

describe('ingestion safety regressions', () => {
  it('preserva decimais XML no financeiro, inclusive parcelas e NFS-e', async () => {
    const parsed = await parseFiscalXml({ text: async () => xml } as File);
    expect(parsed.amount).toBe(1234.56);
    expect(parsed.installments[0]?.amount).toBe(617.28);

    const nfse = '<Nfse><InfNfse><Numero>123</Numero><Servico><Valores><ValorServicos>1234.56</ValorServicos></Valores></Servico></InfNfse></Nfse>';
    expect((await parseFiscalXml({ text: async () => nfse } as File)).amount).toBe(1234.56);
  });

  it.each(['nfe', 'ns1'])('lê namespace %s sem misturar partes fiscais', async (prefix) => {
    const source = prefixed(xml, prefix);
    const parsed = parseNFeXml(source);
    expect(parsed.emitterName).toBe('EMITENTE TESTE');
    expect(parsed.recipientName).toBe('DESTINATARIO TESTE');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.unitPrice).toBe(123.456);
    expect(parsed.totalWeight).toBe(19.75);
    expect((await parseFiscalXml({ text: async () => source } as File)).kind).toBe('nfe');
  });

  it('não usa o emitente como fallback quando falta destinatário', () => {
    const parsed = parseNFeXml(xml.replace(/<dest>[\s\S]*?<\/dest>/, ''));
    expect(parsed.recipientName).toBe('');
    expect(parsed.recipientCnpj).toBe('');
    expect(validate(parsed).hasErrors).toBe(true);
  });

  it('não reaproveita nota de outro emitente apenas pelo número', () => {
    const otherFirstFortyThree = '3526089988877700016655001000000123112345678';
    const otherKey = `${otherFirstFortyThree}${calculateNfeAccessKeyCheckDigit(otherFirstFortyThree)}`;
    const existing = {
      id: 'other-invoice', access_key: otherKey, invoice_number: '123', invoice_series: '1',
      fiscal_model: '55', remitter_cnpj: '99888777000166', load_id: null, status: 'confirmed',
    } as unknown as FiscalDocument;

    const result = validate(base, [existing]);
    expect(result.isDuplicate).toBe(false);
    expect(result.isOrphanReusable).toBe(false);
    expect(result.existingDocumentId).toBeNull();
  });

  it('mantém a correspondência exata por CNPJ acima de nome e cidade', () => {
    const wrong = { ...client, id: 'wrong-client', tax_id: '99888777000166' };
    expect(validate(base, [], [client, wrong]).matchedClientId).toBe(client.id);
  });

  it('bloqueia conflito entre a chave e número/modelo/série/emitente', () => {
    expect(isValidNfeAccessKey(accessKey)).toBe(true);
    for (const source of [
      { ...base, invoiceNumber: '999' },
      { ...base, series: '2' },
      { ...base, model: '57' },
      { ...base, emitterCnpj: '99888777000166' },
    ]) {
      expect(validate(source).validations).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'accessKeyIdentity', severity: 'error' }),
      ]));
    }
  });

  it('detecta uma duplicata antes de salvar o mesmo lote', () => {
    const indexes = buildValidationIndexes([], [client]);
    const first = validateNFe(base, 'first.xml', [], [client], indexes);
    const second = validateNFe(base, 'second.xml', [], [client], indexes);
    expect(first.hasErrors).toBe(false);
    expect(second.hasErrors).toBe(true);
    expect(second.isDuplicate).toBe(true);
    expect(second.validations).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('duplicada neste lote') }),
    ]));
  });

  it('trata identidades UNKNOWN de scan como ausentes e bloqueantes', () => {
    const result = validate({
      ...base,
      sourceKind: 'scan_nfe',
      emitterName: 'UNKNOWN',
      emitterCnpj: 'UNKNOWN',
      recipientName: 'UNKNOWN',
      recipientCnpj: 'UNKNOWN',
    }, [], []);
    expect(result.hasErrors).toBe(true);
    expect(result.validations).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'emitter', severity: 'error' }),
      expect.objectContaining({ field: 'recipient', severity: 'error' }),
    ]));
  });

  it('calcula o unitário ORT a partir do total e da quantidade sem inventar equivalência', () => {
    const ort = { items: [{ description: 'PRODUTO', quantity: 10, unit: 'UN', totalPrice: 100 }] } as OrtReviewDocument;
    expect(mapOrtItems(ort)[0]).toMatchObject({ quantity: 10, unitPrice: 10, totalPrice: 100 });
  });

  it('audita alterações dentro da lista de itens ORT', () => {
    const before = { items: [{ description: 'PRODUTO', quantity: 1 }], fileName: 'scan.pdf' } as OrtReviewDocument;
    const after = {
      ...before,
      extractedPayload: toOrtAuditPayload(before),
      items: [{ description: 'PRODUTO', quantity: 2 }],
    } as OrtReviewDocument;
    expect(getChangedOrtFields(after)).toContain('items');
  });

  it('exige error e contagem confirmada da RPC antes da mensagem de sucesso', () => {
    const source = readFileSync('src/pages/Ingestion.tsx', 'utf8');
    const savedBranch = source.slice(source.indexOf('// Já salvo no upload'), source.indexOf('// Auto-vincula/cria cliente'));
    expect(savedBranch).toContain('error: assignmentError');
    expect(savedBranch).toContain('if (assignmentError)');
    expect(savedBranch).toContain("getJsonNumber(assignmentResult, 'updated')");
    expect(savedBranch.indexOf('if (assignmentError)')).toBeLessThan(savedBranch.indexOf('results.push'));
  });
});
