import { describe, expect, it, vi } from 'vitest';
import { openSignedDownload } from '@/lib/portal/openSignedDownload';

describe('download assinado do portal', () => {
  it('abre a aba durante o clique e só depois navega para a URL assinada', async () => {
    const replace = vi.fn();
    const popup = { opener: window, location: { replace }, close: vi.fn() } as unknown as Window;
    const open = vi.fn(() => popup);
    const resolve = vi.fn(async () => 'https://storage.example/proof');

    await openSignedDownload(resolve, open);

    expect(open.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0]);
    expect(popup.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith('https://storage.example/proof');
  });

  it('informa bloqueio sem gerar URL e fecha a aba provisória em falha', async () => {
    const resolveBlocked = vi.fn(async () => 'unused');
    await expect(openSignedDownload(resolveBlocked, vi.fn(() => null))).rejects.toThrow('bloqueou a nova aba');
    expect(resolveBlocked).not.toHaveBeenCalled();

    const popup = { opener: window, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    await expect(openSignedDownload(async () => { throw new Error('assinatura falhou'); }, vi.fn(() => popup))).rejects.toThrow('assinatura falhou');
    expect(popup.close).toHaveBeenCalledTimes(1);
  });
});
