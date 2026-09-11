# Classificador e revisão durável do corte legado — 2026-09-10

Implementado em `20260910163116_finance_legacy_cut_reviews.sql`, criada via CLI local. SHA256: 6baa25c2e21533aae152f6c61fbda8ecb891541888b133f2c325dd546bc21e0d.

**14 testes SQL/PGlite aprovados** em `src/test/financeLegacyCutReviews.test.ts`; parser `legacyCutReviewSchema` real valida os envelopes. ESLint sem erros/avisos. Nenhum PostgreSQL nativo ou remoto foi iniciado para esta fatia. A rodada anterior de peças terminou com servidor parado.

## Contrato e caminho positivo

`finance_private.legacy_cut_review_status(tenant,account,from,to)` e `get_finance_legacy_cut_review` retornam revisão determinística, current, approved, status, approval, history, blockers e manifesto completo. `review_finance_legacy_cut` aceita pedido estrito versionado, revisão esperada, motivo e declaração `sources_reviewed:true`. Somente owner/admin combinado com can_access pode registrar revisão; operador pode ler. Driver e usuário com papel misto continuam excluídos.

Conta sem legado tem caminho positivo explícito. Recebimento com vínculo canônico validado e sua projeção bancária também pode ser aprovado. Isso é revisão da integração das fontes; não substitui abertura, cobertura, conciliação ou fechamento. O comando não cria dinheiro, baixa ou obrigação.

A tabela `finance_legacy_cut_reviews` é append-only, conserva snapshot, autoria, motivo e revisão; pedidos repetidos usam finance_commands. Histórico completo das decisões aparece no envelope, sem snapshots repetidos. Alteração das fontes muda a revisão e transforma a decisão anterior em needs_review. Nenhum relógio integra o hash do manifesto.

## Classificação efetiva

Enumera sem LIMIT/paginação nove famílias históricas: receivables_payments, receivable_payment_reversals, payables_payments, driver_settlement_payments, closing_report_payments, load_payments, employee_advances pagos, payroll_entry_items already_paid, bank_transactions. Manifesto registra também movimentos e links/reversões canônicos/legados, inclusive arrays vazios. A consulta de integridade 151011 é executada para detectar corrupção de data, valor, conta, pais e aliases; ela não é usada como substituta do manifesto bruto.

Valida vínculo de recibo canônico pelo pagamento, command_id, bank_transaction_id, direção, conta, dia SP e capacidade. Pagável exige também payable_id e valor integral, com vínculo não revertido. Recibo legado exige pagamento/receivable_id, valor integral e vínculo ativo. Refund exige comando e transação exatos. Aliases banco/carga/fechamento exigem pai já validado, mesma conta/dia/valor, sem inconsistência detectada; não contam dinheiro duas vezes. Soma das fontes diretas por movimento não pode exceder capacidade. IDs de movimentos ficam explícitos por fonte.

Fontes sem data ou com conta ausente/fora do tenant bloqueiam todas as contas potencialmente afetadas. Nunca se somam como caixa. Fonte de conta válida diferente é excluída do corte; fonte fora do intervalo com data finita não bloqueia o intervalo. O manifesto bruto é tenant-wide: alterações em fontes fora do corte podem invalidar a revisão conservadoramente. Inclui payroll inteiro como evidência, embora somente already_paid participe da classificação. Essa abordagem favorece segurança e precisa otimização de escopo antes de grande volume.

## Testes executados

Positivo vazio com replay/sem dinheiro; operador/misto; mudança de movimento invalida aprovação e rejeita revisão obsoleta; fonte sem data/conta; tenant estrangeiro/imutabilidade; recibo+alias banco positivo e alteração de valor; 31 fontes sem truncamento; infinity/NaN/conta estrangeira; capacidade compartilhada; associação legada ativa versus reversão; command_id incongruente não suprime fonte. Histórico permanece append-only.

Fixture usa tabelas baseline e funções reais de ledger/integridade. Movimentos são registrados pelo comando real. Links/recibos históricos são seeds diretos em definições reais com grafo referencial restrito; não equivale a uma execução end-to-end de receive_finance_receivable. Testes de corrupção alteram esses seeds para verificar leitura defensiva. Não houve desativação de guard no produto.

## Limites e integração seguinte

- Driver settlement payments, adiantamentos pagos e already_paid ainda exigem resolução específica mesmo quando existe uma possível cadeia por IDs. Bloqueio conservador explícito, sem afirmar que desapareceram ou que representam dinheiro novo.
- Reversões de vínculo pagável distinguem origem: canonical vira projeção revertida sem reserva monetária; legacy_adoption preserva o pagamento real e permanece pendente até nova associação. Ambos mantêm o histórico e não geram outra saída.
- Não existe reversão da revisão nesta fatia. Nova revisão fica no histórico e a decisão atual é a mais recente; alterações do manifesto invalidam a anterior.
- Concorrência review/fechamento/writers precisa execução integrada nativa com A. A migration instala trigger de fonte fechada quando `guard_closed_financial_source()` existe; `guards_ready` de A deve exigir esse trigger. Fixture isolada não possui A e não prova esses guards.
- Nenhuma conclusão de upgrade remoto ou plataforma inteira. O gate completo exige o grafo real e mapa histórico previamente documentado.

## Ampliação de integração

`financeLegacyCutCorrectionIntegration.test.ts` passou usando os comandos reais receive → correct_finance_receipt_allocation → receive com o mesmo movimento. O manifesto inclui o evento de correção, a projeção antiga não consome capacidade novamente e o corte é aprovado com um único movimento. Esse caso usa a cadeia operacional/recebível existente; não foi apenas seed de tabela de correções.

Refund deriva conta da própria transação bancária por ID e tenant, conservando seu effective_at como dia SP. Regressão confirma que saída em outra conta/mês aparece somente no corte real. Integridade de devoluções cross-account ainda pode exigir revisão conservadora pela consulta 151011, que permanece independente.

A integração com abertura/cobertura/worker de conciliação/retention/guards reais passou quatro casos em accountPeriodCloseIntegrated.test.ts: close/replay/reopen positivo; proteção de dinheiro retroativo e nova revisão; movimento e bank_entry reais conciliados; julho→agosto contíguos e predecessor bloqueado. A consulta64923 passou pelo accountPeriodEvidenceSchema real: snapshot_matches_revision e dependencies_match verdadeiros, snapshot idêntico após reabertura. Essa prova usa fixture de esquema restrito; não afirma plataforma completa nem cron externo.
