export type TripCargoLoadDraft = {
  load_id: string;
  volume_count: string;
  pallet_count: string;
  weight_kg: string;
};

export type ParsedTripCargoLoad = {
  load_id: string;
  volume_count: number;
  pallet_count: number;
  weight_kg: number;
};

function decimal(value: string, label: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} deve ser preenchido com um valor não negativo e no máximo duas casas decimais.`);
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label} inválido.`);
  return parsed;
}

export function parseTripCargoLoadDrafts(drafts: TripCargoLoadDraft[], expectedLoadIds: string[]): ParsedTripCargoLoad[] {
  const expected = new Set(expectedLoadIds);
  if (drafts.length !== expected.size || new Set(drafts.map(row => row.load_id)).size !== drafts.length
    || drafts.some(row => !expected.has(row.load_id))) {
    throw new Error('As cargas da conferência mudaram. Atualize o dossiê antes de confirmar.');
  }
  return drafts.map(row => {
    const palletText = row.pallet_count.trim();
    if (!/^\d+$/.test(palletText)) throw new Error('Pallets deve ser preenchido com um número inteiro não negativo.');
    const palletCount = Number(palletText);
    if (!Number.isSafeInteger(palletCount)) throw new Error('Quantidade de pallets inválida.');
    return {
      load_id: row.load_id,
      volume_count: decimal(row.volume_count, 'Volumes'),
      pallet_count: palletCount,
      weight_kg: decimal(row.weight_kg, 'Peso'),
    };
  });
}

export function requireExactCargoDocuments(selectedIds: string[], expectedIds: string[]) {
  const selected = new Set(selectedIds);
  if (selected.size !== expectedIds.length || expectedIds.some(id => !selected.has(id))) {
    throw new Error('Confirme todos os documentos e referências antes de liberar a carga.');
  }
}
