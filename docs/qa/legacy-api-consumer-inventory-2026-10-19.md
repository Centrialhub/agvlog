# Inventário de consumidores das APIs legadas — 19/10/2026

## Decisão e escopo

Thomaz informou que não conhece os consumidores externos e determinou inventariá-los **preservando as APIs**. Todas as 21 assinaturas legadas e a assinatura adicional do chamador financeiro permanecem existentes, com as mesmas assinaturas, retornos, definições, proprietários e ACLs. Nenhuma função foi executada para produzir efeitos de negócio; nenhuma migration, grant, revogação, índice, campo ou tipo foi criado.

Este inventário não resolve os contratos incompatíveis nem aprova publicação. A decisão por API é **manter e reparar o contrato completo**, com testes nativos; ausência de tráfego não autoriza retirada. Os 31 achados brutos do lint continuam bloqueantes, sem filtros, skips ou dispensas.

Fonte analisada: `1b2e545f825810a54389da38a2945b61c912a831`, tree `85fe8e5ce20b4eea99369b168e863fb834681e47`. Também foram buscados os nomes na fonte publicada `a90eb6ccdb5212ab4da9fe2cd48bbf4ad43d1c93`, preservando o trabalho do DOT. Alvo de consultas somente leitura: Supabase `qcvnsdrbcchaxvawcngk`. Horários abaixo em UTC.

## Consumidores observados e limites

| Superfície | Resultado confirmado | Limite |
| --- | --- | --- |
| Código `src`, `scripts`, `supabase/functions` nos dois SHAs | 53 referências por SHA: 21 em tipos gerados e 32 em testes/fixtures; nenhum consumidor de runtime nomeado | Busca lexical não resolve nomes construídos dinamicamente ou clientes fora do repositório |
| 49 Edge Functions efetivamente publicadas | Todos os bundles recuperados; zero referências aos 21 nomes, incluindo o chamador financeiro; versões e hashes registrados | Descreve somente as versões recuperadas |
| Dois adaptadores RPC dinâmicos nas Edge Functions | `secure-upload` v30 encaminha reserve/prepare/finalize_finance_upload_artifact; `finance-payable-xml` v2 encaminha reserve/prepare/finish_finance_payable_xml | Revisão dos módulos de workflow confirma nomes internos fixos; não são despachantes arbitrários das APIs legadas |
| Funções SQL | 22 assinaturas no fechamento lexical; quatro pares de chamada; profundidade máxima 1 | Candidatos lexicais, sem resolução de overload por AST; SQL dinâmico pode escapar |
| Dependências catalogadas, triggers, políticas/views/defaults | Nenhum dependente catalogado adicional; nenhum trigger chamador | `pg_depend` não registra todas as referências de corpos PL/pgSQL ou SQL em strings; a busca de corpos complementa o catálogo |
| Cron de produção e candidatos a webhook | Zero referências literais aos nomes; zero candidatos pelos nomes nos argumentos de triggers | Não prova ausência de URLs/proxies ou tarefas externas; não foram exportados argumentos, tokens ou payloads |
| Gateway, sete janelas de 24 horas | 354.347 eventos com caminho; zero rotas RPC dos 21 nomes | Só eventos disponibilizados pelo serviço; não cobre conexão PostgreSQL direta, versões antigas instaladas, eventos fora da janela, nomes dinâmicos ou chamadas internas |
| Estatísticas SQL | `pg_stat_statements.track=top`, max=5000, reset 2026-09-09T20:33:55Z, 23 desalocações | Amostra retida incompleta, sem rastreio de funções internas; `track_functions=none`, logo zero em pg_stat_user_functions não prova inatividade |
| Clientes externos de serviço | Responsável, finalidade, versão e frequência **não identificados** | Não é possível descobrir instalações externas apenas pelo banco/código; ausência de evidência não significa API sem consumidor |

