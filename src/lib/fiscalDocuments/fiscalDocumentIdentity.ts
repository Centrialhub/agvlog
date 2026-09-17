interface FiscalDocumentIdentityInput {
  access_key?: string | null;
  invoice_number?: string | null;
  issue_date?: string | null;
  client_id?: string | null;
  remitter?: string | null;
  recipient?: string | null;
}

const text = (value: string | null | undefined) => String(value || '').trim();

export function assertFiscalDocumentIdentity(input: FiscalDocumentIdentityInput) {
  const accessKey = text(input.access_key).replace(/\D/g, '');
  if (text(input.access_key) && accessKey.length !== 44) {
    throw new Error('A chave de acesso deve conter exatamente 44 dígitos.');
  }
  if (accessKey.length === 44) return;

  const hasParty = Boolean(text(input.client_id) || text(input.remitter) || text(input.recipient));
  if (!text(input.invoice_number) || !text(input.issue_date) || !hasParty) {
    throw new Error('Informe uma chave de acesso válida ou número, data de emissão e cliente/remetente/destinatário.');
  }
}
