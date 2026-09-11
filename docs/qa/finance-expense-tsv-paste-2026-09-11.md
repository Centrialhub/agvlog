# Colagem TSV de gastos — QA local 2026-09-11

## Escopo e contrato
Colagem no modal existente, sem API nova, envio automático, alteração bancária ou publicação. Colunas: Categoria, Descrição, Valor, Data; opcionalmente Fornecedor, Documento, Vencimento. Cabeçalho opcional, ordem fixa. Categorias por código ou rótulo atual. Datas ISO ou brasileiras, calendário real. Valores positivos com até duas casas decimais, conversão decimal exata em BigInt; 1.234 sem separador decimal é rejeitado por ambiguidade. Descrição aceita de 1 a 1.000 caracteres após trim. Máximo 200 linhas no lote e 262.144 caracteres na colagem, sem truncamento silencioso.

TSV aceita aspas, tabulações/quebras de linha dentro de células e aspas escapadas. Fórmulas não são executadas e entradas com marcadores de fórmula são rejeitadas. Prévia por linha e erros impedem inclusão parcial. O fornecedor colado é textual: nenhum ID, comprovante, entrega ou vínculo monetário é inventado.

Inclusão explícita preserva linhas existentes e pedido do lote; cria IDs únicos para novas linhas. Estado corrente é serializado antes da atualização React, permitindo que uma rejeição seja capturada pelo handler, sem falso sucesso ou exceção tardia do updater. Outra linha com upload pendente permanece bloqueada, mas colagem pode acrescentar linhas; conclusão posterior do upload preserva ambas. Registro final permanece bloqueado durante uploads.

## Verificação
Comando: `npx vitest run src/test/expenseBatchPaste.test.ts src/test/expenseBatchPasteDialog.test.tsx src/test/expenseBatchEntryUx.test.tsx src/test/expenseBatchPreparedReceipt.test.tsx --maxWorkers 1`.
Resultado: 19 testes passaram, quatro arquivos; executor 33712, saída 0, início 09:48:16 local. Cobertura: limites 1000/1001, moeda exata/terceira casa, datas inválidas, categorias/contexto, aspas, limite de linhas, IDs únicos, preservação do original, prévia invalidada por edição/contexto, nenhum envio automático, rejeição por capacidade corrente alterada sem falso sucesso, upload pendente e conclusão sem perder novas linhas, regressões de teclado e recuperação de comprovantes.

ESLint dos cinco arquivos da allowlist: saída 0, sem warnings. TypeScript global e build não executados nesta subtarefa; coordenação permanece com root. Nenhum QA de navegador hospedado ou operação remota realizado.

## Correção da auditoria anterior
O apontamento de N+1 em LegacyPayableAssociation foi incorreto: o workspace que consulta dados só monta quando `open` é verdadeiro. Nenhuma correção desse componente foi necessária nem realizada.

## Arquivos
Allowlist e hashes SHA-256 em `finance-expense-tsv-paste-allowlist-2026-09-11.json` (cinco arquivos fonte/teste).
