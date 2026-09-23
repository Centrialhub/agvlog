import { describe, expect, it } from 'vitest';
import {
  mergePortalOccurrenceMessages,
  type PortalOccurrenceMessage,
} from '@/hooks/portal/usePortalOccurrenceMessages';

function message(id: number): PortalOccurrenceMessage {
  return {
    id: id.toString().padStart(3, '0'),
    author_role: 'client',
    author_name: 'Cliente',
    message: `Mensagem ${id}`,
    created_at: new Date(Date.UTC(2026, 8, 21, 0, id)).toISOString(),
  };
}

describe('janela móvel da conversa do portal', () => {
  it('preserva mensagens deslocadas pelo polling e deduplica a sobreposição', () => {
    const firstWindow = Array.from({ length: 100 }, (_, index) => message(index + 1));
    const refreshedWindow = Array.from({ length: 100 }, (_, index) => message(index + 6));
    const merged = mergePortalOccurrenceMessages(firstWindow, refreshedWindow);

    expect(merged).toHaveLength(105);
    expect(merged.map((item) => item.id)).toEqual(
      Array.from({ length: 105 }, (_, index) => (index + 1).toString().padStart(3, '0')),
    );
  });
});
