# Recebimentos paginados sem limite de500

Migration `20260910202421_finance_receivable_payments_page.sql`. Leitor separado; não altera `_receivable_financial_snapshot`, seus500 pagamentos, revisões dos comandos ou writers existentes.

## Contrato

`get_finance_receivable_payments_page(_tenant_id uuid,_receivable_id uuid,_page integer default1,_expected_revision text defaultnull)` retorna versão1, tenant_id, actor_id=auth.uid(), receivable_id, page/page_size50/total, revision MD5 e rows no formato de pagamentos do contexto financeiro existente. `credit_id` e `allocation_correction` são sempre presentes e nullable.

Rows preservam pagamento original, centavos, received_at, método, notas, conta/nome, anexo, reversed_at/reversal_reason, crédito e correção com ator/motivo. Reversed_at mantém a semântica do contexto existente (registro da reversão), não substitui effective_at em relatórios econômicos. Não remove pagamentos por terem sido revertidos, creditados ou corrigidos.

Auth can_access é verificada em toda chamada; título precisa pertencer ao tenant. Lookup de conta, reversão, crédito e correção usa tenant+IDs. Public invoker chama definer privado autorizado; o helper de linhas não recebe grant e nenhuma tabela ganha acesso adicional.

## Consistência

Ordem received_at DESC,id ASC. Página>1 exige revisão; qualquer revisão divergente retorna40001 finance_history_changed. Revisão considera o conjunto inteiro dos campos retornados, incluindo mudança do nome da conta, reversões, créditos e correções, usando hashes compactos por linha ordenada. Não depende de apenas contagem/maxID nem do subconjunto da página. O SQL STABLE mantém as leituras da chamada no mesmo snapshot.

Centavos seguem o contrato Number existente (inteiros positivos até99999999999999). Dados legados não finitos, com fração de centavo, data inválida ou fora desse teto retornam23514 finance_payment_history_invalid, sem arredondamento silencioso. Isso é distinto do reader genérico de versões201323 que usa strings e permite valores maiores.

## Testes

`npx vitest run src/test/receivablePaymentsPage.test.ts`: **6 passaram**. Todas as respostas usam o parser real `receivablePaymentsPageSchema`. ESLint passou no helper e teste.

-505 pagamentos históricos,11 páginas, todos IDs únicos; o contexto original continua retornando500, comprovando separação de escopo.
-Pagamento parcial e devolução por comandos reais preservam a linha original e invalidam a revisão anterior.
-Correção de alocação real aparece com autoria/motivo; mudança de nome da conta invalida a revisão.
-Cancelamento fiscal real após recebimento gera crédito preservando o pagamento, sem confundir crédito com devolução.
-Inserção posterior com data econômica anterior invalida a página seguinte com revisão antiga.
-Página/revisão inválidas, título inexistente, empresa alheia, motorista misto e helper sem grant.

Para volume, a fixture usa `withLegacyReceiptSeed` existente, desabilitando somente o guard de exigência de comando na carga histórica e restaurando-o antes da leitura; não afirma emissão de505 comandos canônicos. Os casos de parcial/devolução/correção/crédito usam os comandos reais da cadeia. Factory `createReceivablePaymentsPageDatabase` deriva da integração atual de recebíveis e fiscal.

SHA SQL: `e0873d2419bb9663e6ddc2e3483e648c0366852ca5b0794fb38e7834557bdd7b`.
SHA factory: `bc191fc257f4eb0cf0d35d6a84e1292149c3b629a60c3e1ea0584a760059fd44`.

Root revisou SQL antes do congelamento sem solicitar alterações. Suplemento nativo foi proposto ao agente responsável. Nenhum PostgreSQL nativo, TSC ou aplicação remota executado nesta subtarefa. Seleção/devolução pela interface de pagamento após a primeira página pertence à integração UI coordenada pelo root.
