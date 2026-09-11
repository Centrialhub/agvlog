# Recebimentos paginados e devolução além de 500 — UI — 2026-09-10

`ReceivablePaymentsPanel` substitui o histórico e o seletor limitados a `context.payments` em `ReceivableFinancialDialog`. Consulta `get_finance_receivable_payments_page` por cliente validado do coordenador, com 50 linhas, total integral, revisão própria e geração de recuperação após 40001. Não calcula saldos a partir das páginas.

A seleção para devolução é uma linha explícita consultada, com revisão financeira observada separada da revisão da lista. O comando continua usando `expected_revision` do contexto financeiro. Consulta pendente/erro, mudança de página, bloqueio ou alteração dessa revisão elimina a seleção e exige nova conferência. Dinheiro devolvido continua exigindo declaração e comando validado pelo backend.

Ações LegacyReceivableAssociation e ReceiptAllocationCorrection permanecem disponíveis sob **Conferir vínculos**. Não são montadas 50 consultas auxiliares ao abrir uma página. Autoria/motivo da correção já conhecida continuam visíveis no resumo. Invalidações dos comandos e ações foram integradas pelo coordenador.

## Verificação

- Quatro testes UI passaram: seleção na página 11 fora dos antigos 500, revisão financeira separada, invalidação da seleção, recuperação com cache infinito e carregamento auxiliar somente sob demanda.
- A fixture frontend real foi atualizada para `createReceivablePaymentsPageDatabase`, incluindo cadeia fiscal/créditos reais; transport e seleções usam o reader novo. Os 14 cenários existentes passaram (recebimento, correção recuperável, devolução, crédito de saldo, permissões e rejeições).
- Teste adicional cria 501 recebimentos por comandos reais, consulta o 501º na página 11 e registra sua devolução pelo formulário. Execução 72976 em andamento; ainda não afirmar aprovação deste cenário.
- ESLint dos quatro arquivos alterados passou. TSC sob coordenação do root, não executado nesta frente.

Arquivos: `ReceivablePaymentsPanel.tsx`, `ReceivableFinancialDialog.tsx`, `receivablePaymentsPanel.test.tsx`, `receivableFinancialFrontendDatabase.test.tsx`. Nenhum SQL, contrato/client root ou writer alterado. Nenhuma implantação remota.

Resultado da primeira execução de volume (72976): os 15 testes passaram, incluindo 501 comandos reais, prova de ausência do pagamento no contexto limitado, seleção da página 11 e devolução real; cenário de volume em 73,9 s. O processo terminou 1 por erro de comunicação do runner `Timeout calling onTaskUpdate`, não por assertiva ou SQL. Reexecução isolada com pool forks/maxWorkers=1 iniciada (88947), sem alteração do produto ou enfraquecimento dos testes.

O coordenador executou TSC integrado 92727: saída 0, sem diagnósticos, após os arquivos finais desta entrega. Os testes integrados reader/cliente/painel também passaram na rodada do coordenador. A reexecução de volume 88947 continua aguardada para resolver exclusivamente o erro do runner observado na primeira rodada.

Conclusão da execução de volume: 88947 repetiu os 15 testes aprovados, mas ainda saiu 1 por timeout do protocolo do runner. A preparação então passou a ceder uma macrotask a cada 25 comandos reais, mantendo todos os 501 comandos, valores e assertivas. Execução final 37914: **15 testes aprovados, saída 0, sem erros não tratados**; cenário de 501 em 64,96 s. O teste prova pagamento fora dos 500 do contexto, navegação até página 11, seleção/devolução pelo formulário, revisão financeira correta, 501 pagamentos originais preservados, saldo recebido de R$ 5,00 e 502 movimentos bancários após a devolução de R$ 0,01.

Destaque manual permanente restaurado no resumo de correção: faixa âmbar, rótulo Ajuste manual e autor/ID/motivo/data, sem depender de abrir consultas auxiliares. Quinto teste de painel passou; lint limpo. O TSC 92727 anterior à alteração visual passou; não foi iniciada outra execução nesta frente. Nenhum processo de teste permanece ativo.