A única consulta retida com correspondências a cinco nomes tem queryid `3741231331442189658`, duas execuções por `postgres`, 19.023 caracteres e MD5 `4442a1a87b1def5e6a67118bd88ffb47`. Contém inspeção de `pg_get_functiondef`, ACLs, namespaces e dependências; não contém chamada direta SELECT às cinco funções. Foi classificada como candidata de inspeção de catálogo, **não como prova de cinco execuções de negócio**. O texto SQL real não foi exportado. Essa classificação também não prova ausência de outras consultas.

Referência para a limitação do catálogo: [PostgreSQL — Dependency Tracking](https://www.postgresql.org/docs/17/ddl-depend.html).

## Chamadores SQL encontrados

| Chamador | API chamada | Papel permitido do chamador |
| --- | --- | --- |
| repair_load_composition(uuid,uuid[],boolean) | diagnose_load_composition(uuid,uuid[]) | postgres, service_role |
| move_load_items_v2(uuid,uuid,uuid,uuid[]) | link_fiscal_documents_to_load_v1(uuid,uuid,uuid[]) | postgres, service_role |
| move_load_items_v2(uuid,uuid,uuid,uuid[]) | unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[]) | postgres, service_role |
| approve_financial_obligation_v1(uuid,text) | create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb) | postgres, service_role |

Nenhuma das 22 assinaturas permite EXECUTE a `anon` ou `authenticated`, incluindo os chamadores indiretos. Todas pertencem a `postgres` e são SECURITY DEFINER. Isso delimita a superfície atual; não justifica ampliar permissões nem desconsiderar consumidores de serviço.

## Matriz de preservação

Todas as linhas mantêm decisão **preservar API/ACL e reparar compatibilidade**. O proprietário técnico SQL é postgres; o responsável externo é desconhecido em todas as linhas. Nenhum consumidor externo foi identificado por nome/versão.

| Assinatura completa | EXECUTE observado | Origem |
| --- | --- | --- |
| `add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)` | postgres | API retida do lint |
| `approve_financial_obligation_v1(uuid,text)` | postgres, service_role | Chamador adicional do financeiro |
| `build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)` | postgres, service_role | API retida do lint |
| `create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)` | postgres, service_role | API retida do lint |
| `create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)` | postgres, service_role | API retida do lint |
| `create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)` | postgres, service_role | API retida do lint |
| `delete_load_v1(uuid,uuid)` | postgres, service_role | API retida do lint |
| `diagnose_load_composition(uuid,uuid[])` | postgres, service_role | API retida do lint |
| `driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)` | postgres, service_role | API retida do lint |
| `get_driver_workspace_v1(uuid,uuid)` | postgres, service_role | API retida do lint |
| `link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])` | postgres, service_role | API retida do lint |
| `list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)` | postgres, service_role | API retida do lint |
| `list_drivers_v1(uuid,text,text,integer)` | postgres, service_role | API retida do lint |
| `log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)` | postgres, service_role | API retida do lint |
| `move_load_items_v2(uuid,uuid,uuid,uuid[])` | postgres, service_role | API retida do lint |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)` | postgres, service_role | API retida do lint |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)` | postgres, service_role | API retida do lint |
| `process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)` | postgres, service_role | API retida do lint |
| `process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)` | postgres, service_role | API retida do lint |
| `repair_load_composition(uuid,uuid[],boolean)` | postgres, service_role | API retida do lint |
| `unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])` | postgres, service_role | API retida do lint |
| `update_employee_v1(uuid,uuid,jsonb,integer)` | postgres, service_role | API retida do lint |

## Contratos e fingerprints

O recibo JSON registra argumentos nomeados, defaults, tipo de retorno, kind, volatilidade, paralelismo, STRICT, SETOF, configuração, ACL, owner e MD5 de definição completa para cada assinatura. As definições/ACLs/proprietários e a lista de assinaturas do início e do fim da coleta foram comparadas e permaneceram idênticas.

