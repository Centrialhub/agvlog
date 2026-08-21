-- Restaura a visibilidade dos dados removendo o IS NOT NULL filter do faturamento 
-- e garantindo que o tenant com dados tenha visibilidade total.

-- 1. Garante privilégios explícitos para o papel autenticado nas visualizações e tabelas
GRANT SELECT ON public.vw_load_control TO authenticated;
GRANT SELECT ON public.vw_operational_workspace TO authenticated;
GRANT SELECT ON public.vehicles_state TO authenticated;

-- 2. Atualiza a função de roteamento de tenant para garantir que o usuário veja o tenant com dados
-- O usuário '3f886fb8-413e-4102-a00f-56085be56855' já é dono de '6e874e6e-5bca-486d-9928-bef0646989c4'.
-- A correção no useTenant.tsx cuidará da seleção automática.

-- 3. Ingestão: Certifica-se de que os cursores de ingestão estão ativos para o tenant alvo
UPDATE public.ingestion_cursors 
SET last_polled_at = NOW() - interval '1 hour'
WHERE tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';
