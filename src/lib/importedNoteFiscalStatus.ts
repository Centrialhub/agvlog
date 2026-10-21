const normalize = (value?: string | null) => value?.trim().toLowerCase() || '';
const cteAuthorized = new Set(['authorized', 'autorizado']);
const nfseAuthorized = new Set(['issued', 'authorized', 'autorizado']);

export function isAuthorizedImportedCte(document: {
  status?: string | null; sefaz_status?: string | null; cancelled_at?: string | null;
}): boolean {
  const fiscalStatus = normalize(document.sefaz_status);
  return !document.cancelled_at && cteAuthorized.has(normalize(document.status)) &&
    (!fiscalStatus || cteAuthorized.has(fiscalStatus));
}

export function isAuthorizedImportedNfse(document: { status?: string | null }): boolean {
  return nfseAuthorized.has(normalize(document.status));
}

export function hasAuthorizedImportedDocument(row: {
  cte_id?: string | null; cte_status?: string | null;
  nfse_id?: string | null; nfse_status?: string | null;
}): boolean {
  return Boolean((row.cte_id && isAuthorizedImportedCte({ status: row.cte_status })) ||
    (row.nfse_id && isAuthorizedImportedNfse({ status: row.nfse_status })));
}
