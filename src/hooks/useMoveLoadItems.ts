import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { compositionMutationError, invalidateCompositionQueries, isConfirmedItemMove,
  type ConfirmedItemMove, type MoveLoadItemsRequest } from '@/lib/loads/compositionMutation';

export function useMoveLoadItems() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const client = useQueryClient();
  const tenantId = currentTenant?.id;
  const actorId = user?.id;
  const context = useRef({ tenantId, actorId });
  context.current = { tenantId, actorId };
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);

  const moveItems = useCallback(async (input: MoveLoadItemsRequest): Promise<ConfirmedItemMove> => {
    if (!tenantId || !actorId) throw new Error('Selecione a empresa e entre com uma sessão válida.');
    if (busy.current) throw new Error('Aguarde a confirmação da realocação em andamento.');
    const request = { ...input, items: input.items.map(item => ({ ...item })) };
    if (!request.sourceLoadId || !request.targetLoadId || request.sourceLoadId === request.targetLoadId
      || !request.items.length || request.items.some(item => !item.id)
      || new Set(request.items.map(item => item.id)).size !== request.items.length) {
      throw new Error('Selecione cargas distintas e itens válidos da origem.');
    }
    const assertContext = () => {
      if (context.current.tenantId !== tenantId || context.current.actorId !== actorId)
        throw compositionMutationError({ code: 'CONTEXT_CHANGED' });
    };
    assertContext();
    busy.current = true; setPending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let confirmed: ConfirmedItemMove;
    try {
      const { data, error } = await supabase.rpc('move_load_items_between_loads', {
        _tenant_id: tenantId, _source_load_id: request.sourceLoadId,
        _target_load_id: request.targetLoadId, _item_ids: request.items.map(item => item.id),
      }).abortSignal(controller.signal);
      assertContext();
      if (error) throw error;
      if (!isConfirmedItemMove(data, request)) throw new Error('Unconfirmed composition response');
      confirmed = data;
    } catch (error) {
      assertContext();
      throw compositionMutationError(error);
    } finally {
      clearTimeout(timer);
      // No automatic retries, extra deletes, metadata writes or direct-table fallback.
      await invalidateCompositionQueries(client);
      busy.current = false; setPending(false);
    }
    assertContext();
    return confirmed;
  }, [tenantId, actorId, client]);

  return { moveItems, isPending };
}
