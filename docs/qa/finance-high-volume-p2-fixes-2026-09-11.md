# Três correções P2 de alto volume — validação local

Os três itens da auditoria finance-high-volume-ui-audit-2026-09-11.md foram tratados em sete arquivos, listados com SHA256 em finance-high-volume-p2-allowlist-2026-09-11.json.

## Alterações

1. O upload não desabilita mais o fieldset de todas as linhas. Origem/viagem e distribuição coletiva permanecem em fieldset bloqueado enquanto houver upload; a linha em processamento mantém seus campos e remoção/reutilização desabilitados, e o atalho de adicionar após essa linha também não atua durante upload. É possível preencher outras linhas e adicionar gastos. O envio/revisão final, fechamento do modal e alteração do escopo continuam bloqueados. Mantidos contador de uploads, identificação antecipada do batch, IDs estáveis por linha e atualização funcional que preserva alterações de outras linhas.
2. FinanceOptionPicker oculta opções cacheadas durante isFetching e mostra conferência em andamento. Isso impede selecionar disponibilidade monetária antiga enquanto a consulta é atualizada. Mantidos foco, Escape, busca e paginação.
3. Folha substitui cartões, lista e ações por status de conferência no carregamento inicial ou refetch. Não exibe zero inicial nem permite fechamento/aprovação/recalculo apoiados em leitura ainda pendente. Os valores e ações retornam depois da resposta; erros mantêm o bloqueio já existente.

## Testes

Sessão17424 encerrou saída0:19 testes/4 arquivos em8,80s (05:28:36). Arquivos: expenseBatchPreparedReceipt.test.tsx6; expenseBatchEntryUx.test.tsx5; financeOptionPickerKeyboard.test.tsx2; financePayrollScreen.test.tsx6.

O novo caso do lote usa userEvent para anexar arquivo e digitar em outra linha com promise de upload pendente; confirma bloqueios, preservação dos IDs, descrição/valor da segunda linha e comprovante da primeira ao concluir. Regressão existente conserva dois uploads fora de ordem e bloqueio final até ambos terminarem. Picker cobre cache reaberto durante refetch, sem chamada onChange antiga. Folha cobre carregamento inicial e atualização de dados previamente carregados.

Lint dos sete arquivos: saída0. Nenhum TSC global, publicação, push, SQL ou acesso à produção executado nesta tarefa. Não houve alteração em arquivos de previsão financeira.

## Correção de tipagem e TSC final

Após diagnóstico TS2322 de TSC38329, o mock de financeOptionPickerKeyboard.test.tsx recebeu anotação explícita de retorno Promise com id:string, evitando inferência restritiva de crypto.randomUUID. Nenhum código de produto alterado. Os2 testes afetados passaram em05:30:49 e o lint focal saiu0. Hash atualizado na allowlist. TSC global autorizado executado uma única vez: sessão94281, npm run typecheck, saída0 sem diagnósticos. Log finance-high-volume-p2-typecheck-2026-09-11.log. Fonte congelada após esta correção.
