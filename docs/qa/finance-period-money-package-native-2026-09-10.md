# Pacote monetário do período — PostgreSQL nativo

Data: 2026-09-10. Resultado: **8 casos passaram em PostgreSQL 17.11**, cluster descartável em loopback encerrado ao final. Nenhuma operação remota e nenhuma alteração de SQL de produto nesta validação.

## Artefatos executáveis

- Runner: `scripts/test-finance-period-money-package-native-cases.mjs`, export `runPeriodMoneyPackageNative`.
- Seletor: `PG_QA_SUITE=finance-period-money-package node --experimental-strip-types scripts/test-delivery-concurrency.mjs`.
- Log: `node_modules/.cache/qa-postgres/finance-period-money-package-native-2026-09-10.log`.
- Contrato efetivamente parseado: `src/lib/financial/periodMoneyPackageContract.ts`, `periodMoneyPackageSchema`.
- Migration principal: `20260910193723_finance_period_money_package.sql` SHA256 `685ce9177c4e3b5202d7ac9e6eb13cd4f5963db001a14c16204b23290b624adf`, conferido antes de instalação. O log registra também hashes das dependências posteriores de projeções, caixa e auditoria.

## Provas

1. Abertura, movimento bancário, evidência de extrato, conciliação, aprovação de cobertura, revisão do corte e fechamento por RPC reais; combinado a fechamento real de caixa. Entrada de 1.000 centavos contada uma vez; encerramento conjunto de 16.000 centavos. Ambos tipos de evidência identificados.
2. Corte que começa dentro do fechamento, conta selecionada sem cobertura e reabertura real invalidam o agregado monetário.
3. Transferência interna real de 1.000 centavos entre dois caixas: bruto mantém 1.000 de entrada e saída, ajuste reconhece exatamente um par de 1.000; seleção de uma conta mostra fronteira. Reordenar contas não muda revisão.
4. Saída em trânsito de janeiro permanece congelada como trânsito após chegada real em fevereiro; revisão do pacote de janeiro permanece idêntica.
5. Dois fechamentos mensais contíguos usam a abertura inicial uma única vez.
6. Metadado histórico de transferências JSON null invalida classificação, preservando o saldo bruto demonstrado de 10.000 centavos.
7. Manifesto histórico com movimento duplicado retorna diagnóstico, invalida totais monetários e mantém IDs públicos únicos, sem quebrar o parser estrito.
8. Seleção repetida, conta de outro tenant e usuário com papel financeiro combinado a motorista são rejeitados.

## Limites

A fixture usa o grafo financeiro pertinente de migrations reais e tabelas da baseline, com partes de DDL extraídas e algumas FKs externas omitidas. Não representa instalação integral das migrations da plataforma nem ensaio de upgrade remoto. As funções de transferência são reinstaladas a partir dos corpos e ACLs reais, como na factory PGlite correspondente.

A evidência bancária é sintética local, preparada pelo helper de fechamento; não prova autenticidade de arquivo bancário, integração de Storage nem execução do worker de upload nesta suíte. Fechamentos e conciliação positivos passam por comandos reais, sem ticket falso de sucesso.

Os dois casos de corrupção histórica desabilitam temporariamente triggers da tabela de fechamento exclusivamente na fixture, modificam snapshot/revisão e reativam a proteção; servem para provar diagnóstico de legado corrompido, não possibilidade de alteração pública. Nenhum bypass é usado nos fechamentos positivos.

Esta suíte valida o pacote monetário congelado. Não pretende somar carteira atual, expectativa de frete, custos por competência ou obrigações ao dinheiro. Não inclui nova matriz de concorrência: as travas de fechamento/transferência foram verificadas em suítes específicas anteriores. O processo registrou `8 period money package native tests passed.` e `Disposable PostgreSQL stopped.`.