| Assinatura | Retorno atual | MD5 de definição completa |
| --- | --- | --- |
| `add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)` | `uuid` | `895872f69f1a1bb4ef7baf8bf57d4044` |
| `approve_financial_obligation_v1(uuid,text)` | `boolean` | `12686318de1214e2a49d3b388751c0ce` |
| `build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)` | `TABLE(tenant_id uuid, deleted_count bigint, sample_ids uuid[])` | `607ee77727835dbe186103d028d393f4` |
| `create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)` | `uuid` | `fbc51e5e8094e6e22d034299c6ff6e3d` |
| `create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)` | `uuid` | `938283f684aec640e4d996d6faae9bee` |
| `create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)` | `loads` | `f0e304ecd3a18c9f9ec86771c5ddd562` |
| `delete_load_v1(uuid,uuid)` | `jsonb` | `2baf4288611b4a21ef7d20479f883c8d` |
| `diagnose_load_composition(uuid,uuid[])` | `TABLE(load_id uuid, load_number text, entity_id uuid, entity_type text, issue text, severity text)` | `82a2a3f7a580ef83ffc9e29f5b059487` |
| `driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)` | `jsonb` | `820fcce650445c44861f9cab01d39bc5` |
| `get_driver_workspace_v1(uuid,uuid)` | `jsonb` | `dca8c231888acbc18ce738a36dd459c3` |
| `link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])` | `jsonb` | `abd942f38c9504dc0974dd3a1e5e3a9f` |
| `list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)` | `jsonb` | `d45903ba7ed066738039f2d32c07888f` |
| `list_drivers_v1(uuid,text,text,integer)` | `jsonb` | `d0791f2ab5829d73b43e8cc299211966` |
| `log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)` | `jsonb` | `ef03d05bdb51cb1bdb561f17d2e1a915` |
| `move_load_items_v2(uuid,uuid,uuid,uuid[])` | `jsonb` | `84c3161f4135deebfcb1783fff66dead` |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)` | `uuid` | `71e0e20c2a2e4e338621e5b8d8928031` |
| `plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)` | `uuid` | `7f3e895f441a0e46a98e6655115015f5` |
| `process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)` | `void` | `2fe34d48f0d92e17c21681c8276f4407` |
| `process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)` | `void` | `6509ce628f5dc2222be4f2edd083b5b5` |
| `repair_load_composition(uuid,uuid[],boolean)` | `jsonb` | `1e9488282a6c5a1337eaee023749ad3d` |
| `unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])` | `jsonb` | `cdaf990963a34cfac9f524d210db9678` |
| `update_employee_v1(uuid,uuid,jsonb,integer)` | `void` | `18c3149440475e33ad78bddcbc8ac645` |

## Cobertura do gateway

Consulta agregada sobre `edge_logs`, comparando `request.path` com `/rest/v1/rpc/<nome>`. Inclui os 20 nomes legados e `approve_financial_obligation_v1`. Sem headers, chaves, tokens, identificação de clientes ou corpos de requisição.

| Janela UTC | Eventos | Com caminho | Rotas procuradas |
| --- | ---: | ---: | ---: |
| 2026-10-18 21:30 → 2026-10-19 21:30 | 56919 | 56919 | 0 |
| 2026-10-17 21:30 → 2026-10-18 21:30 | 38896 | 38896 | 0 |
| 2026-10-16 21:30 → 2026-10-17 21:30 | 54646 | 54646 | 0 |
| 2026-10-15 21:30 → 2026-10-16 21:30 | 55378 | 55378 | 0 |
| 2026-10-14 21:30 → 2026-10-15 21:30 | 47665 | 47665 | 0 |
| 2026-10-13 21:30 → 2026-10-14 21:30 | 42607 | 42607 | 0 |
| 2026-10-12 21:30 → 2026-10-13 21:30 | 58236 | 58236 | 0 |

## Evidências e reprodução

Artefatos locais sanitizados, fora de dados de negócio:

- `F:/AGVLOG/checks/legacy-api-live-inventory-20261019.json`: metadados de 22 assinaturas, fechamento, dependências, versões/hashes de 49 bundles, revisão dos adaptadores, estatísticas e sete agregações de logs.
- `F:/AGVLOG/checks/legacy-api-readonly-queries-20261019.sql`: consultas de catálogo somente leitura, sem comandos de funções de negócio.
- `F:/AGVLOG/checks/legacy-api-source-inventory-20261019.json`: arquivo/linha/categoria de cada referência em ambos os SHAs.
- `F:/AGVLOG/checks/inventory-legacy-source-20261019.mjs`: reprodução da busca por `git grep` nos dois SHAs, sem leitura de envs ou arquivos não versionados.
- `F:/AGVLOG/checks/driver-shared-handoff-1b2e545f-20261019.json`: homologação anterior da conta única com GoTrue/PostgreSQL/Chromium e limites dos gates.

O inventário anterior de 24 horas/53.456 eventos permanece histórico. Este levantamento amplia a janela e inclui o chamador financeiro sem converter ausência de evidência em prova de desuso.

## Continuidade do reparo compatível

### Recuperação das fontes de contrato

Foram localizadas definições versionadas para os 21 nomes/22 assinaturas do fechamento em `supabase/migrations/20260824224152_baseline.sql`. `update_employee_v1` também tem definição posterior em `20260828113034_harden_tenant_mutation_rpcs_and_cte_monitor.sql`; `list_drivers_v1` recebe ajuste explícito de search_path em `20260826002000_relocate_extensions.sql`. O recibo `F:/AGVLOG/checks/legacy-api-definition-provenance-20261019.json` registra arquivo, linha e SHA-256 da fonte de cada definição; o script homônimo de inventário reproduz a localização sem extrair ou reaplicar migrations.

O histórico anterior ao baseline é documentado em `supabase/migration_history/README.md`: os arquivos ZIP de recuperação não fazem parte do Git e o arquivo remoto é a trilha autoritativa, com SHA-256 publicado nessa documentação. A localização textual no baseline não prova equivalência do corpo com produção nem recupera sozinha a intenção de relações/types ausentes. As definições de produção foram recuperadas por consulta somente leitura para comparação, sem executar os comandos.

Exemplos concretos que exigem contrato completo: `create_ledger_entry_v1` ainda converte para o tipo ausente `public.ledger_nature`; `create_load_with_next_number` recebe `_trip_id text` e o insere numa coluna UUID; `list_drivers_v1` pesquisa `license_number`, coluna ausente. Fazer casts ou substituir nomes sem conferir semântica, retorno e autorização não constitui reparo homologado. Nenhuma dessas alterações foi feita neste inventário.

Rechecagem de produção ao concluir: 46 cadastros ativos, duas empresas, zero `user_id` vinculados; o helper privado de criação compartilhada permanece ausente. O fluxo de conta única já homologado localmente ainda não foi aplicado em produção. Não houve criação/exclusão de conta nem alteração de cadastro nesta coleta.

Preservar nome, ordem/nome/tipo/default dos argumentos, retorno, erros de autorização, ACL, SECURITY DEFINER, isolamento, idempotência e efeitos auditados. Para cada família, recuperar a definição original e os contratos atuais de domínio, reproduzir a falha nativamente com parâmetros válidos e elaborar forward incremental com teste de antes/depois, replay, concorrência e estado obsoleto. Não escolher novas relações, enums ou regras de deduplicação apenas para satisfazer o lint.

A ausência de owner externo conhecido permanece registrada como limite de inventário, sem bloquear essa recuperação documental dos contratos. Não retirar endpoints ou conceder permissões. Depois dos reparos completos, repetir o lint intacto e os gates no mesmo SHA final, incluindo oito shards e database/full/critical E2E. A homologação local da conta única não equivale à sua disponibilização em produção.

