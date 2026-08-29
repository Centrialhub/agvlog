import { describe, expect, it } from 'vitest';
import {
  selectActiveEmitterById,
  selectDefaultActiveEmitter,
} from '@/lib/fiscal/emitterSelection';

const emitters = [
  { id: 'inactive-default', active: false, is_default: true },
  { id: 'active-first', active: true, is_default: false },
  { id: 'active-default', active: true, is_default: true },
];

describe('seleção segura de emitente fiscal', () => {
  it('prioriza somente o padrão ativo', () => {
    expect(selectDefaultActiveEmitter(emitters)?.id).toBe('active-default');
  });

  it('não retorna emitente quando todos estão inativos', () => {
    expect(selectDefaultActiveEmitter(emitters.slice(0, 1))).toBeNull();
  });

  it('substitui uma seleção inativa pelo padrão ativo', () => {
    expect(selectActiveEmitterById(emitters, 'inactive-default')?.id).toBe('active-default');
  });
});
