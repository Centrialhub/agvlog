const ISSUED_STATUSES = ['issued', 'authorized'];

export const canCancelNFSeStatus = (status: string) => ISSUED_STATUSES.includes(status);
export const canRecoverNFSeStatus = (status: string) => ['error', 'submitted', 'processing'].includes(status);
export const validateNFSeDateRange = (from: string, to: string) =>
  from && to && from > to ? 'A emissão inicial não pode ser posterior à emissão final.' : null;
export const isExactNFSeSelection = (checked: Set<string>, ids: string[]) =>
  ids.length > 0 && checked.size === ids.length && ids.every(id => checked.has(id));
export const reconcileNFSeSelection = (checked: Set<string>, ids: string[]) => {
  const available = new Set(ids);
  return new Set([...checked].filter(id => available.has(id)));
};
