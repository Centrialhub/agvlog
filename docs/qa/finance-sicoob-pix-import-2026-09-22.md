# Importação do relatório detalhado de pagamentos Pix do Sicoob

## Falha reproduzida

O arquivo original fornecido foi lido localmente, sem envio ao servidor e sem alterações. O mapeamento inicial falhava com `invalid_date:row=2`. Mesmo selecionando o cabeçalho da linha 11, ocorria `invalid_date:row=12`, pois as datas incluem horário. Além disso, o relatório usa valores positivos para pagamentos e contém resumo e rodapé após os lançamentos.

## Correção

- Reconhecimento restrito ao cabeçalho completo e à identificação Sicoob / Pagamentos.
- Preenchimento de cabeçalho, colunas e período na tela, mantendo a escolha da conta e a confirmação da prévia.
- Datas e horários validados, preservando os valores originais e os números das linhas.
- Importação de Valor como débito, mantendo ID Transação e destinatário.
- Resumo e rodapé reconhecidos de forma restrita. Quantidade e soma dos pagamentos devem corresponder ao resumo. Conteúdo adicional, linhas inválidas e divergências interrompem a importação.
- Mesma regra compartilhada pela prévia e pela verificação do servidor. Cobertura completa da conta continua pendente: o relatório abrange apenas pagamentos Pix.

## Validação

O original foi reconhecido com 86 pagamentos entre 01/09/2026 e 08/09/2026, total de saídas de R$ 30.610,23. Preparação do pedido, validação do XLSX em quarentena e releitura da matriz derivada produziram as mesmas 86 linhas, sem divergências. O teste temporário com o arquivo privado foi removido; os testes permanentes usam dados fictícios.

- 58 testes passaram nas seis suítes relacionadas: `sicoobPixStatement`, `financeStatementWorkbook`, `financeStatementSourceReader`, `financeStatementArtifactWorker`, `statementImportDialog` e `statementImportWorkflow`.
- ESLint passou para os arquivos alterados; sintaxe das Edge Functions passou (93/93).
- Typecheck geral apresentou erros fora dos arquivos alterados: `BillingEdi`, `OperationsDashboard`, `accountPeriodEvidencePanel.test`, `costCenterOperationsReview.test` e `ingestionReportMetricsReportedBugs.test`.

## Validação para publicação no main

Correção reaplicada em worktree isolado sobre `ebf6c46e`, preservando as alterações recentes do main. Os 58 testes, ESLint dos arquivos alterados, sintaxe das Edge Functions, contrato de release Supabase e `build:check` passaram. A checagem geral de tipos nessa base aponta erros fora dos arquivos alterados, em `usePendingLoadsForRouting`, `useLoadItems`, `orderFormNormalization` e `Loads`.

A publicação do código no GitHub não comprova o deploy do backend. Publicar o frontend e a função `finance-statement-verify` em conjunto para manter prévia e servidor compatíveis. Não houve importação de lançamentos, gravação financeira ou migração durante este diagnóstico.
