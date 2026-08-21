# Plan - Povoamento de Dados e Recuperação de Visibilidade

O objetivo é restaurar a visibilidade dos dados (cargas, notas, dashboards) que parecem estar "zerados" devido a inconsistências de tenant ou permissões RLS, e garantir que o pipeline de ingestão esteja povoando o tenant correto.

## User Review Required

> [!IMPORTANT]
> Os dados existem no banco (937 notas, 52 veículos), mas estão vinculados ao tenant `6e874e6e-5bca-486d-9928-bef0646989c4`. Se você estiver logado em outro tenant (como o `db36dc9b-2bfb-4e3f-985b-ec4880b7ee97`), os dados aparecerão zerados.

- Você deseja que eu mova os dados existentes para o seu tenant atual ou apenas corrija o acesso para que você veja o tenant que já possui dados?
- O pipeline de importação deve ser configurado para qual tenant por padrão?

## Proposed Changes

### 1. Diagnóstico e Correção de Acesso
- **Verificação de Identidade**: Validar qual tenant o usuário logado está visualizando.
- **RLS Fix**: Garantir que as policies de `SELECT` nas tabelas `fiscal_documents`, `loads`, `vehicles` e `positions_last` não estejam bloqueando o acesso legítimo do `authenticated` role.
- **Tenant Membership**: Garantir que o usuário atual tenha permissão de `owner` ou `admin` no tenant que contém os dados (`6e874e6e-5bca-486d-9928-bef0646989c4`).

### 2. Povoamento de Dados (Se necessário)
- **Data Migration**: Se o usuário precisar dos dados em um novo tenant, criarei um script para reatribuir o `tenant_id` dos registros órfãos ou do tenant antigo para o novo.
- **Pipeline Ingestion**: Ajustar os cursores de ingestão (`ingestion_cursors`) para garantir que novas posições e documentos sejam atribuídos ao tenant ativo.

### 3. Ajustes de UI para Transparência
- **Switch de Tenant**: Adicionar um seletor de tenant mais visível se houver múltiplos, para evitar confusão de "dados zerados".
- **Dashboard Fallbacks**: Melhorar as mensagens de "Sem dados" para indicar se o problema é falta de dados ou falta de permissão/sincronização.

## Technical Details

- **SQL Migration**: Ajuste de permissões `GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated`.
- **Ingestion Audit**: Verificar a Edge Function `ssx-poll-positions` para confirmar qual `tenant_id` ela está usando no upsert.

## Constraints & Assumptions

- Não excluiremos dados existentes, apenas reabilitaremos a visibilidade.
- Seguiremos a regra de isolamento de tenant, mas permitiremos que o usuário veja seus dados históricos.
