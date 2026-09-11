# PostgreSQL nativo: peças de compra direta e mão de obra

Execução final 2026-09-10: **18 casos aprovados**, PostgreSQL 17.11, handle 4799 encerrado com exit 0 e servidor descartável parado. Nenhuma alteração remota ou SQL de produto.

- Core 61702 SHA256: a9c7a78cd4a0a3434332b4aa4b23f7f4a79d24c76209d10361c130c92e2a1adf.
- Reader 61828 SHA256: 20933142fa6cf0974c26652300d2b69323681b2fb477ba9f6149c5e387261a1f.
- Regressão 60950/61129: mesmos hashes da rodada anterior, registrados integralmente no log.

Runner: `PG_QA_SUITE=finance-maintenance-direct-part node --experimental-strip-types scripts/test-delivery-concurrency.mjs`. Casos em `scripts/test-finance-maintenance-direct-part-native-cases.mjs`. Log em `node_modules/.cache/qa-postgres/finance-maintenance-direct-part-native-2026-09-10.log`.

Os 13 casos de mão de obra foram reexecutados com claims compartilhados instalados. Cinco cenários adicionais cobrem disputa peça × mão de obra nas duas ordens, replay, dois pedidos de peça, revisão obsoleta após alteração da quantidade, revogação após espera, proteção de OLD tenant da OS e da peça, conflito com movimento de estoque e liberação após reversão. Readers e resultados foram validados com os schemas Zod reais.

Dois casos usam dinheiro efetivamente preenchido: custo integralmente alocado a movimento de saída pelo comando de lote e custo com título aprovado em fixture, pago pelo comando apply_finance_payable_movement. Associação e reversão preservaram JSON integral de movimentos, alocações, títulos, pagamentos e links de pagamento. Não houve apenas comparação de conjuntos vazios.

As sessões concorrentes observaram bloqueio real antes da liberação e confirmação/rollback. Fonte e autoria não puderam atravessar a espera com revisão/acesso obsoletos. A reserva compartilhada preservou um único titular por custo; o segundo comando foi rejeitado.

Limites: fixture usa tabelas baseline e funções financeiras reais, mas não instala todo grafo de FKs/plataforma Supabase. Rota é vazia, status inicial de aprovação do título é seed; pagamento é comando real. Não prova migração integral sobre histórico remoto ou conciliação de extrato. Estoque foi inserido diretamente na tabela real, sem simular interface operacional. Rodadas anteriores 21355 e 71501 falharam em seeds (tentativa de editar custo imutável e categoria service fora do filtro do leitor); correções exclusivamente no harness, registrando documento e categoria maintenance no comando original.
