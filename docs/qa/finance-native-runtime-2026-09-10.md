# Ambiente local de ensaio financeiro nativo

- PostgreSQL 17.11 portátil, pacote EDB `postgresql-17.11-3-windows-x64-binaries.zip`.
- Origem: [distribuição Windows indicada pelo PostgreSQL](https://www.postgresql.org/download/windows/) → [binários EDB](https://www.enterprisedb.com/download-postgresql-binaries), link da versão 17.11 com `fileid=1260491`.
- Destino observado do download: `https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip`.
- SHA-256 local do arquivo recebido: `4B8DB0930C38F6EF845DB919551DEDDA3B6B845AEB0927B3D79A6E8E9E4537CF`. É um identificador do artefato recebido, não comparação com checksum publicado pelo fornecedor.
- `postgres --version` retornou `postgres (PostgreSQL) 17.11`.
- Extraído em `node_modules/.cache/qa-postgres/runtime-17.11`, fora dos arquivos versionados. Não instalou serviço permanente. O executável consultado não tem assinatura Authenticode.
- A suíte `scripts/test-delivery-concurrency.mjs` cria cluster descartável, senha aleatória e porta local, escutando somente em `127.0.0.1`; usa fixtures sintéticas e não as credenciais/configurações do aplicativo.

Este registro comprova a preparação do runtime. Resultados da suíte e dos novos casos financeiros devem ser registrados após sua conclusão; não inferir aprovação de concorrência apenas pela existência do runtime.

## Primeira execução

A suíte iniciou e executou os casos existentes de pedidos simultâneos, operações, fechamentos, recebimentos, faturas, despesas e acertos até a preparação fiscal. Falhou ao reaplicar a restrição legada `cte_documents_status_check` sobre uma fixture que já continha o status atual `authorized`. O encerramento do PostgreSQL foi confirmado pelo runner. Portanto, a suíte completa **não passou** nessa execução.

A preparação transitória da restrição antiga foi ajustada em `fiscalReadinessDatabase.ts`: somente essa restrição intermediária entra como `NOT VALID`; a migration real seguinte a substitui e valida todas as linhas com o catálogo atual. Nenhum status de negócio foi alterado para acomodar o teste. Os 22 testes fiscais em PGlite passaram após o ajuste.

Os novos casos de dinheiro registrado foram adicionados em `scripts/test-finance-recorded-money-native-cases.mjs`, executados sobre uma cópia do banco descartável depois da suíte de recebíveis. Cobrem duas baixas disputando capacidade, repetição simultânea e correção seguida de realocação. Precisam de resultado nativo explícito; a preparação do código não prova aprovação desses casos.

## Segunda execução e correção da linha do tempo

A segunda execução terminou com erro `ssx_position_outside_binding_window` no primeiro caso SSX, após a torre de controle. O cenário usava posições fixas de agosto de 2026 e um vínculo criado pela fixture compartilhada em `now()-1 day`; a passagem do calendário tornou o cenário incompatível com a guarda real. O reset exclusivo da suíte nativa agora posiciona o início desse vínculo em 30/08/2026, antes das posições sintéticas. Nenhuma guarda ou regra de produção foi modificada.

A reexecução com `PG_QA_SUITE=control-tower` passou os 23 casos da torre e os seis casos SSX, com saída 0 e parada confirmada do PostgreSQL descartável. Relatório local: `node_modules/.cache/qa-postgres/finance-native-tail-2026-09-10.log`. ESLint do arquivo alterado também passou. Isso verifica a correção específica, não substitui a aprovação da suíte completa. A próxima execução completa grava saída integral para preservar evidência dos casos financeiros sem truncamento de terminal.

## Terceira execução completa — aprovada

O runner completo terminou com código 0 e confirmou a parada do PostgreSQL descartável. Relatório integral local: `node_modules/.cache/qa-postgres/finance-native-full-2026-09-10.log`. Contagem: 293 casos operacionais/financeiros, seis fiscais, 23 da torre e seis SSX, total de 328. Os três novos casos financeiros passaram explicitamente: disputa de capacidade de entrada entre títulos, repetição concorrente da mesma baixa e correção liberando capacidade antes da realocação. O relatório registra hashes das migrations candidatas instaladas nesses casos.

A evidência é de fixtures sintéticas e do conjunto instalado pelo runner. Não certifica o schema remoto completo, backfill histórico, todos os módulos financeiros novos ou a interface em navegador. A consulta de histórico de recebíveis criada depois não integra esta execução nativa; tem validação própria em PGlite e testes de componente. Nenhuma conexão de produção ou requisição fiscal foi feita.

## Concorrência das transferências internas

Execução isolada `PG_QA_SUITE=finance-transfers` terminou com código 0, cinco casos aprovados e PostgreSQL parado. Relatório: `node_modules/.cache/qa-postgres/finance-native-transfers-2026-09-10.log`. Migration `20260910033918_finance_internal_transfer_pairs.sql`, SHA-256 `564288fe9c1c7cc1863019fc2c5ce090ca97a7bd4d765c2959c3b208daa3e0e4`.

Casos: repetição concorrente gera somente um par; referência bancária repetida rejeita o segundo pedido; transferências em sentidos opostos terminam com dois pares completos; revogação do operador durante espera impede ambas as linhas; desativação de conta durante espera é relida e impede ambas as linhas. A ferramenta exige evidência de bloqueio real antes de liberar a primeira transação.

O runner completo passou a incluir esses casos após as demais suítes, e a seleção isolada permite testar a migration sem repetir todo o operacional. A execução integral anterior continua sendo de 328 casos; os cinco novos foram aprovados separadamente, não declarar uma execução integral de 333. A fixture compartilhada preservou os 19 testes de ledger/transferência em PGlite; lint passou. O ambiente continua sintético, sem comprovar migração do banco ativo.
