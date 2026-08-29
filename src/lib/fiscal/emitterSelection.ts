export interface SelectableEmitter {
  id: string;
  active: boolean;
  is_default: boolean;
}

export function selectDefaultActiveEmitter<T extends SelectableEmitter>(
  emitters: readonly T[],
): T | null {
  return emitters.find(emitter => emitter.active && emitter.is_default)
    ?? emitters.find(emitter => emitter.active)
    ?? null;
}

export function selectActiveEmitterById<T extends SelectableEmitter>(
  emitters: readonly T[],
  emitterId?: string | null,
): T | null {
  return emitters.find(emitter => emitter.active && emitter.id === emitterId)
    ?? selectDefaultActiveEmitter(emitters);
}
