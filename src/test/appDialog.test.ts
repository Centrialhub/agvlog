import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmAction, promptAction, useAlertStore } from '@/hooks/useAlertStore';

function collectSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('accessible application dialogs', () => {
  afterEach(() => useAlertStore.getState().hideAlert());

  it('resolves confirmation from the shared accessible dialog', async () => {
    const result = confirmAction('Continuar?', { title: 'Confirmação' });
    const state = useAlertStore.getState();

    expect(state.isOpen).toBe(true);
    expect(state.title).toBe('Confirmação');
    state.onConfirm?.();

    await expect(result).resolves.toBe(true);
  });

  it('normalizes prompt input and resolves cancellation', async () => {
    const confirmed = promptAction('Informe o motivo');
    useAlertStore.getState().onConfirm?.('  motivo válido  ');
    await expect(confirmed).resolves.toBe('motivo válido');

    const cancelled = promptAction('Informe o motivo');
    useAlertStore.getState().onCancel?.();
    await expect(cancelled).resolves.toBeNull();
  });

  it('does not use blocking browser-native dialogs in application code', () => {
    const applicationSource = collectSources(join(process.cwd(), 'src'))
      .filter((source) => !source.includes("describe('accessible application dialogs'"))
      .join('\n');

    expect(applicationSource).not.toMatch(/window\.(confirm|prompt)\s*\(/);
    expect(applicationSource).not.toMatch(/(?<![\w.])(confirm|prompt)\s*\(/);
  });
});
