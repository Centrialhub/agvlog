export interface BulkFailure {
  label: string;
  message: string;
}

export interface BulkSummary {
  tone: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
}

/** Monta o resumo (sucesso/falha item a item) do download em massa de PDF/XML. */
export function summarizeBulkDownload(
  format: 'pdf' | 'xml',
  ok: number,
  failures: BulkFailure[],
  maxDetail = 5,
): BulkSummary {
  const fmt = format.toUpperCase();
  if (failures.length === 0) {
    return { tone: 'success', title: `${ok} arquivo(s) ${fmt} baixado(s)` };
  }
  const detail = failures
    .slice(0, maxDetail)
    .map((f) => `CT-e ${f.label}: ${f.message}`)
    .join(' | ');
  const extra = failures.length > maxDetail ? ` (+${failures.length - maxDetail} outras falhas)` : '';
  return {
    tone: ok === 0 ? 'error' : 'warning',
    title: `${ok} baixado(s), ${failures.length} falha(s)`,
    description: detail + extra,
  };
}
