# Consulta de custos antigos — 10/09/2026

Migration local `20260910155523_finance_legacy_cost_readers.sql`, dependente do comando de associação55442. Nenhuma aplicação remota.

`get_finance_legacy_cost_inventory` identifica despesas de motoristas e cabeçalhos de ordens de manutenção, com filtro por família e paginação30. Contagem completa, sem total monetário que misture representações possivelmente duplicadas. Datas/valores inválidos permanecem visíveis como indeterminados. Manutenção recebe pendência explícita de revisão por componentes; não é incorporada ao custo por esta leitura.

`get_finance_legacy_expense_cost_context` mostra a fonte, os custos da mesma viagem/motorista, impedimento e revisão individual calculados pelos helpers do comando, associação ativa e histórico. Candidatos e histórico são paginados separadamente usando o mesmo número de página; associação ativa independe da página. Compatibilidade de viagem não comprova identidade: a escolha requer conferência humana e o comando revalida elegibilidade/revisão.

Três testes SQL PGlite com schemas reais de UI passaram em `legacyCostReaders.test.ts`:1005despesas+1OS,31custos criados pelo comando real de lote, revisão por candidato, associação e reversão reais, autoria/histórico, fonte com infinity/NaN e rejeição de motorista/identificador inexistente/filtro inválido. A fixture usa baseline das fontes e comandos/builder reais, mas rota física vazia e dependências estreitas; não equivale a aplicação integral das migrations. Nenhuma comprovação de navegador ou PG nativo específico desta consulta nesta etapa.

Pendências de cobertura: componentes/peças/estoque da manutenção ainda precisam fluxo próprio; reembolsos antigos e conflitos de obrigação continuam em revisão. Este inventário não aprova adoção do legado nem fechamento bancário.

ESLint da consulta de teste e helper de invalidação passou. SHA25655523: `f7e120e53e4639d9092de78f5c499827e46fac0cd52cea4ad9af50219a86ee63`. TSC integrado78323 terminou1 com erros nos arquivos concorrentes de offline/recibos/motoristas (`driverOfflineOutbox`, `driverOperationalOffline`, `DriverStops` e testes dessas famílias); não houve erro financeiro naquela saída. Isso não equivale a TSC global aprovado.
