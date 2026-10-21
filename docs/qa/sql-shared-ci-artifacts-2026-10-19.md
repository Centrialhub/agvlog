# Diretório exclusivo de evidências do navegador — 19/10/2026

A revisão do workflow confirmou uma precondição que o executor local já fornecia: driver-signature-upload-contract.spec.ts exige AGVLOG_RETRY_QA_ARTIFACTS ao carregar os testes, inclusive quando a execução filtra apenas cenários críticos. Sem essa variável, o CI interromperia antes dos testes.

As duas etapas de interface passam a declarar um diretório dentro de runner.temp, exclusivo do job. O diretório é compartilhado somente entre as etapas sequenciais do mesmo job. Não se altera comando de teste, timeout, retry, assertion, API, permissão, migration ou cadastro. O YAML foi carregado e ambas as etapas foram conferidas; o recibo é F:/AGVLOG/checks/quality-artifact-environment-diagnostic-20261019.json.

Isso valida a configuração, não uma execução hospedada do GitHub Actions. Não houve upload de fontes ou baseline privado, nem alteração de segredos ou variáveis remotas. O equivalente local completo precisa passar no novo SHA integrado, com os oito shards e database-and-e2e; resultados anteriores de 29cf779a ficam como diagnóstico. O aceite final continua condicionado a F:/AGVLOG/checks/sql-compatibility-final-gates-20261019.json com SHA e árvore exatos.
