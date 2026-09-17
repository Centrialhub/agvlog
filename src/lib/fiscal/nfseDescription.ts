function withoutAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function buildIndividualNFSeDescription(
  invoiceNumber: string | null | undefined,
  accessKey: string | null | undefined,
): string {
  const reference = String(invoiceNumber || '').trim() || String(accessKey || '').slice(-9) || 'nao informada';
  return withoutAccents(`Prestacao de servico de transporte referente a NF ${reference}`);
}
