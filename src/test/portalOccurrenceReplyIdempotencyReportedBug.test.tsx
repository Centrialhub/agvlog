import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OccurrenceThreadDialog } from '@/pages/portal/PortalOccurrences';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toast: vi.fn() }));

vi.mock('@/hooks/portal/usePortalOccurrenceMessages', () => ({
  usePortalOccurrenceMessages: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    hasOlder: false,
    loadOlder: vi.fn(),
    isLoadingOlder: false,
    olderError: null,
  }),
  useReplyPortalOccurrence: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

describe('resposta idempotente à ocorrência do portal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reutiliza o request_id quando a confirmação falha e o texto não muda', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('message-1');
    render(<OccurrenceThreadDialog occurrenceId="occurrence-a" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Escreva uma mensagem...'), {
      target: { value: 'Preciso de uma atualização desta ocorrência.' },
    });
    const send = screen.getByRole('button', { name: 'Enviar mensagem' });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    fireEvent.click(send);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));

    const first = mocks.mutateAsync.mock.calls[0][0];
    const second = mocks.mutateAsync.mock.calls[1][0];
    expect(first.request_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second.request_id).toBe(first.request_id);
  });
});
