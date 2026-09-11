# Descargas no período: cliente e prova bancária integrada

Escopo: migration 20260910203516, consulta do fluxo econômico de descargas por fornecedor. Não representa carteira em aberto em uma data histórica.

## Cliente

`periodUnloadingFlowClient.ts` valida resposta, empresa, período, fornecedor, contas e página. A revisão do demonstrativo é independente da revisão do pacote monetário: a primeira protege a paginação; a segunda impede comparar resultados de consultas monetárias diferentes. Erro 40001 exige nova consulta, e falhas de autorização não são convertidas em alteração de revisão.

Cinco testes do cliente passaram na execução registrada às 17:38:26. Às 17:52:50, o coordenador reexecutou os cinco testes do cliente e o teste bancário integrado: seis aprovados, saída 0, com a proteção de conversões BigInt presente no contrato.

## Banco fechado de verdade na fixture

`periodUnloadingBankPackage.test.ts` usa `unloadingBankPackageDatabase.ts`, que compõe os writers reais de descarga, recebimento, conciliação, abertura, aprovação de cobertura, corte legado, fechamento e reabertura. Não injeta um fechamento bem-sucedido nem desativa suas guardas.

O caso cria uma descarga de R$ 150 e registra um PIX de R$ 300, alocando R$ 100 à descarga e R$ 200 ao frete. Depois da conciliação e do fechamento, o pacote monetário apresenta entrada de R$ 300 uma única vez. A ponte da descarga apresenta alocação de R$ 100 sobre aquele movimento de R$ 300, com o ID real do fechamento. Reabrir o período altera a revisão e remove a indicação de cobertura, preservando os R$ 100 registrados.

Um teste passou às 17:47:07; lint dos arquivos de cliente, teste e helper passou. O extrato, a identidade autenticada e os metadados de Storage são sintéticos. As funções financeiras executadas são reais; esta fixture não substitui Supabase completo, upload real, RLS de toda a plataforma ou homologação em navegador.

## Conexão remota

Nova consulta somente de leitura após a reconexão confirmou PROJETO AGV LOG (`qcvnsdrbcchaxvawcngk`) em ACTIVE_HEALTHY, 406 migrações, última versão `20260909221751` e `public.finance_movements` ausente. Nenhuma migration foi aplicada remotamente.

## Limites

Cobrança, recebimento e devolução usam suas próprias datas econômicas. Cobertura monetária e classificação são informações distintas. O demonstrativo não calcula saldo aberto subtraindo eventos do mês e não afirma qual informação estava disponível no passado. TSC44134 concluiu com saída 0 após estabilização dos arquivos desta etapa. O suplemento PostgreSQL nativo concluiu três casos aprovados, sessão85640 saída0 e servidor encerrado; relatório separado em `finance-period-unloading-native-2026-09-10.md`, conferido pelo coordenador.
