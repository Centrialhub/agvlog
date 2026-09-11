# Revisão do bloco financeiro 034731 → 124716

Revisão local e somente leitura de oito migrations (índices 38–45 do plano informado). Nenhum SQL remoto/local executado, nenhuma alteração de produto, nenhum TSC/PG. Hashes recalculados dos arquivos e comparados com finance-production-forward-manifest-2026-09-10.json; todos coincidem. Lista completa no JSON irmão finance-production-block-034731-124716-hashes-2026-09-10.json.

## Conclusão de instalação inativa

Nenhum arquivo deste bloco cria cron, agenda job ou executa backfill econômico. Nenhum altera can_access. Os workers fiscal/bancário previamente instalados precisam continuar pausados, e o gate falso deve continuar preservado.

Isso NÃO torna o bloco inteiro inerte: 121937, 122628, 123613 e 124258 retiram imediatamente caminhos antigos e alteram guardas de tabelas existentes. São cortes de compatibilidade deliberados. Aplicar na ordem integral somente após conferir seus predecessores e assumir a indisponibilidade dos escritores antigos até a conclusão do módulo. Não extrair só partes DDL nem registrar como aplicada uma versão parcial.

## Matriz por migration

| Índice / arquivo | Efeitos e dependências | Acesso / staging |
|---|---|---|
| 38 — 20260910034731_finance_transfers_in_transit.sql | Cria finance_transfer_departures com FK para tenants/bank_accounts/finance_movements, unicidade tenant+outgoing e trigger preserve_event. Cria record_transfer_stage e pending_transfers + wrappers públicos. Writer grava saída/entrada efetivamente declarada, associa finance_internal_transfers e registra finance_commands/events, apenas quando invocado. Exige foundation de movimentos/transferências/comandos/eventos e preserve_event, contas/usuários existentes. | Tabela com RLS e SELECT authenticated/service_role; nenhuma DML direta para ambos. Policy authenticated chama can_access. Helpers SECURITY DEFINER/search_path vazio e wrappers INVOKER; EXECUTE authenticated, não service_role. Writer/reader negam com gate falso. Nenhuma migração de dados. |
| 39 — 20260910035550_finance_transfer_period_position.sql | Reader de posição por data efetiva, usando fatos conhecidos agora; depende de 034731 e finance_internal_transfers. Identifica trânsito e entradas/saídas sem par; frozen=false e bank_confirmed=false. | Só funções, sem writes. Helper guardado por can_access, wrappers INVOKER, authenticated only. Seguro como adição fechada; não é fechamento preservado. |
| 40 — 20260910120756_finance_manual_expense_recording.sql | Cria finance_manual_expense_evidence imutável e índice de receipt_path. Adiciona trigger BEFORE UPDATE/DELETE em storage.objects que impede modificar/remover receipts vinculados. Writer cria obrigação payables, opcionalmente apply_payable_movement sobre dinheiro existente; não cria bank_transaction. Depende de payables e respectivos campos, clients.active/is_supplier, storage.objects.metadata, foundation e apply_payable_movement/movement_used_cents de 002244. Reader busca saídas elegíveis. | Nova tabela RLS/SELECT authenticated+service_role, sem DML direta; helpers guardados, wrappers INVOKER, authenticated only. Com gate falso não cria despesas. Trigger de retenção independe do gate e afeta objetos já referenciados, inclusive operações do serviço/owner; tabela nova inicialmente vazia não faz backfill. |
| 41 — 20260910121937_finance_retire_legacy_payable_writers.sql | Revoga DML inclusive service_role em payables_payments; adiciona policies restrictive false para authenticated; trigger deferred AFTER INSERT exige bank_transaction_id NULL e vínculo finance_payable_movement_links para o mesmo pagamento/título/tenant; BEFORE UPDATE/DELETE congela histórico. Substitui corpo de três RPCs antigos por erro 55000 e revoga EXECUTE. | Corte ativo imediato mesmo com gate falso. Exige record_finance_manual_expense (120756), apply_finance_payable_movement (002244), reverse_finance_payable_link (003529), tabela de links e preserve_event. Checa também existência e linguagem PLpgSQL dos três escritores antigos. Não inspeciona retroativamente rows existentes nem valida histórico antigo. Novos inserts de outros escritores/serviços sem link passam a falhar no fim da transação. |
| 42 — 20260910122628_finance_bank_transaction_browser_boundary.sql | Revoga INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER de public/anon/authenticated em bank_transactions; policies restrictive false autenticadas. | Corte imediato do browser. Diferente de 121937, NÃO revoga DML de service_role. Escritores SECURITY DEFINER/owner e compatibilidade/importação continuam possíveis conforme seus guards. Não remove dados, não troca função. Exige tabela bank_transactions; confirmar RLS habilitada preexistente (ACL de qualquer modo revogada para browser). |
| 43 — 20260910123613_finance_retire_legacy_statement_import.sql | Exige intake_finance_statement(jsonb) e list_finance_statements(uuid,jsonb). Preserva OID/assinatura do import_bank_statement mas troca corpo por erro 55000 finance_legacy_statement_import_retired e revoga EXECUTE de public/anon/authenticated/service_role. | Corte imediato. Requer endpoint legado PLpgSQL exato. Originais devem passar pela nova área de extratos; com gate falso esse substituto permanece indisponível até ativação final. A migration não verifica scanner, Storage, Edge Function ou publicação frontend: são pré-requisitos adicionais de usabilidade. |
| 44 — 20260910124258_finance_retire_legacy_reconciliation.sql | Exige reconcile_finance_bank_group, reverse_finance_bank_reconciliation e get_finance_reconciliation_context. Troca sete corpos PLpgSQL legados por erro 55000 e revoga EXECUTE, inclusive _apply_match_amounts. Revoga DML de financial_matches inclusive serviço, policies restrictive e trigger imutável BEFORE UPDATE/DELETE. | Corte imediato. Preserva sync_financial_obligations intencionalmente. Não recalcula valores anteriores nem apaga conciliações. Escritores indirectos que chamem os RPCs antigos também passam a falhar. Exige financial_matches e preserve_event. |
| 45 — 20260910124716_finance_expense_cost_center_totals.sql | CREATE OR REPLACE list_expenses: totais completos por filtros/categoria/centro, páginas separadas; joins expense_items/batches/allocations, cost_centers, payables, unloading_charges, receivables, movements/events. Depende do leitor inicial 221405 e modelo de despesas. | Reader can_access, SECURITY DEFINER/search_path vazio. Sem GRANT/REVOKE: preserva ACL existente se função existe. ATENÇÃO: CREATE OR REPLACE criaria função ausente com privilégios default; confirmar existência e ACL antes de aplicar, não usar como substituto de predecessor faltante. Não tem semântica posterior de cancelamento; gate não pode abrir antes das migrations subsequentes que adicionam cancelamento/totais ativos. |

