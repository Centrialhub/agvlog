# Registro canônico de pagamento de acerto

Data: 2026-09-10. Migration local `20260910133421_finance_settlement_payment_recording.sql`, criada pela CLI. Nenhuma aplicação remota.

## Contrato e resultado

`public.record_finance_settlement_payment(_payload jsonb)` é um adaptador invoker para comando privado definer. Payload estrito: `version=1`, `tenant_id`, `request_id`, `settlement_id`, `movement_id`, `amount_cents` inteiro positivo até 99999999999999, `method` pix/ted/cash/other e `reason` com 10–2000 caracteres. Não aceita URL arbitrária de comprovante, conta, data ou autorização de sobrepagamento fornecidas pelo cliente.

Usa uma saída existente, mesma empresa/motorista, direção out e natureza diferente de transferência. Data de pagamento é meio-dia de `occurred_on` em America/Sao_Paulo; conta e referência são derivadas da movimentação. O comprovante continua na movimentação, com seu caminho preservado no evento financeiro.

A mesma transação insere pagamento, vínculo de capacidade, atualiza totais/status do acerto, acrescenta o item already_paid aplicável, recompõe folha editável, grava auditoria financeira e evento histórico do acerto e preserva o resultado em finance_commands. Replay exige mesmo ator e payload e retorna o resultado original. Nenhum movimento, linha bancária, despesa, adiantamento ou crédito de remuneração é criado.

## Regras preservadas

- Autoriza financeiro e rejeita motorista, inclusive perfil misto; revalida acesso após esperas.
- Ordem finance advisory → períodos da empresa → acerto → entradas ordenadas por período e ID, compatível com lifecycle 133352.
- Acerto deve estar aprovado/pago, atualizado e ter motorista identificado; dívida deve obedecer ao contrato monetário.
- Saldo deriva da soma dos pagamentos reais válidos, não de caches de total pago/saldo. Sobrepagamento é rejeitado.
- Capacidade continua compartilhada com outros acertos, pagáveis e gastos; reembolso já alocado não permite consumir novamente a saída.
- Folha protegida vinculada ao acerto ou ao motorista/data impede pagamento até revisão; entrada protegida dentro de folha editável também impede.
- Cancelamento sem pagamento de título não bloqueia perpetuamente; cancelamento com pagamento ativo continua exigindo revisão.
- Duas entradas editáveis sobrepostas do mesmo empregado não recebem o mesmo pagamento duas vezes: comando exige revisão explícita.
- Nas folhas editáveis elegíveis, somente `driver_settlement_payment/already_paid`, com source_table driver_settlement_payments e source_id payment.id, é acrescentado. Salário, manuais e employee_advances permanecem intactos.

## Verificação

`npx vitest run src/test/financeSettlementPaymentRecording.test.ts`: 26 testes SQL passaram em PGlite. ESLint passou. A fixture usa formatos/defaults reais da baseline, a migration de vínculos, o lifecycle 133352, query 133355, o novo comando e o cutoff 133700. Após cada sucesso/replay executa `SET CONSTRAINTS ALL IMMEDIATE`, provando o vínculo exigido pela restrição diferida antes de encerrar o teste.

Cobertura: replay; uma única origem de dinheiro; data/conta/referência derivadas; cache incorreto versus pagamentos reais; pagamento integral e rejeição de excedente; preservação de salário/manuais/adiantamento; protected approved/closed/under_review e entry protegida; proteção por acerto fora do mês do pagamento; cancelada sem/com pagamento; sobreposição; capacidade já usada por despesa; acerto desatualizado; acesso de outra empresa/motorista/perfil misto; payloads inválidos; conflito de chave; dívida NaN/Infinity/fora de limite; falha posterior de recomposição provocada, com rollback de pagamento, vínculo, totais, eventos e item da folha.

Arquivos de verificação: `src/test/financeSettlementPaymentRecording.test.ts` e `src/test/helpers/financeSettlementPaymentDatabase.ts`.

## Limites

Não altera a composição dos reembolsos, desfaz pagamentos, resolve sobrepagamentos históricos ou reabre folhas. O comando registra uma parcela contra uma saída existente; partições adicionais são comandos independentes. CPF/nomes duplicados de cadastros de empregados e pagamento de folha sem associação explícita ao acerto ainda pertencem à integração de fontes.

A fixture não instala o trigger legado de sincronização de financial_obligations nem todo o schema de produção; a migration não o remove. É necessário ensaio de implantação com essas dependências. Concorrência nativa foi verificada separadamente para vínculos e lifecycle, mas esta entrega não afirma ensaio nativo do novo comando integrado completo.
