export interface SelectableEmitter {
  id: string;
  active: boolean;
  is_default: boolean;
}

export function selectDefaultActiveEmitter<T extends SelectableEmitter>(
  emitters: readonly T[],
): T | null {
  return emitters.find(emitter => emitter.active && emitter.is_default) ?? null;
}

export function selectActiveEmitterById<T extends SelectableEmitter>(
  emitters: readonly T[],
  emitterId?: string | null,
): T | null {
  if (emitterId) return emitters.find(emitter => emitter.active && emitter.id === emitterId) ?? null;
  return selectDefaultActiveEmitter(emitters);
}
