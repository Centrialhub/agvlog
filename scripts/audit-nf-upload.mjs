// Read-only behavioral audit: synthetic fixtures, no network or database writes.
// Run with: node scripts/audit-nf-upload.mjs
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'package.json'));
const compiled = buildSync({
  stdin: {
    contents: [
      "export * from './src/lib/documentParsers.ts';",
      "export * from './src/lib/nfeXmlParser.ts';",
      "export * from './src/lib/ingestionValidator.ts';",
      "export * from './src/lib/fiscalDocuments/nfeAccessKey.ts';",
      "export * from './src/lib/ingestion/ortUtils.ts';",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  alias: { '@': resolve(root, 'src') },
});
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
const api = module.exports;
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const first43 = '3526081234567800019055001000000123112345678';
const key = first43 + api.calculateNfeAccessKeyCheckDigit(first43);
const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}">
  <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-08-01T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000190</CNPJ><xNome>EMITENTE TESTE</xNome><enderEmit><xLgr>RUA EMITENTE</xLgr><nro>99</nro><xBairro>ORIGEM</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01001000</CEP></enderEmit></emit>
  <dest><CNPJ>11222333000181</CNPJ><xNome>DESTINATARIO TESTE</xNome><enderDest><xLgr>RUA DESTINO</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3509502</cMun><xMun>CAMPINAS</xMun><UF>SP</UF><CEP>13010000</CEP></enderDest></dest>
  <det nItem="1"><prod><xProd>PRODUTO TESTE</xProd><qCom>10.0000</qCom><uCom>UN</uCom><vUnCom>123.456</vUnCom><vProd>1234.56</vProd><NCM>12345678</NCM><CFOP>5102</CFOP></prod></det>
  <total><ICMSTot><vProd>1234.56</vProd><vNF>1234.56</vNF></ICMSTot></total>
  <transp><vol><qVol>2</qVol><pesoB>12.500</pesoB></vol><vol><qVol>3</qVol><pesoB>7.250</pesoB></vol></transp>
  <cobr><dup><nDup>001</nDup><dVenc>2026-08-31</dVenc><vDup>617.28</vDup></dup><dup><nDup>002</nDup><dVenc>2026-09-30</dVenc><vDup>617.28</vDup></dup></cobr>
  <infAdic><infCpl>Carga: 98765</infCpl></infAdic>
</infNFe></NFe></nfeProc>`;
const prefix = (source, name) => source.replace('xmlns=', `xmlns:${name}=`).replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, `<$1${name}:$2`);
const file = (source) => ({ text: async () => source });
const base = api.parseNFeXml(xml);
const client = { id: 'correct-client', tax_id: base.recipientCnpj, company_name: base.recipientName, address_city: base.recipientCity };
const validate = (source, existing = [], clients = [client]) => api.validateNFe(source, 'synthetic.xml', existing, clients);
const checks = [];
async function check(id, description, run) {
  try { await run(); checks.push({ id, description, passed: true }); }
  catch (error) { checks.push({ id, description, passed: false, detail: error.message }); }
}
await check('XML-BASE', 'XML padrão preserva destinatário, item, decimais, peso e volumes', () => {
  assert.equal(base.recipientName, 'DESTINATARIO TESTE');
  assert.equal(base.totalValue, 1234.56);
  assert.equal(base.totalWeight, 19.75);
  assert.equal(base.totalVolume, 5);
  assert.equal(base.items.length, 1);
  assert.equal(base.items[0].quantity, 10);
  assert.equal(base.items[0].unitPrice, 123.456);
  assert.equal(base.installmentCount, 2);
  assert.equal(validate(base).hasErrors, false);
});
await check('XML-MALFORMED', 'XML malformado é rejeitado', () => assert.throws(() => api.parseNFeXml('<NFe><infNFe></NFe>')));
await check('KEY-DV', 'Dígito verificador incorreto bloqueia a nota', () => {
  const invalid = { ...base, accessKey: key.slice(0, 43) + ((Number(key[43]) + 1) % 10) };
  assert.equal(validate(invalid).hasErrors, true);
});
await check('FIN-DECIMAL', 'Financeiro preserva o ponto decimal de vNF', async () => {
  assert.equal((await api.parseFiscalXml(file(xml))).amount, 1234.56);
});
await check('FIN-INSTALLMENT', 'Financeiro preserva o ponto decimal de vDup', async () => {
  assert.equal((await api.parseFiscalXml(file(xml))).installments[0].amount, 617.28);
});
await check('XML-PREFIX-RECIPIENT', 'Prefixo nfe mantém destinatário separado do emitente', () => {
  assert.equal(api.parseNFeXml(prefix(xml, 'nfe')).recipientName, base.recipientName);
});
await check('XML-PREFIX-ITEMS', 'Prefixo nfe preserva itens e peso', () => {
  const parsed = api.parseNFeXml(prefix(xml, 'nfe'));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.totalWeight, 19.75);
});
await check('XML-ARBITRARY-PREFIX', 'Namespace equivalente com prefixo ns1 é aceito', () => {
  assert.equal(api.parseNFeXml(prefix(xml, 'ns1')).recipientName, base.recipientName);
});
await check('FIN-PREFIX', 'Financeiro reconhece NF-e com namespace prefixado', async () => {
  assert.equal((await api.parseFiscalXml(file(prefix(xml, 'nfe')))).kind, 'nfe');
});
await check('XML-MISSING-DEST', 'Ausência do destinatário não copia o emitente e bloqueia importação', () => {
  const parsed = api.parseNFeXml(xml.replace(/<dest>[\s\S]*?<\/dest>/, ''));
  assert.equal(validate(parsed).hasErrors, true, `hasErrors=false; recipientName=${parsed.recipientName}`);
});
await check('IDENTITY-OTHER-ISSUER', 'Mesmo número com chave e emitente distintos não reaproveita nota alheia', () => {
  const otherFirst43 = '3526089988877700016655001000000123112345678';
  const otherKey = otherFirst43 + api.calculateNfeAccessKeyCheckDigit(otherFirst43);
  assert.equal(api.isValidNfeAccessKey(otherKey), true);
  const existing = { id: 'other-invoice', access_key: otherKey, invoice_number: '123', invoice_series: '1', fiscal_model: '55', remitter_cnpj: '99888777000166', load_id: null, status: 'confirmed' };
  const result = validate(base, [existing]);
  assert.equal(result.isOrphanReusable, false, `reused=${result.existingDocumentId}; isDuplicate=${result.isDuplicate}`);
});
await check('CLIENT-CNPJ-PRIORITY', 'Nome e cidade não substituem correspondência exata por CNPJ', () => {
  const sameNameOtherTaxId = { ...client, id: 'wrong-client', tax_id: '99888777000166' };
  assert.equal(validate(base, [], [client, sameNameOtherTaxId]).matchedClientId, client.id);
});
await check('KEY-IDENTITY', 'Número divergente da chave de acesso bloqueia importação', () => {
  assert.equal(validate({ ...base, invoiceNumber: '999' }).hasErrors, true);
});
await check('KEY-ZERO', 'Chave com 44 zeros é rejeitada', () => assert.equal(api.isValidNfeAccessKey('0'.repeat(44)), false));
await check('XML-BATCH-DUPLICATE', 'Validação do lote detecta duas ocorrências da mesma NF antes de salvar', () => {
  const indexes = api.buildValidationIndexes([], [client]);
  const results = [base, base].map(item => api.validateNFe(item, 'same.xml', [], [client], indexes));
  assert.equal(results.filter(item => !item.hasErrors && !item.isDuplicate).length, 1);
});
await check('SCAN-UNIT-VALUE', 'Total do item não é copiado como preço unitário quando quantidade é 10', () => {
  const item = api.mapOrtItems({ items: [{ description: 'PRODUTO TESTE', quantity: 10, unit: 'UN', totalPrice: 100 }] })[0];
  assert.notEqual(item.unitPrice, 100, `quantity=${item.quantity}; unitPrice=${item.unitPrice}; totalPrice=${item.totalPrice}`);
});
await check('SCAN-AUDIT-ITEM', 'Alteração na quantidade aparece nos campos alterados da auditoria', () => {
  const before = { items: [{ description: 'PRODUTO TESTE', quantity: 1 }], fileName: 'synthetic.pdf' };
  const after = { ...before, extractedPayload: api.toOrtAuditPayload(before), items: [{ description: 'PRODUTO TESTE', quantity: 2 }] };
  assert.ok(api.getChangedOrtFields(after).includes('items'));
});
await check('FIN-NFSE-DECIMAL', 'Financeiro preserva o ponto decimal de ValorServicos da NFS-e', async () => {
  const nfse = '<Nfse><InfNfse><Numero>123</Numero><Servico><Valores><ValorServicos>1234.56</ValorServicos></Valores></Servico></InfNfse></Nfse>';
  assert.equal((await api.parseFiscalXml(file(nfse))).amount, 1234.56);
});
await check('SCAN-UNKNOWN-IDENTITY', 'Destinatário e CNPJ UNKNOWN não passam pela validação fiscal', () => {
  const result = validate({ ...base, sourceKind: 'scan_nfe', recipientName: 'UNKNOWN', recipientCnpj: 'UNKNOWN' }, [], []);
  assert.equal(result.hasErrors, true);
});
dom.window.close();
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(), synthetic: true, networkRequests: 0, databaseWrites: 0,
  passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, checks,
}, null, 2));
process.exitCode = checks.some(c => !c.passed) ? 1 : 0;
