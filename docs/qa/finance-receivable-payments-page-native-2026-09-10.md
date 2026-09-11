# Paginação de recebimentos — PostgreSQL nativo

2026-09-10: **3 testes passaram em PostgreSQL 17.11**, sessão 14470 saída 0, cluster descartável encerrado. Nenhuma alteração de SQL de produto ou acesso remoto.

Migration `20260910202421_finance_receivable_payments_page.sql` SHA256 `e0873d2419bb9663e6ddc2e3483e648c0366852ca5b0794fb38e7834557bdd7b`, conferido antes da instalação.

- Runner: `scripts/test-finance-receivable-payments-page-native-cases.mjs`.
- Reprodução: `PG_QA_SUITE=finance-receivable-payments-page node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
- Log: `node_modules/.cache/qa-postgres/finance-receivable-payments-page-native-2026-09-10.log`.

## Provas

1. **51 recebimentos por apply_receivable_financial_command real**, de 1 centavo cada, sem semear pagamentos ou desabilitar seus guards. RPC pública autenticada retorna 50 + 1 registros; todos os IDs correspondem aos 51 comandos. Respostas passam pelo receivablePaymentsPageSchema real, empacotado com suas dependências por esbuild para o runtime Node.
2. Devolução real entre leituras invalida revisão anterior da página 2 com 40001 finance_history_changed, embora total 51 e conjunto/hash dos IDs dos pagamentos permaneçam idênticos. Recebimento original mantém a mesma linha JSON e aparece como revertido no leitor. Repetir exatamente o comando de devolução retorna o resultado original e não aumenta contagem de movimentos, transações bancárias ou reversões.
3. Tenant estrangeiro e título inexistente são rejeitados. Papel misto com motorista impede acesso. Revogação atual depois de obter revisão válida impede página 2 com aquela revisão.

## Limites

Suplemento usa fixture restrita de baseline e migrations financeiras reais de recebimentos, correções e devoluções. Não é instalação integral da plataforma ou teste de Auth remoto. Título e cliente são dados sintéticos owner; os 51 pagamentos e devolução usam os comandos reais. A rotina de fechamento não exercitada da fixture rejeita chamadas, sem stub de sucesso. Não foram repetidos crédito fiscal/correção de alocação neste suplemento; o autor possui testes PGlite próprios desses casos.

A execução inicial 21452 parou somente por importação Node de dependência TypeScript sem extensão. O harness passou a empacotar o schema real; nenhum contrato de produto foi modificado. A execução final repetiu os 3 casos e registrou encerramento do PostgreSQL.
