# Cancelamento auditado de despesa manual sem liquidação — 10/09/2026

Migration local `20260910181257_finance_unpaid_manual_expense_cancellation.sql`, criada pela CLI. Não aplicada remotamente. SHA256: `524e93c21de27fcb3bb5b46720bc8e340304efc6d2be086460e249e3d19cb50a`.

A origem é `finance_commands(action=record_manual_expense).request_id`, ligada pelo `result.payable_id`. Não existe item de lote para essa fonte. O comando público recebe `version:1,tenant_id,request_id,payable_id,revision,reason`; retorna esses IDs, `original_request_id,cancellation_id,amount_cents` string, `confirmed:true,cash_changed:false`. Helper `manual_expense_cancellation_context(tenant,payable)` fornece snapshot, revisão e impedimento. Wrapper de prévia é integração 181549 do root.

A transação registra `finance_manual_expense_cancellations` append-only, cancela o título exato e emite `manual_expense_cancelled` (entidade payable). Preserva comando original, valor original, comprovante e histórico; não cria `finance_expense_items`, movimento, pagamento ou obrigação substituta. Não existe reversão nesta versão: nova substituição auditada continua etapa própria.

Exige exatamente um comando original, IDs e valor íntegros, destino explícito, origem manual sem nova origem/trip/driver/load/vehicle, datas válidas e título pending/approved com paid_amount zero e paid_at vazio. Pagamento ou vínculo histórico, alocação original, descarga, materialização em lote/folha/adiantamento/acerto/obrigação e período congelado bloqueiam. Status paid sem pagamento não é considerado dívida disponível para cancelamento.

`recorded_costs` mantém payable_id como ID histórico e `recorded_cost_summary` mantém request_id como antes. Ambos passam a usar o evento de cancelamento: cancelled isolado no título fica `needs_review`, o resumo invalida totais e não oculta silenciosamente o gasto. Nenhuma dedução de valores acontece no navegador.

Guards por ID impedem reativar ou apagar título cancelado e criar dependentes futuros. Retenção de comprovante original permanece ativa após cancelar. Comandos seguem advisory finance→períodos→entradas→fornecedor→título e reautorizam após espera. Row triggers usam tentativa não bloqueante de advisory, erro `40001 finance_dependency_busy`, pois writers legados podem já possuir row lock. A mesma correção é aplicada à função canonical anterior por patch nesta migration; 175641 permanece intacta.

Validação: 9 testes PGlite próprios em `financeManualExpenseCancellation.test.ts`, mais os 3 testes reais de prévia/parser `manualExpenseCancellationReaders.test.ts`. Cobrem escritor manual real com comprovante, cancelamento/replay, histórico e KPI, título cancelled sem evento, stale review, mixed driver, paid inconsistente, origem duplicada, pagamento histórico, adiantamento existente/futuro, retenção e bloqueio de fonte fechada. ESLint próprio passou. Pagamento/adiantamento/fechamento negativos usam estado histórico semeado; não alegam execução dos respectivos comandos completos. Prova de concorrência PostgreSQL nativa, especialmente row→finance legado versus finance→row de cancelamento, cabe ao agente de validação.

Limitações explícitas: custos com pagamento, reembolso/descarga, reversões financeiras, obrigações com dependências e substituição auditada não estão resolvidos por este comando. Fonte sem conta em período congelado segue o resolvedor conservador existente. Correção desses casos permanece na meta financeira completa.

## Integração de auditoria manual (182406)

A consulta base ainda não classificava `expense_cancelled` nem `manual_expense_cancelled` como intervenções manuais. Migration nova `20260910182406_finance_expense_cancellation_manual_audit.sql` inclui ambos nos dois pontos da função `audit_events`: classificação e filtro `manual_only`. Nenhuma migration congelada foi alterada.

O quarto teste de `manualExpenseCancellationReaders.test.ts` executa os dois escritores reais (lote e manual), os dois cancelamentos e consulta `list_finance_audit_events` com `manual_only:true`. Confirma entidade/ID, autor/nome, motivo, timestamp, contagem manual, permanência do mesmo ID após replay e bloqueio de remoção do evento; motorista continua sem acesso. Todos os 4 testes do arquivo passaram, assim como ESLint. Não foi iniciado TSC nem PostgreSQL nativo nesta etapa.
