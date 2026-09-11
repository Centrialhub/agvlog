# Cancelamento de custo canônico sem liquidação — 10/09/2026

Implementação local: migration `20260910175641_finance_unpaid_expense_cancellation.sql`. Não aplicada remotamente.

O comando `cancel_finance_expense({version:1,tenant_id,request_id,expense_id,revision,reason})` preserva o item original, registra evento append-only com autor/motivo/snapshot, cancela seu título aberto exato e marca acerto editável para recálculo. Não cria/exclui movimento, pagamento ou receita. Primeiro incremento irreversível: eventual substituição terá novo lançamento e comando de vínculo próprios; não há restauração automática de obrigação.

A revisão vem de `finance_private.expense_cancellation_context(tenant,expense)`; wrapper público e histórico são propriedade da migration 175733. O snapshot inclui origem imutável do pedido (payee_type), item, lote, destinatário, títulos pela origem, pagamentos, alocações, associações, acertos, folha, adiantamentos, obrigações e dependências do fechamento. O comando serializa no advisory financeiro, trava períodos/viagem/acertos/folha/item/beneficiário/títulos, revalida acesso e revisão após espera. Motorista, inclusive perfil misto, não recebe acesso.

O título deve ser único pela origem `finance_expense_items/id`, integral, pending/approved e coerente com destinatário escolhido no pedido original. Status paid sem pagamentos também impede. Destinatário motorista é independente do fornecedor do estabelecimento. Sem pedido original rastreável, a operação fica em revisão explícita.

Bloqueios: qualquer histórico de pagamento/alocação/vínculo financeiro; descarga; associação legada/manutenção/estoque, inclusive histórico desfeito; folha/adiantamento materializado; acerto protegido; obrigação materializada distinta; fechamento afetado. O mesmo resolvedor de fonte congelada é chamado na prévia e na execução. Custos sem conta identificada em corte fechado são tratados conservadoramente; não há dispensa por flag.

Consumidores ajustados:

- recorded_costs e recorded_cost_summary mantêm original e cancelled=true, excluindo valor dos totais ativos.
- canonical_trip_costs e settlement_expense_context usam a visão única active_expense_items para efeitos futuros.
- Helpers de elegibilidade e revisão de associação legada, mão de obra, peça direta e aquisição incluem cancelamento; reserva compartilhada e alocações têm guarda no banco.
- Guardas impedem reativar título cancelado e criar nova obrigação/pagamento/alocação, acerto, folha ou adiantamento a partir do custo cancelado.
- list_expenses continua histórico completo; extensão de totais ativos/cancelados é feita por 175733, sem subtração no navegador.

Validação: 9 testes PGlite próprios em financeExpenseCancellation.test.ts, incluindo comando real de lote→cancelamento→replay, viagem com destinatário motorista, KPI agregado, título duplicado, paid inconsistente, autor/perfil misto, revisão obsoleta, imutabilidade, alocação existente, fonte fechada e claim existente. Os 3 testes reais do reader 175733 também passaram nesta integração. ESLint dos arquivos próprios passou. Fixture reutiliza os escritores reais de custos e associações; alocação, claim e fechamento nos casos negativos são estado histórico semeado, não alegação de execução de seus respectivos comandos de criação/fechamento. PostgreSQL nativo e corridas ficam com o agente de validação.

Pendências da meta completa: correção com dinheiro já pago/recebido, descarga reembolsável, dependências de folha/acerto protegidos, manualexpense (origem própria), substituição auditada e correção da fonte legada protegida. Este incremento não remove nem resolve essas dependências.
