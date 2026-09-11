# Histórico e revisão do fechamento bancário

Migrações locais: `20260910162958_finance_account_period_close_snapshot.sql` e `20260910164256_finance_account_period_history.sql`.

O produtor exige abertura, continuidade, evidência bancária aprovada, concordância dos saldos e valores brutos, conciliações válidas, revisão das fontes históricas e proteções instaladas. A revisão inclui fatos completos e dependências determinísticas. Ausência do classificador ou das proteções impede elegibilidade.

O histórico é independente da elegibilidade atual. Retorna paginação com contagem integral, revisões históricas, autor, motivo, reabertura e descendentes ativos. Operadores consultam; somente administrador/proprietário autorizado pode executar. Motoristas são recusados pelo controle financeiro. Reabrir um sucessor não apaga o fechamento original.

Verificação local em 10/09/2026:

- `accountPeriodCloseSnapshot.test.ts`: 3 testes SQL/PGlite passaram; abertura e aprovação reais, revisão determinística, alterações compensadas não escondidas pelo saldo líquido, ausência de componentes bloqueada e autorização.
- `accountPeriodHistory.test.ts`: 3 testes SQL/PGlite passaram; paginação, contagem integral, reabertura por RPC real preservando autor/motivo, dependências e autorização.
- ESLint dos dois testes e `ledgerContract.ts`: sem erros.

As linhas históricas dos testes de histórico são fixtures explícitas e não demonstram elegibilidade positiva. O produtor ainda depende da integração do classificador, retenção de comprovantes e proteções para provar fechamento positivo completo. Não houve aplicação remota dessas migrações. A reconexão confirmou o projeto PROJETO AGV LOG ativo e saudável.

## Continuação: evidências preservadas

`20260910164923_finance_account_period_closure_evidence.sql` acrescenta consulta por empresa, conta e fechamento. Retorna os fatos salvos, dependências relacionais, autoria e eventual reabertura. Compara a revisão com o conteúdo preservado e o conjunto de dependências com sua versão salva; essas verificações não atestam a autenticidade dos arquivos bancários.

`accountPeriodHistory.test.ts` agora tem cinco testes aprovados, incluindo dados preservados após reabertura, integridade incompleta explicitamente indicada e bloqueio de acesso cruzado/usuário administrador também vinculado como motorista. `accountPeriodCloseSnapshot.test.ts` agora tem quatro testes aprovados; um contrato deliberadamente inconsistente do classificador (aprovado com bloqueios presentes ou inválidos) é recusado. ESLint sem erros nesses dois arquivos.

O agente de banco demonstrou dois cenários integrados positivos com comandos reais, ainda com conta sem movimentações. A ampliação para dinheiro conciliado, meses consecutivos e PostgreSQL nativo segue em andamento. A revisão independente também identificou a necessidade de permitir alocação tardia de dinheiro já congelado sem permitir movimento novo retroativo; essa correção está em implementação. Nenhuma dessas evidências conclui o módulo inteiro.
