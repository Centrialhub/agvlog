# SSX — readiness de deployment em 10/09/2026

## Resultado

O backend da integração SSX foi publicado no projeto Supabase
`qcvnsdrbcchaxvawcngk` (`PROJETO AGV LOG`) e está operacional. A ativação
permanece deliberadamente bloqueada: a única conta SSX está com
`invalid_credentials` e todos os tenants continuam com `ssx_enabled=false`.

A última validação de produção chamou o dispatcher com o segredo real do cron e
recebeu HTTP 200:

```json
{"success":true,"claimed":0,"completed":0,"failed":0}
```

O zero é esperado enquanto a feature está desativada.

## Evidência verificada

- 114/114 testes SSX aprovados em 16 arquivos.
- 47/47 contratos focais de dispatcher, segurança, pipeline, geocodificação e
  configuração de produção aprovados.
- 73/73 arquivos TypeScript de Edge Functions aceitos pelo verificador de
  sintaxe.
- Migração corretiva `20260910221301` presente no histórico remoto.
- RPCs de claim e acknowledgement sem referência a
  `tenant_tracking_schedules`.
- `authenticated` não possui `EXECUTE` nos dois RPCs do dispatcher.
- Chamada direta do claim com contexto `service_role` retornou lista vazia sem
  erro.
- Edge Function `agvlog-ssx-dispatcher` ativa na versão 2, com
  `verify_jwt=false` e autenticação própria pelo segredo do cron.
- Código remoto do dispatcher contém os RPCs de claim/ack e não contém chamadas
  ao pipeline de resolução de endereços.

## Migrations publicadas

Foram publicadas 27 migrations versionadas: duas dependências preexistentes, as
21 migrations do release SSX/workspace, a fila e hardening de conflitos, uma
correção de desacoplamento e a indexação das FKs.

1. `20260831211632_make_ssx_position_ingestion_monotonic.sql`
2. `20260831215357_make_ssx_queue_claims_recoverable.sql`
3. `20260910125751_workspace_tenant_foundation.sql`
4. `20260910131125_active_tenant_auth_context.sql`
5. `20260910132033_enforce_active_tenant_rls.sql`
6. `20260910132428_shared_master_data_foundation.sql`
7. `20260910133110_workspace_ssx_access_contract.sql`
8. `20260910134010_enforce_tenant_storage_context.sql`
9. `20260910135800_workspace_ssx_account_management.sql`
10. `20260910140823_require_matching_active_tenant_claim.sql`
11. `20260910141506_workspace_fleet_snapshot.sql`
12. `20260910142232_synchronize_shared_master_projections.sql`
13. `20260910142818_merge_existing_tenant_workspaces.sql`
14. `20260910144948_finalize_active_tenant_rls_coverage.sql`
15. `20260910145706_harden_ssx_credentials_and_browser_contract.sql`
16. `20260910150914_add_ssx_position_quarantine.sql`
17. `20260910151622_reassert_active_tenant_rls_release_gate.sql`
18. `20260910152456_add_workspace_vehicle_position_reader.sql`
19. `20260910153507_gate_ssx_administration_capability.sql`
20. `20260910154919_add_ssx_workspace_dispatcher.sql`
21. `20260910161442_expose_ssx_person_sync_settings.sql`
22. `20260910162008_add_ssx_tracking_reference_catalog.sql`
23. `20260910163922_add_ssx_governance_and_violations.sql`
24. `20260910203617_ssx_mapping_conflict_review.sql`
25. `20260910221301_decouple_ssx_dispatcher_from_address_tracking.sql`
26. `20260910223000_harden_ssx_mapping_conflict_active_tenant.sql`
27. `20260910223935_index_ssx_mapping_conflict_foreign_keys.sql`

Todos os pushes foram feitos por staging isolado. Mesmo com migrations remotas
concorrentes surgindo durante o rollout, cada onda foi precedida por um dry-run
com o conjunto exato esperado: fundação/release, duas dependências + governança,
desacoplamento do dispatcher, fila + hardening de conflitos e, por fim, somente
a migration de índices.

## Edge Functions publicadas

- `agvlog-integration-upsert`
- `ssx-login`
- `ssx-sync-telemetry`
- `ssx-sync-units`
- `ssx-insert-person`
- `ssx-poll-positions`
- `ssx-sync-governance`
- `ssx-sync-rule-violations`
- `ssx-diagnostic`
- `ssx-insert-person-client`
- `agvlog-aggregate-daily`
- `agvlog-compute-state`
- `agvlog-run-queue`
- `agvlog-pipeline-run`
- `agvlog-ssx-dispatcher`

As três funções que sofreram conflito de atualização durante o deploy paralelo
foram republicadas sequencialmente e comparadas com os entrypoints locais.

## Erros encontrados e corrigidos na revisão

1. O manifesto inicial omitia duas migrations exigidas pelos RPCs privados de
   ingestão e fila. Ambas foram incluídas antes do release.
2. O dispatcher SSX dependia de `tenant_tracking_schedules`, criada por uma
   migration ampla e não relacionada ao SSX.
3. A Edge Function do dispatcher também chamava
   `process-address-resolution-queue`, que não fazia parte deste release.
4. O SSX foi desacoplado desse pipeline. O dispatcher agora usa sua própria
   cadência: polling padrão de 180 segundos, full sync a cada 6 horas e retry
   padrão de 600 segundos, sempre com limites de 30 a 3600 segundos.
5. O teste de geocodificação foi corrigido para manter
   `agvlog-schedule-tenants` como responsável pelo worker de endereços, sem
   acoplá-lo ao SSX.
6. O sincronizador remoto de unidades já reportava conflitos, mas o banco ainda
   não possuía a fila/RPC correspondente. A fila, a UI de revisão, o isolamento
   por tenant ativo e os cinco índices de FK foram validados e publicados.
7. A função remota que grava credenciais ainda era a versão anterior, sem a
   allowlist SSX do código local. `agvlog-integration-upsert` foi publicada
   novamente, comparada byte a byte após normalização e permanece JWT-only.

## Advisors após o DDL

Não surgiu finding crítico específico do SSX.

- Quatro tabelas backend-only aparecem como `RLS Enabled No Policy` em nível
  INFO. Isso é intencional: o browser não recebe acesso e o backend usa
  `service_role`.
- Dois RPCs de administração SSX aparecem como `SECURITY DEFINER` executável
  por `authenticated`. Eles são fronteiras de browser intencionais e fazem
  validação interna de tenant e papel.
- As cinco FKs da fila de conflitos agora possuem índices. O advisor os classifica
  como não utilizados porque a tabela acabou de ser criada e ainda não recebeu
  tráfego.
- Os avisos de desempenho restantes são um FK sem índice na quarentena, índices
  ainda não utilizados e duas policies permissivas de leitura/admin na tabela de
  contas. Não bloqueiam o canário, mas devem ser reavaliados após tráfego
  representativo.

Referências do linter:

- [RLS habilitado sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [SECURITY DEFINER executável por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Foreign keys sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Policies permissivas múltiplas](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)

## Gate que exige ação humana

1. Entrar em [Configurações do AGV LOG](https://agvlog.lovable.app/settings).
2. Regravar a senha SSX pela interface; não reutilizar automaticamente o segredo
   legado.
3. Confirmar o login SSX.
4. Executar um canário manual de catálogos, unidades, governança e uma unidade de
   posições.
5. Somente depois habilitar `ssx_enabled` no tenant principal e observar por
   24–72 horas. Em anomalia, ativar `ssx_kill_switch` sem apagar dados.

Sem a senha válida, não é possível testar legitimamente a API externa da SSX nem
habilitar a integração.
