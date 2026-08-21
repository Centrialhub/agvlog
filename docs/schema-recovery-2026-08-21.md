# Schema recovery — 2026-08-21

## Exceção registrada: remoção de mutação de ambiente

**Migration:** `supabase/migrations/20260821095036_01b7019e-af96-47b7-a95e-33302bfd6406.sql`

### Problema

A migration original continha, além dos grants de leitura, uma mutação de
ambiente com identificadores fixos:

- `UPDATE public.ingestion_cursors SET last_polled_at = NOW() - interval '1 hour'
  WHERE tenant_id = '<uuid fixo>'`
- comentários citando um `user_id` específico como dono do tenant

Isso torna o histórico não reutilizável: em qualquer outro ambiente (novo
`supabase db reset`, staging, novo tenant) o UPDATE não corresponde a nenhum
registro e o histórico passa a documentar dados de um ambiente específico.

### Correção aplicada

1. A migration foi reduzida a grants genéricos válidos:
   - `GRANT SELECT ON public.vw_load_control TO authenticated`
   - `GRANT SELECT ON public.vw_operational_workspace TO authenticated`
   - `GRANT SELECT ON public.vehicles_state TO authenticated`
2. O ajuste de cursor foi movido para
   `scripts/ops/restore-ingestion-cursor.sql`, parametrizado por `tenant_id`
   via `psql -v`, sem execução automática e fora do pipeline de migrations.
3. Nenhum dado do banco vinculado foi alterado por esta correção. O efeito
   prático do UPDATE original já havia ocorrido em produção e não precisa ser
   reaplicado; se necessário, use o script de ops.
4. `MANIFEST.sha256` (raiz e `supabase/migrations/`) foi regenerado para
   refletir o novo conteúdo do arquivo.

### Critério de aceite

Nenhuma migration **nova/ativa** contém UUID de usuário ou tenant específico
como mutação de ambiente. Fora de escopo e imutáveis (histórico anterior à
baseline canônica): as migrations `20260310162234`,
`20260416190208`, `20260513203902`, `20260513205409`, `20260603191710`,
`20260603193901`, `20260731204223`, `20260811202905`, `20260814221436`,
`20260814225528`, `20260815020925`, `20260815021158` e `20260815022256`
contêm o tenant UUID de origem apenas como seed/dados de baseline (catálogo de
rotas, corpos de `pg_cron`) e não foram alteradas.

### Regra permanente

Migrations descrevem **schema e privilégios**. Qualquer correção de dados
ligada a um tenant/usuário concreto vive em `scripts/ops/*.sql`, parametrizada
e executada manualmente por um operador.

## Correção: `20260820211500_portal_read_model.sql`

A migration original referenciava colunas inexistentes em
`public.fiscal_documents` (`invoice_date`, `total_value`, `total_weight_kg`,
`issuer_id`, `sender_cnpj`) e declarava `SET search_path` duas vezes na função
`get_portal_tracking_v3`, tornando o arquivo não executável em um
`supabase db reset`.

Correções aplicadas:

1. `public.portal_shipment_read_model` recriada com as colunas reais
   (`issue_date`, `value`, `weight_kg`, `client_id`, `remitter_cnpj`,
   `recipient_cnpj`), `clients.company_name`/`clients.tax_id` como nome e
   documento, joins de tenant explícitos e `security_invoker = true`.
2. Nomes de saída estáveis (DTO): `id`, `invoice_number`, `invoice_series`,
   `issue_date`, `value`, `weight_kg`, `client_id`, `client_name`,
   `load_number`, `current_status`, `last_event_at`, `total_count`.
3. `get_portal_tracking_v3` alinhada ao mesmo DTO, com um único
   `SET search_path = public`.
4. Autorização por linha via helpers do portal: `is_user_internal_role` ou
   `_portal_user_client_ids`. Os parâmetros `p_client_ids` e `p_cnpjs` são
   apenas filtros de refinamento e nunca concedem acesso.
5. `EXECUTE` revogado de `PUBLIC` e concedido apenas a `authenticated`.
6. `MANIFEST.sha256` (raiz e `supabase/migrations/`) atualizados.

`CLIENT_PORTAL` permanece desativada; nenhuma flag foi alterada.