## Assinaturas legadas exatas necessárias

121937 exige as três:

- public.create_manual_expense(jsonb)
- public.register_payable_payment(uuid,numeric,timestamp with time zone,uuid,text,text,text)
- public.reverse_payable_payment(uuid)

123613 exige public.import_bank_statement(uuid,uuid,text,text,date,date,jsonb,jsonb).

124258 exige:

- public.run_bank_reconciliation(uuid,uuid,date,date)
- public.accept_financial_match(uuid)
- public.reject_financial_match(uuid,text)
- public.create_manual_financial_match(uuid,uuid,uuid,numeric,text)
- public.reverse_financial_match(uuid,text)
- public._apply_match_amounts(uuid,uuid,numeric)
- public.close_reconciliation_session(uuid)

Definições originais constam no baseline local (linhas 8129–8661 e 12844–13036), porém baseline não deve ser reaplicado: o histórico remoto usa identidade distinta e wrappers anteriores podem modificar os corpos legitimamente. Essas migrations de retirada checam assinatura/linguagem, não hash do corpo. Por isso devem vir DEPOIS das migrations operacionais que verificam hashes dos antigos RPCs, conforme plano já estabelecido.

## Verificações do coordenador antes/depois

Antes: confirmar versões predecessoras e assinaturas acima, colunas efetivas, RLS de tabelas existentes, ausência de colisões nas tabelas/triggers/policies novos, can_access constante false e os dois cron.jobs active=false. Conferir que list_expenses já existe com ACL autenticada e sem PUBLIC/anon/service execute.

Depois: duas novas tabelas (transfer_departures e manual_expense_evidence) têm RLS e somente SELECT dos papéis previstos; nenhum papel público/API ganhou escrita direta. Os onze escritores retirados (3+1+7) não têm EXECUTE de public/anon/authenticated/service_role; verificar os onze, incluindo o helper _apply_match_amounts. Triggers deferred/imutabilidade/retenção presentes; policies restrictive nos três conjuntos de tabelas. Os jobs continuam pausados e gate intacto. As RPCs novas não são teste de prontidão geral enquanto a cadeia não terminar.

Não se recomenda remover os cortes para manter UI legada funcionando durante staging: isso reabriria escritores concorrentes e contradiz a migração original. A estratégia é concluir instalação/cadeia/publicação de forma coordenada antes de liberar acesso, mantendo o layout de navegação com mensagem de indisponibilidade do financeiro.

## Limites desta revisão

Análise textual integral e SHA256, sem execução. Não atesta catálogo remoto nem valida runtime, dados históricos, scanner, políticas externas ou estado de sessões em curso. Nenhum job adicional exige rollout especial neste bloco.
