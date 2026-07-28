## Correções no Financeiro

Dois problemas relatados, ambos identificados na leitura do código.

### 1. Conciliação Bancária — "Nenhuma linha válida" na importação

**Causa (confirmada nas telas):** os XLSX do Sicoob (`RelatorioPixPagamento_*`) trazem um bloco de título antes dos cabeçalhos reais. Como `parseWorkbook` usa a **primeira linha** da planilha como cabeçalho, todos os campos viram uma única coluna chamada `SICOOB` — por isso todos os selects mostram "SICOOB" e não há como mapear Data/Descrição/Valor, resultando em zero linhas válidas.

**Correção:**
- Em `src/lib/bankStatementParser.ts`, ler a planilha como matriz (`sheet_to_json({ header: 1 })`) e detectar automaticamente a linha de cabeçalho: varrer as primeiras ~20 linhas e escolher a que tenha maior nº de células não vazias **e** contenha pelo menos uma palavra-chave conhecida (`data`, `valor`, `crédito/credito`, `débito/debito`, `descri`, `histor`, `saldo`, `documento`). Usar as linhas seguintes como dados.
- Retornar também `headerRowIndex` para exibição.
- Em `parseCsv`, aplicar a mesma heurística (Sicoob CSV também tem preâmbulo).
- Em `BankReconciliation.tsx` (`ImportStatementDialog`):
  - Mostrar "Cabeçalho detectado na linha X" com um seletor numérico para o usuário sobrescrever caso a detecção erre (re-parse ao alterar).
  - Manter a heurística de auto-mapeamento existente; ela funcionará assim que os headers reais forem detectados.
- Se ainda assim `mapping.date` ou `mapping.description` ficarem vazios após o auto-guess, mostrar mensagem clara ("Não foi possível identificar as colunas — selecione manualmente") em vez do toast genérico.

### 2. Acerto de Motoristas — "não permite selecionar romaneio"

**Causa (confirmada):** em `NewManualSettlementDialog`, `canSubmit` exige `driverId`. Na tela do usuário o campo **Motorista** está em "Selecione o motorista", então mesmo com romaneio marcado o botão "Criar acerto (1)" fica desabilitado, sem feedback do porquê. Além disso o `LoadPicker` já lista todos os romaneios (driverId nulo), o que sugere ao operador que ele pode simplesmente marcar e criar.

**Correção (só UX, sem mudar regra de negócio):**
- Em `NewManualSettlementDialog.tsx`:
  - Quando o usuário selecionar romaneios sem ter motorista escolhido, **inferir e pré-preencher `driverId` automaticamente** a partir do `driver_id` do primeiro romaneio selecionado que tenha motorista.
  - Se os romaneios selecionados tiverem motoristas diferentes, exibir alerta inline "Romaneios de motoristas diferentes — selecione apenas de um motorista" e desabilitar o botão explicando o motivo.
  - Bloquear seleção de romaneios de outro motorista quando `driverId` já estiver definido (desabilitar checkbox com tooltip "Outro motorista").
  - Exibir texto de ajuda ao lado do botão quando desabilitado: "Selecione um motorista" ou "Selecione ao menos um romaneio".
- Em `LoadPicker.tsx`: expor `driver_id` do load ao componente pai via callback ou incluí-lo nos itens visíveis (o hook já retorna `driver_name`; confirmar que `driver_id` também vem — ajustar `useAvailableLoadsForSettlement` se necessário para incluir esse campo).

### Escopo fora
- Não alterar RPCs `create_manual_driver_settlement` nem `import_bank_statement`.
- Não alterar layout geral das páginas de Financeiro.
- Sem mudanças em conciliação após importação (o motor de match continua igual).

### Verificação
- Build + `bunx vitest run` (esperado: 250 testes verdes, sem novos).
- Teste manual mental: reimportar o XLSX do Sicoob deve detectar o header correto e permitir mapear Data/Descrição/Valor; criar acerto marcando um romaneio deve pré-preencher motorista.
