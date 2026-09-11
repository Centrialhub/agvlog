# Revisão integral do bloco financeiro013543→033918

10/09/2026. Treze SQL lidos integralmente; hashes exatos em finance-production-block-013543-033918-hashes-2026-09-10.json. Parecer: instalação sequencial INATIVA aceitável, condicionada aos guards originais, dependências e ausência de colisões no catálogo atual. Não é aprovação para ativar módulo/worker. Sem aplicação, PG ou TSC nesta revisão.

| Ordem | Migration | Dependências e efeitos imediatos |
|---|---|---|
|1|013543 grupos conciliação|Requer entries/imports/verifications/identityreviews, bank_entry_active, reverse_identity_review e audit_events. Cria grupos/reversões imutáveis, GINarrays, contexto e comandos. Só vincula fatos, não cria dinheiro. Patch bloqueia reversão de identidade com grupo ativo.|
|2|014238 workspace|Requer grupos/reversões e fontes anteriores. Leitor por conta da importação, páginas20/count completo; exclui membros já conciliados. Ainda usa movimentos raw nesta versão; patch ativo posterior obrigatório antes void.|
|3|015331 histórico|Leitor paginado20 com snapshots preservados e issue atual; helpers internos semgrant. Identidade/arquivo/conta mudados invalidam prova exibida, não apagam grupo.|
|4|020543 OFX|Altera CHECKinput_rows para0..10000 e patches de caminho/parser/count; OFX vazio permitido, demais formatos continuam mínimo1. Não processa arquivo nem reimporta dados no DDL.|
|5|021404 conta nativa|Somente prova exata banco/agência/conta/tipo, hash e BRL do arquivo verificado. Conta ambígua/incompleta não é inferida. Não afirma cobertura de período. Helper raw semgrant, wrapper exige acesso.|
|6|022059 automático|Cria jobs e triggers futuros em verificações/movimentos, matcher exato referência/valor/data/sentido/conta. Nenhum backfill. CRON é agendado ativo se extensão presente; precisa pausa na MESMA transação para staged.|
|7|023208 status|Consulta estado real job/cron; não dispara processamento.|
|8|023911 período|Consulta diagnóstica bruto banco vs registrado, sem somar ambos; não infere abertura/saldo nem fecha período. Raw movements serão substituídos por proteção posterior.|
|9|024438 projeção recebimento|Requer comando183929 já com fiscalcontext012152. Novo AFTER INSERT liga comando/payment/transaction/movement por tenant; integra recebimento a entrada existente ou cria entrada; devolução cria saída. Sem backfill de pagamentos legados. Lockfiscal→finance antes grafo. Com stagedfalse, receive/reverse passam a falhar atomicamente no trigger até ativação.|
|10|025658 correção alocação|Requer024438; cria correção imutável, modifica recalc/ledger/snapshot/command/capacidade e auxiliares fiscais existentes. Corrigir desfaz aplicação ao título e libera capacidade, preservando movimento/pagamento; cash_changedfalse. Admin+finance. Sem alteração automática de títulos antigos.|
|11|030634 devolução explícita|Patch somente comando; nova reverse exige refund_kind money_returned. Replay histórico preservado. Não confundir com correção de alocação.|
|12|032730 rastreio|Leitor paginado20; requer créditos011121, correções025658, links024438 e fontes de pagamentos. Histórico preservado, não concilia.|
|13|033918 transferências|Cria par de movimentos com duas datas e contas distintas/ativas, mesma quantia, IDs únicos e FKtenant. Atomicidade evento+command+duas pernas. Reauth após lock. Novo movimento avulso transfer é recusado; replay antigo mantido. Não movimenta conta bancária externa.|

## ACL e execução staged

