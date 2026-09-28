# Triagem do lint do banco local — 28/09/2026

## Estado examinado

- Lint de 28/09/2026 às **18:27:26.385 UTC**, checkout `d457d295d8725e03c97e100d534f800d9488a59f`, baseline restaurado e **13 forwards** aplicados: **35 achados**.
- Catálogo local de funções, ACLs e chamadores capturado às **18:32:38.882 UTC**. Provas complementares às **18:39:55–58 UTC**, em transações `READ ONLY`, com timeout de 15 segundos e identificadores sintéticos. Nenhuma escrita no banco ou consulta a registros de clientes foi necessária.
- Este parecer classifica aquele resultado. Correções posteriores e suas aplicações pertencem ao [log da homologação](release-log-2026-09-28-local-staging.md); os achados iniciais permanecem como evidência.

| Classificação | Achados | Consequência |
| --- | ---: | --- |
| Defeito em caminho atual da aplicação | 4 | Corrigir e executar o contrato completo antes de aprovar o fluxo |
| Falso positivo específico de `FOREACH` | 2 | Preservar a prova de execução e o limite do cenário |
| Falta de contexto de requisição no lint | 2 | Reexecutar a verificação com contexto e testar a RPC autenticada |
| Rotina incompatível retida, sem consumidor atual localizado | 21 | Manter dívida explícita e revisar dependências antes de corrigir ou retirar |
| Interno de PostGIS, sem investigação de execução neste parecer | 6 | Análise de plataforma separada; nenhuma aprovação inferida |
| **Total** | **35** | **Este documento não libera o gate nem cria uma lista de exclusão** |

## Quatro caminhos ativos

| Função com achado | Consumidor observado | Defeito e tratamento |
| --- | --- | --- |
| `public.edit_pallet_return_protocol_v1(jsonb)` | `src/hooks/usePalletReturns.tsx:227` | `WITH ORDINALITY` com lista tipada gera `42601`; correção candidata em `20260928183014_fix_active_json_ordinality_contracts.sql` |
| `public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer)` | `src/lib/financial/accountPeriodEvidenceClient.ts:5` | Referência a `ordinal` ausente; mesma correção candidata, com execução dos contratos registrada no log |
| `finance_private.save_route_template_unsafe_20260917(jsonb)` | `public.save_route_template_v1` → `src/components/routes/RouteDialog.tsx:162` | Mesmo erro sintático `42601`, reproduzido por `SELECT` no PostgreSQL local; exige correção própria e teste de salvar rota |
| `public.commit_legacy_fiscal_poll_v1(jsonb)` | `supabase/functions/cte-status-poll/index.ts:302` e `nfse-status-poll/index.ts:277` | No ramo CT-e, evento não nulo tenta escrever `document_id`, `message` e `payload` em `vehicle_events`, onde essas colunas não existem; `42703` confirmado por leitura do catálogo e `SELECT` |

O nome `unsafe` ou `legacy` não determina inatividade. O helper de rotas continua atrás de uma RPC disponível a `authenticated`. O commit fiscal permanece disponível a `service_role`, utilizado pelos pollers atuais.

No CT-e, o chamador monta o evento quando há resultado de autorização, rejeição ou cancelamento (`cte-status-poll/index.ts:291`). O erro nessa inserção aborta a chamada e impede que suas atualizações anteriores sejam confirmadas. O ramo NFSe usa `nfse_events`, cujo catálogo contém as colunas esperadas; esta constatação não equivale a executar o fluxo fiscal completo. A fonte do comando defeituoso está em `20260916231000_finish_reported_integrity_fixes.sql:77`; a fonte do helper de rotas está em `20260917144800_guard_route_template_revision.sql:78`.

## Dois falsos positivos de `FOREACH`, com prova delimitada

### `finance_private.legacy_integrity_inventory_revision(uuid)`

O lint transformou o array inteiro com 25 nomes em um único identificador de tabela. A função real itera elementos `text` e formata cada identificador separadamente. A execução completa da função com tenant sintético, em `READ ONLY`, retornou um hash de 32 caracteres sem erro. Isso refuta o erro específico de relação inexistente gerado pelo lint.

