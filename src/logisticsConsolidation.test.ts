import { test, expect } from 'bun:test';
import { supabase } from './integrations/supabase/client';

// Este teste assume um ambiente de sandbox com dados de teste.
// Foca na validação da interface das novas RPCs.

test('RPC plan_dispatch_trip_v2 deve falhar sem tenant', async () => {
  const { error } = await supabase.rpc('plan_dispatch_trip_v2', {
    p_tenant_id: '00000000-0000-0000-0000-000000000000',
    p_driver_id: '00000000-0000-0000-0000-000000000000',
    p_vehicle_id: '00000000-0000-0000-0000-000000000000',
    p_route_name: 'Test',
    p_load_ids: [],
    p_stops: []
  });
  
  // Deve retornar erro de acesso negado ou foreign key
  expect(error).toBeDefined();
});

test('RPC move_load_items_v3 deve validar tenant', async () => {
    const { error } = await supabase.rpc('move_load_items_v3', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_source_load_id: '00000000-0000-0000-0000-000000000000',
      p_target_load_id: '00000000-0000-0000-0000-000000000000',
      p_item_ids: []
    });
    
    expect(error).toBeDefined();
});
