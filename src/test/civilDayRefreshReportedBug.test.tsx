import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCivilDay } from '@/hooks/useCivilDay';

afterEach(() => vi.useRealTimers());

describe('relógio civil de telas persistentes', () => {
  it('muda a chave ao cruzar a meia-noite do fuso informado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T02:59:50.000Z'));
    const { result } = renderHook(() => useCivilDay('America/Sao_Paulo'));
    expect(result.current).toBe('2026-09-21');

    act(() => { vi.advanceTimersByTime(30_000); });

    expect(result.current).toBe('2026-09-22');
  });
});