O caminho permanece ativo: `public.get_finance_legacy_integrity_inventory` → `finance_private.legacy_integrity_inventory` → revisão; consumidor em `src/lib/financial/legacyIntegrityClient.ts:4`. A prova não exercita o cache, a paginação ou a autorização da RPC pública, nem usa dados de uma empresa real.

### `finance_private.unloading_projection_repair_context(uuid,uuid)`

O lint apresenta a mesma conversão incorreta do array em identificador. Foi extraído do catálogo capturado o **array exato de 14 tabelas e o `SELECT` dinâmico exato**, e o loop executou integralmente em `READ ONLY`, com tenant/recebível/descarga sintéticos e zero linhas retornadas. Todas as 14 relações existiam. SHA-256 do texto da consulta dinâmica: `7a6da09e5ed7d50a6e27f1bb297203239404aa4e36c43a6e50cab751628e61f4`.

Consumidor: `src/lib/financial/unloadingProjectionRepairClient.ts:8`, por `public.get_finance_unloading_projection_repair_context` e pelo preview privado. A função também participa de outros comandos financeiros por helpers internos. A prova cobre o loop que causou o achado; não executa a autorização, a verificação da origem financeira ou a reparação completa. Não há justificativa para remover o helper nem ignorar outros erros da função.

## Dois achados dependentes de contexto SSX

`public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)` e `public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)` produziram `22023: tenant_context_required` em `private.request_tenant_id()` durante a análise. Ambas têm execução de `authenticated` e a v2 é usada em `src/components/integrations/SsxMappingConflictReview.tsx:38`.

O guard foi reproduzido em leitura: sem contexto, gera exatamente `22023`; com cabeçalho `x-agvlog-tenant-id` e claim `active_tenant_id` sintéticos e coincidentes, retorna o tenant esperado. Trata-se de uma precondição real, e sua remoção enfraqueceria o isolamento. A prova não executou a resolução de conflito inteira e não garante ausência de outros erros que o lint possa encontrar depois dessa precondição. A validação autenticada, com tentativa em outra empresa e repetição, continua necessária.

## Vinte e uma rotinas incompatíveis sem consumidor atual localizado

No catálogo examinado, **nenhuma das 21 assinaturas abaixo permite execução por `anon` ou `authenticated`**. Vinte permitem `service_role`; `add_driver_settlement_manual_expense` também nega esse papel. A busca de nomes em `src`, `supabase/functions` e scripts atuais não encontrou chamada de execução da aplicação para essas rotinas ou para os ancestrais retidos abaixo; tipos gerados e testes foram separados da evidência de uso.

| Rotina em `public` | Achado do lint | Chamador SQL candidato observado |
| --- | --- | --- |
| `add_driver_settlement_manual_expense` | `driver_expenses.vehicle_id` ausente | Nenhum |
| `build_fiscal_documents_deleted_recovery_dry_run` | `has_role(uuid,unknown)` ausente | Nenhum |
| `create_ledger_entry_v1` | Tipo `ledger_nature` ausente | `approve_financial_obligation_v1`, também restrito ao serviço |
| `create_load_v1` | `text` usado como `operation_type` | Nenhum |
| `create_load_with_next_number` | `text` usado como `trip_id uuid` | Nenhum |
| `delete_load_v1` | `dispatch_trip_loads.trip_id` ausente | Nenhum |
| `diagnose_load_composition` | `has_role(uuid,unknown)` ausente | `repair_load_composition` |
| `driver_report_event_v1` | `dispatch_trips.start_km` ausente | Nenhum |
| `get_driver_workspace_v1` | `loads.total_value` ausente | Nenhum |
| `link_fiscal_documents_to_load_v1` | `has_role(uuid,unknown)` ausente | `move_load_items_v2` |
| `list_dispatch_trips_v1` | `trip_number` ausente | Nenhum |
| `list_drivers_v1` | `license_number` ausente | Nenhum |
| `log_operational_event_v2` | `digest(text,unknown)` não resolvido | Nenhum |
| `move_load_items_v2` | `has_role(uuid,unknown)` ausente | Nenhum |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamptz,text)` | `dispatch_trips.scheduled_start_at` ausente | Nenhum |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)` | `metadata` ausente | Nenhum |
| `process_geofence_alerts` | `geofence_events.event_type` ausente | Nenhum |
| `process_overspeed_alerts` | `ON CONFLICT` sem restrição/índice correspondente | Nenhum |
| `repair_load_composition` | `has_role(uuid,unknown)` ausente | Nenhum |
| `unlink_fiscal_documents_from_load_v1` | `has_role(uuid,unknown)` ausente | `move_load_items_v2` |
| `update_employee_v1` | Tipo `app_employee_status` ausente | Nenhum |

