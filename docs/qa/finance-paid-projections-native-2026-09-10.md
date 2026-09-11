# Projeções pagas — PostgreSQL17.11 nativo

2026-09-10. Suite finance-paid-projections; script scripts/test-finance-paid-projections-native-cases.mjs. Sem remoto, sem mudança ao SQL core.

Migration72624 validada após correção do autor: SHA256 `81a04b56856933edce8341a07743d5b977e7a688b877d6cafebaf4fe680d4394`. Não usar hash inicialf69683 como prova desta rodada. Patch restringe exceção INSERT a paid/already_paid e conserva guarda para advance approved com paid_at.

## Matriz

1. Status paid sem pagamento continua advance_not_fully_paid.
2. Comandos reais de movimento e apply_finance_payable_movement criam duas parcelas em contas/dias diferentes. Resolvedor mantém ambas; manifesto do corte seleciona só footprint correspondente.
3. Item already_paid resolve adiantamento sem acrescentar capacidade ao movimento já reservado por pagamento.
4. Alteração de valor concorrendo com congelamento da conta espera lockfinance e é rejeitada após congelamento, preservando origem.
5. Inserção tardia de alias válido passa flush de constraint, conserva movimento e snapshot.
6. Revogação de autor antes do flush rejeita e rollback remove item pendente.
7. Alias tardio de adiantamento sem pagamento não passa fechamento.
8. INSERT approved com paid_at preenchido não escapa do guard original após72624.

## Fixture e limites

Schemas reais da baseline, abertura/cobertura/guards/B170213, funções reais de capacidade e comando payable, visão ativa43833 e core72624. Como factory createPaidProjectionChainDatabase, inclui partes explícitas de migrations sem todo grafo de FKs externos. Fonte de empregado/folha é semeada; não executa geração/aprovação completa da folha.

Congelamento é fixture histórica explícita: snapshot{} inserido com ticket do guard e dependência real de movimento. A corrida exercita locks/guards do congelamento, **não** demonstra elegibilidade pelo closeRPC real nesta nova combinação. Testes positivos de closeRPC com evidência foram executados na suíte anterior; não transferir essa prova automaticamente para72624.

Revogação é no flush da mesma transação. A disputa nativa observada é alteração da origem contra congelamento. Reversão canônica concorrente com fechamento e geração da folha concorrente permanecem fora desta rodada bounded. Não há alegação de cobertura completa do deploy ou do legado.

Primeiro74574 terminou com5casospassados e erro de fixture: revogação usava origem duplicada de folha, corretamente rejeitada como fonte inválida antes do acesso. Corrigido somente fixture para origem distinta com pagamento congelado. Rodada28676: **8 testes passaram, exit0, PostgreSQL parado**. Hash final confirmado no log. Log node_modules/.cache/qa-postgres/finance-paid-projections-native-2026-09-10.log.
