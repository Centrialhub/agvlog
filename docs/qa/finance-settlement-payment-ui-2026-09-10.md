# Registro de pagamento de acerto por saída existente

Implementação local candidata, 10/09/2026. Nenhuma alteração remota realizada por esta frente.

## Fluxo

`SettlementPaymentDialog`/`SettlementPaymentWorkspace` substituem o formulário legado de pagamento em `DriverSettlementDrawer`. O financeiro informa valor, seleciona saída existente, método e motivo, revisa os dados e confirma. A data do pagamento deriva da saída; o cliente não envia data independente, conta arbitrária, sobrepagamento ou criação de dinheiro. A consulta só acontece com valor válido; saldo e capacidade são conferidos novamente pelo comando no banco.

Contratos e adaptador próprios em `settlementPaymentContract.ts` e `settlementPaymentClient.ts` validam empresa, pedido, acerto, saída, valor e `cash_created:false`. Mensagens traduzem rejeições de saldo, motorista, revisão, folha protegida e folhas sobrepostas.

Pedido preservado em sessionStorage por empresa, usuário e acerto antes do envio. Resposta incerta mantém o mesmo identificador/conteúdo para retomada. Primeira rejeição SQL conhecida, incluindo 55000, libera edição; uma tentativa previamente incerta não é descartada por rejeição posterior. Armazenamento indisponível/corrompido bloqueia novo envio. Falha ou atualização de consulta esconde a capacidade anterior e impede confirmação.

O botão original de pagamento continua bloqueado por `needsRecalc`; uma correção chegando com o modal aberto também bloqueia novo envio via `allowNew`. A aba Pagamentos oferece retomada de pedido anterior sem permitir novo registro nessa abertura. A verificação de acesso usa FinanceAccessBoundary e o backend, sem autorização por metadados editáveis.

Após confirmação, invalida acerto/lista, vínculos/candidatos, capacidades financeiras, auditoria, projeções e os caches reais `payroll_periods`, `payroll_period`, `payroll_entries`, `payroll_entry_items` e custos. Esta frente removeu do drawer o uso do hook/formulário legado; a coordenação cuida do hook e do cutover SQL.

## Evidências

- 5 testes de workspace e 4 de cliente passaram: revisão, resposta perdida, valor inválido, armazenamento corrompido/indisponível, rejeição conhecida, preservação de pedido incerto, cache obsoleto, correção durante confirmação, identidade/valor/cash e rejeição 55000.
- 24 testes de `operationCorrectionFinanceFrontendDatabase.test.tsx` passaram, usando estado produzido por SQL real de três estágios de schema e novo workspace com adaptador simulado. O teste mantém a verificação de bloqueio antes de abrir e após correção com confirmação já aberta.
- ESLint passou nos arquivos da entrega e teste de regressão adaptado.
- TypeScript global passou na sessão 16939 antes da adição final de labels/invalidações; a coordenação fará a verificação integrada final.

## Limites

Não executa transferência nem registra saída nova. Não cobre sobrepagamento, dinheiro sem saída previamente registrada ou divisão da composição de despesas já atribuídas. Backend, integração atômica com folha e ensaio nativo pertencem às outras frentes. Não houve validação real de navegador neste complemento.