Há evidência histórica de encerramento do acesso pelo navegador em `20260830005603_close_authenticated_security_definer_surface.sql`, `20260901001826_revoke_reintroduced_legacy_security_definers.sql`, `20260901003429_close_remaining_legacy_security_definer_acl.sql` e `20260901212053_revoke_replaced_dispatch_planner_acl.sql`. O último também documenta `dispatch_planned_route(jsonb)` como substituto do planner de sete argumentos. Isso sustenta a prioridade diferente dessas rotinas, sem transformá-las em funções corretas.

Os chamadores SQL foram localizados por referência lexical em `prosrc`, com expansão de até cinco níveis; são candidatos, não um grafo completo de execução. Não foram encontradas dependências diretas dessas rotinas no `pg_depend`, mas PL/pgSQL dinâmico e consumidores externos podem escapar desses mecanismos. O cron local foi intencionalmente esvaziado na restauração e não prova ausência de agendamentos em produção. Antes de reativar, alterar ou remover qualquer uma dessas APIs, é preciso conferir consumidores de serviço externos e executar seu contrato válido. Nenhuma foi removida ou liberada por esta triagem.

## Seis achados internos de PostGIS

| Rotina em `extensions` | Quantidade | Achado |
| --- | ---: | --- |
| `addauth` | 1 | Relação `temp_lock_have_table` ausente |
| `lockrow` | 1 | Relação `authorization_table` ausente |
| `populate_geometry_columns` | 1 | Record `gc` sem estrutura atribuída |
| `postgis_full_version` | 1 | `postgis_gdal_version()` ausente |
| `st_findextent` | 2 | Record `myrec` sem estrutura atribuída, em duas entradas do lint |

Foram preservados como achados de plataforma, sem investigação de execução neste parecer. Não foram classificados globalmente como falsos positivos e nenhuma extensão foi alterada.

## Evidências e conclusão

Artefatos privados estão em `.codex-build-audit/baseline-capture-20260928-cli/`, fora do Git. Contêm definições e detalhes de catálogo necessários à revisão, sem serem reproduzidos neste documento.

| Arquivo privado | SHA-256 |
| --- | --- |
| `lint-findings-d457d295.json` | `c1e7384bfd4405ef33905f8fa4a9ada9bc440ef6fc049f0f593fef2602166d92` |
| `lint-app-catalog.json` | `d94a59749804db950b5168f4a081e6bf3cb079f89f4afb9c12aed8925d7f4191` |
| `lint-readonly-probes.json` | `2e3d396fc1c7c67c82f6786f23178d5a9c36ad14bd654b0ecf3b3b360d3b3a67` |
| `lint-triage-2026-09-28.private.json` | `5137b3599d143165e64ab4dd52c03aef824d8ef5f7f4820ad87ea9aa540b4ffb` |

A [documentação oficial de plpgsql_check](https://github.com/okbob/plpgsql_check) descreve limitações de análise de SQL dinâmico e de records. A classificação dos dois loops acima depende das provas específicas, e não apenas dessa limitação geral.

**A versão ainda exige validação dos caminhos ativos e decisão explícita sobre os achados remanescentes.** Reexecutar lint depois dos forwards, conservar o resultado bruto e vincular cada mudança à sua reprodução e ao teste autenticado. Este relatório não altera critérios de aprovação, não cria exclusões automáticas e não comprova estabilidade pública.
