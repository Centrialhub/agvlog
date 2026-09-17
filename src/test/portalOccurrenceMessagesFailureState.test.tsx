import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OccurrenceThreadDialog } from '@/pages/portal/PortalOccurrences';

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), mutateAsync: vi.fn() }));

vi.mock('@/hooks/portal/usePortalOccurrenceMessages', () => ({
  usePortalOccurrenceMessages: () => ({
    data: undefined,
    isLoading: false,
    error: new Error('ambiguous id'),
    refetch: mocks.refetch,
  }),
  useReplyPortalOccurrence: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe('portal occurrence conversation failure state', () => {
  it('does not present a failed message read as an empty conversation', () => {
    render(<OccurrenceThreadDialog occurrenceId="occurrence-a" onClose={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a conversa');
    expect(screen.queryByText(/Nenhuma mensagem ainda/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('Escreva uma mensagem...'), {
      target: { value: 'Não deve enviar sem confirmar o histórico' },
    });
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('disabled'))).toHaveLength(1);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
