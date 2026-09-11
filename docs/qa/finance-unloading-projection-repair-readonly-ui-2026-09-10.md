# Conferência de reparação do título de descarga — UI — 2026-09-10

Consulta integrada ao modal de edição de recebíveis de descarga pelo botão **Conferir reparação do título**. A charge vem da FK já consultada; o botão não pesquisa por descrição ou fornecedor. `UnloadingProjectionRepairDialog` usa o client/contrato read-only do coordenador e `FinanceAccessBoundary`.

Apresenta origem preservada, título atual e resultado previsto lado a lado: nomes quando fornecidos, IDs e valores exatos; valor atual desconhecido permanece indeterminado. A identificação atual do título só contém client_id no contrato, portanto nenhum nome atual foi inferido.

Impedimentos e dependências aparecem separadamente. `blocking=false` é apresentado como preservado sem impedir a reparação, especialmente custo canônico; não é transformado em bloqueio. Histórico manual conserva antes/depois, autoria, motivo, data e IDs com destaque âmbar. Listas de impedimentos/dependências/histórico paginadas visualmente em30 sem cortar o conjunto recebido.

A UI informa que a reparação prevista restaura o título pela origem, sem alterar descarga, custo ou dinheiro; não promete retificação da origem real. `can_execute=false`: nenhum botão de confirmar/executar e nenhum client de escrita. Consulta pendente/erro esconde dados anteriores; chaves incluem empresa, ator e charge, e o detalhe reinicia por revisão.

Verificação: nove testes passaram (três painel e seis edição/entrada), cobrindo comparação/valores, dependência não bloqueante, bloqueio e histórico manual, atualização/erro sem dados antigos e abertura/fechamento pelo charge_id correto sem UPDATE. ESLint dos quatro arquivos passou. Nenhum TSC, schema, client ou SQL alterado.

Arquivos: `UnloadingProjectionRepairDialog.tsx`, integração `Receivables.tsx`, `unloadingProjectionRepairPanel.test.tsx`, complemento `receivableUnloadingEdit.test.tsx`.
