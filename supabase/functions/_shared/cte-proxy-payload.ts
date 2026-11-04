const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const onlyDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** Subcontracting always uses the guarded persisted snapshot, never client edits. */
export function resolveCteSubcontractingBody(requested: Record<string, unknown>, row: Record<string, unknown> | null,
  scope: { tenantId: string; emitterId?: string; fiscalDocumentId?: string }): Record<string, unknown> | null {
  const stored = record(row?.cte_payload), service = record(stored.payload).tipoServico;
  if (String(record(requested.payload).tipoServico) !== '1' && String(service) !== '1') return requested;
  const source = record(stored.contractorCteSource);
  if (String(service) !== '1' || !scope.fiscalDocumentId || row?.tenant_id !== scope.tenantId || row?.emitter_id !== scope.emitterId
    || stored.environment !== requested.environment || typeof source.id !== 'string' || !/^[a-f0-9]{64}$/.test(String(source.sha256 ?? ''))) return null;
  return { ...stored, externalId: `agvlog-cte-${scope.fiscalDocumentId}` };
}

/** Preserve legacy origin correction for normal service; subcontracting keeps the original route. */
export function normalizeCteEmissionBody(source: Record<string, unknown>): Record<string, unknown> {
  const body = structuredClone(source) as Record<string, any>;
  const inner = (body.payload && typeof body.payload === 'object' ? body.payload : body) as Record<string, any>;
  const emitterAddress = inner.emitente?.endereco;
  const destinationAddress = inner.recebedor?.endereco || inner.destinatario?.endereco;
  const location = (address: Record<string, unknown> | undefined) => {
    if (!address) return undefined;
    const city = address.municipio || address.cidade;
    const state = String(address.uf || address.estado || '').toUpperCase() || undefined;
    const cityCode = onlyDigits(address.codigoMunicipio || address.codigoCidade || address.cMun) || undefined;
    if (!city && !state && !cityCode) return undefined;
    return { codigoCidade: cityCode, cMun: cityCode, municipio: city, cidade: city, uf: state, estado: state };
  };
  if (String(inner.tipoServico ?? '0') !== '1') {
    const inicio = location(emitterAddress), fim = location(destinationAddress);
    if (inicio) inner.inicio = inicio;
    if (fim) inner.fim = fim;
  }
  const ufIni = String(inner.inicio?.uf || '').toUpperCase(), ufFim = String(inner.fim?.uf || '').toUpperCase();
  const prefix = ufIni && ufFim && ufIni !== ufFim ? '6' : '5';
  const rawCfop = onlyDigits(inner.CFOP || inner.cfop || inner.ide?.CFOP);
  const validTransportCfop = /^[56](3(5[1-9]|60)|932)$/.test(rawCfop);
  const normalizedCfop = validTransportCfop ? `${prefix}${rawCfop.slice(1)}` : `${prefix}353`;
  inner.CFOP = normalizedCfop;
  inner.cfop = normalizedCfop;
  inner.ide = { ...(inner.ide || {}), CFOP: normalizedCfop };
  console.log('[hub-fiscal-proxy] CT-e normalized before upstream emission', { ufIni, ufFim, receivedCfop: rawCfop || null, sentCfop: normalizedCfop });
  return body;
}
