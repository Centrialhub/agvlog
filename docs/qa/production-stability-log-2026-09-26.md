# Log do incidente de estabilidade e do candidato de release

Atualizado em 26/09/2026, aproximadamente 19:23 UTC (16:23 em Brasília). **Estado: investigação e correções locais; sem PR, staging ou publicação destas correções.** O roteiro de promoção é [production-stability-playbook-2026-09-26.md](production-stability-playbook-2026-09-26.md). Este log não contém dados de clientes.

## Linha do tempo e evidência

| Momento (UTC) | Evento e evidência | Estado |
| --- | --- | --- |
| 23/09, 20:23 | Vercel publicou `main` em `17a7592dca01f31b1aa7b63340fbaf28bb116347`: [deployment `dpl_HSmXs2XdmKBJA6SxHEP15kosqzoo`](https://vercel.com/centrialhubs-projects/agvlogistica/HSmXs2XdmKBJA6SxHEP15kosqzoo). `origin/main` permanecia nesse SHA durante a auditoria. | Frontend publicado. |
| 24/09, 12:43–15:57 | Sete migrações aplicadas no Supabase após o SHA do frontend: grant de geofence, dedupe de POI, reset de viagem, limite de retry SSX, otimização de rastreamento, checkpoints SSX e preparação de retenção cron. O ledger live terminou em `20260924155758`. | Banco adiante do Git. |
| 24/09, ~14:05 | Otimização de rastreamento `20260924140531` e versões Edge `ssx-sync-telemetry` v154, `agvlog-compute-state` v91 e `agvlog-aggregate-daily` v146 publicadas. A verificação inicial registrada no checkout operacional usou amostra curta; ciclo SSX completo continuava pendente. | Hotfix publicado, observação limitada. |
| 26/09, auditoria | [Quality gate do SHA publicado](https://github.com/Centrialhub/agvlog/actions/runs/35915644362) e [run anterior](https://github.com/Centrialhub/agvlog/actions/runs/35898959595) cancelados durante cobertura após falhas Vitest já visíveis; [run anterior](https://github.com/Centrialhub/agvlog/actions/runs/35790408555) falhou no typecheck. `release-candidate.yml` não tinha execução. | CI publicado sem evidência verde completa. |
| 26/09, auditoria | Supabase live: 896 versões aplicadas; 19 nomes de RPC referidos pelo bundle/frontend ou Edge publicados ausentes em `public.pg_proc`. Duas RPCs de listas do Portal existiam, mas com filtros incompatíveis com os tipos fiscais publicados. Políticas SELECT de incidentes permitiam leitura ampla aos membros da empresa. | Defeitos ou riscos confirmados no banco publicado. |
| 26/09, auditoria | CSV publicado separava campos por vírgula mesmo em arquivo com `;` e vírgula decimal. Seleção financeira em lote podia manter saldo antigo após refetch; o servidor aceitava valor menor como pagamento parcial. | Defeitos confirmados no código publicado. |
| 26/09, reconciliação local | Os sete arquivos SQL de 24/09 foram copiados de `F:\agvlog-main\supabase\migrations` para o worktree isolado com SHA-256 igual origem/destino. Seus nomes e versões coincidem com o ledger live; não houve alteração do banco. | Preservados no candidato. |
| 26/09, reconciliação local | Identificados 413 nomes iguais sob timestamps diferentes. `finalize_geofence_automation` local `20260916152615` e live `20260916153300`: o arquivo local revoga `EXECUTE` de `service_role` restaurado pelo hotfix `20260924124326`, que já consta aplicado. `make_poi_dedupe_conflict_inferable` local `20260922039000` e live `20260924124337` têm SQL idêntico. | Replay histórico bloqueado. |
| 26/09, candidato | Correções locais e testes focados descritos abaixo; `.gitattributes` força LF para SQL no replay Windows. O Quality gate local foi redesenhado para timeout de 60 minutos, cobertura focada e oito shards de testes. | Ainda sem execução no GitHub. |
| 26/09, prevenção | `AGENTS.md` criado na raiz com ponteiros para o roteiro e este log, além dos invariantes de paridade, teste, evidência e ordem DB→Edge→frontend. | Apenas no worktree; ainda não publicado. |
| 26/09, revisão fiscal | Migração candidata `20260926185847_enforce_fiscal_document_load_tenant.sql`, ordenada imediatamente antes da restauração das RPCs de frete, adiciona unicidade `loads(id, tenant_id)` e FK composta com `NOT VALID` seguido de `VALIDATE`. Preflight live agregado não encontrou órfãos nem ligações entre empresas; FK e frete 7/7 testes PGlite e checagem de release verdes. | Apenas local; validação e lock em staging ainda pendentes. |

## Contratos ausentes no live e correções candidatas

| Área | RPCs live ausentes | Candidato local / evidência até esta atualização |
| --- | --- | --- |
| Fiscal | `create_fiscal_document_with_freight_v1`, `update_fiscal_document_with_freight_v1`, `get_load_freight_context_v1` | FK candidata `20260926185847_enforce_fiscal_document_load_tenant.sql` e `20260926185848_restore_fiscal_freight_rpcs.sql`; 10 testes focados de RPC e 7/7 no replay FK+frete em PGlite. E2E hospedado ainda não executado. Preflight live agregado: 1.231 documentos, 226 com `load_id`, zero órfãos ou ligações entre empresas. |
| Estoque | `list_inventory_movements_page_v1`, `list_inventory_balances_page_v1`, `create_inventory_movement_v1` | `20260926190732_restore_inventory_public_rpcs.sql`; testes junto com equipe, 11/11. |
| Endereços | `record_address_entity_candidates_v1` | `20260926190513_restore_address_candidate_recording_rpc.sql`; 6/6 testes PGlite. Edge `geocode-address` publicado chama esta RPC e podia falhar ao persistir candidatos. |
| Equipe | `update_tenant_membership_v1`, `mutate_client_portal_access_v1`, `replace_portal_access_after_invite_v1` | `20260926190733_restore_team_access_public_rpcs.sql`; incluído nos 11/11 testes de estoque/equipe. |
| Portal | `list_client_mdfe_documents_v1`, `create_client_occurrence_v3`, `reply_client_occurrence_v2`, `cancel_client_pickup_v2` | Migrações `20260926191248`, `20260926191456`; ocorrências 4/4, MDF-e e exclusão CAS 5/5 testes PGlite no mesmo arquivo. |
| Operação | `delete_load_item_v4`, `list_operator_routes_page_v1`, `productivity_report_summary_v1` | Migrações `20260926191500`, `20260926191625`, `20260926191630`; rotas/produtividade e Portal ocorrências somaram 10/10 testes; MDF-e e exclusão CAS 5/5 PGlite. |
| SSX | `list_ssx_mapping_conflicts_v2`, `resolve_ssx_mapping_conflict_v2` | `20260926191257_restore_ssx_mapping_conflict_review_rpcs.sql`; 7 testes PGlite, preservando o cache de geocoding. |

Além desses 19 nomes: `20260926183928_restore_portal_list_contracts.sql` corrige as duas listas v2 existentes (5/5 testes); `20260926184015_restrict_incident_personnel_reads.sql` restringe SELECT de RH (5/5 testes). A parserização CSV tem 6 testes focados; o financeiro acrescenta revisão do saldo autoritativo na carteira e no diálogo de liquidação, com testes focados. Tudo permanece no worktree.

## Gates executados e limites

| Gate | Resultado observado | Limite |
| --- | --- | --- |
| `npm run supabase:release:check`, `npm run repository:check`, `npm run lockfile:check` | Passaram no worktree durante a reconciliação. | Verificam estrutura local; não a paridade live. |
| `npm run test:pipeline` | 12/12, incluindo quatro casos do novo `scripts/check-supabase-migration-parity.mjs`. | O preflight live não rodou, pois `AGVLOG_RELEASE_DB_URL` não está disponível. A falha fechada sem segredo foi confirmada. |
| Cobertura crítica local | Sete suítes, 53 testes e 87,81% de statements, segundo execução local do responsável por CI. | Oito shards para os 1.317 arquivos e `database-and-e2e` ainda não rodaram no GitHub. |
| Testes SQL focados | Portal listas 5/5; RLS 5/5; fiscal 10 e replay FK+frete 7/7; geocode 6/6; estoque/equipe 11/11; Portal ocorrências 4/4; SSX 7; rotas/produtividade incluídos em 10/10; MDF-e/exclusão CAS 5/5. O agente SQL reportou 39/39 em dez arquivos antes da revisão final da FK. Lint, qualidade estrutural e typecheck do escopo MDF-e/CAS passaram. | Sem execução contra staging ou banco publicado. |
| Smoke autenticado e retorno | Não executados. | Staging e credencial de smoke não disponíveis; não há PR/candidato Vercel imutável deste lote. |

## Próximos registros obrigatórios

1. Reconciliar versões históricas e efeitos SQL com o ledger live, começando por geofence. Executar `npm run supabase:parity:check` com credencial de leitura protegida contra o banco alvo; anexar o resultado. **Não executar `db push` enquanto falhar.**
2. Executar replay completo local, oito shards e `database-and-e2e`; testar a validação e o lock da FK fiscal em staging; anexar links de todos os jobs de um PR.
3. Preparar staging com histórico compatível e dados sintéticos; publicar migrações, Edge e frontend imutável nessa ordem. Executar a matriz do [roteiro](production-stability-playbook-2026-09-26.md) e `release-candidate.yml`; registrar SHA, versões e artefatos.
4. Só após gates verdes e revisão do resultado concreto, planejar promoção e retorno em produção. Acrescentar aqui horários UTC, comandos, links, responsáveis e status real de cada etapa. Nenhuma correção desta rodada deve ser descrita como publicada antes desse registro.