Novas tabelas financeiras RLS/can_access, SELECTauthenticated/service_role; nenhum DML concedido a esses papéis. Helpers de worker/snapshot interno sem EXECUTE público. API pública invoker delega para helper definer explicitamente autorizado, search_path vazio. Nenhum arquivo redefine can_access. Nenhum backfill financeiro neste bloco. CREATE INDEX e ALTER CHECK podem adquirir locks/validar dados existentes, portanto aplicar com timeout e transação do coordenador.

022059 registra finance-bank-reconciliation-every-minute. Worker valida memberships/driver diretamente e NÃO consulta can_access: false não suspende processamento. Apóscron.schedule e ANTESCOMMIT, desativar job na mesma transação pelo mecanismo revisado do coordenador; conferir active=false. A existência de0jobs hoje não é contenção. Triggers apenas enfileiram/reabrem; não executam matcher por si. Fiscalcron012756 também deve continuar parado.

## Pendência de ativação identificada nesta leitura

013543 reconcile_bank_group/reverse_bank_reconciliation e025658 correct_receipt_allocation verificam autorização antes de esperar advisorylock, sem reauth explícita antes replay; no caso reverse/correction também há mutações após espera. Conferir corpos EFETIVOS ao final e corrigir/testar revogação concorrente se ainda presentes. Esta versão intermediária NÃO é declaração de segurança final para liberarcan_access. Transfer033918 já faz reauth após lock. Não modificar migrations históricas no meio do rollout sem revisão/hash.

## Pré-condições acionáveis

Antes013543: to_regprocedure para bank_entry_active(uuid,uuid), reverse_identity_review(jsonb), audit_events(uuid,jsonb); to_regclass para statement_verifications/identityreviews/reviewreversals; grupos/reversões devem estar ausentes. Antes020543: CHECKfinance_statement_imports_input_rows_check existente e needles de intake_statement/statement_original_ready presentes. Antes022059: reconciliation_context/evidence_issue/native_statement_account existem, jobs ausentes e cron conhecido. Antes024438: receivable_financial_commands/payment/transaction com UNIQUEtenant,id, comando apply_receivable_financial_command com _lock_receivable_financial_graph e payload esperado. Antes025658: recalc/guard/snapshot contêm needles completos, créditos/fiscalhelpers instalados. Antes033918: record_movement presente, internal_transfers ausente. Cada patch original falha fechado se needle obrigatório mudou; não remover guard.

Pósbloco: comparar hashes/objetos, RLS/ACL diretas; can_access continua false; cron financeiro/fiscal activefalse; nenhum evento/movimento/pagamento criado pela instalação; finance_project_receivable_command e filas habilitados com destino íntegro. Não usar COUNTzero como única prova de acesso/pausa.

## Evidência já existente

financeInternalTransfers.test.ts usa ledger real e prova duas pernas uma vez, tenant/driver/misto, referência duplicada, rollback de falha tardia e bloqueio de avulso. financeReceivableMovementProjection.test.ts cobre projeções/correção/refund reais; expenseStatementJourney cinco testes conecta saída/lote/OFX/verificação/conciliação real. periodMoneyBankPackage e unloadingBankPackage cobrem fechamento/recebimento compartilhado com fluxo real. Harness nativo de pacote e descarga já usa esses corpos, com limites de fixtures documentados nos respectivos QA.

financeOfxWorkflow testa parser/worker real com adaptadores de persistência simulados; não contar comoSQLprod/AUTHhosted. Não executei testes novos nesta revisão; as evidências anteriores não substituem preflight atual, cronpausado ou teste da revogação citada.

## Interface com dono da cadeia motorista

134948 define canonical_trip_costs e altera builder; concluir financeiro anterior esperado antes gate211800. 211800 substitui expense_options com filtro de custódia porém rawmovements;220847 deve ser último nessa função para restaurar active_movements preservando gate. 213156 renomeia record_settlement_payment para wrapper dequarentena: instalar após versões financeiras finais desse writer para não sobrepor guard. Dono motorista deve coordenar estes três pontos com root; não reexecutar44arquivos por esta revisão.
