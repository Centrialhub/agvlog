# Verificação sintética ampliada — 21/10/2026

Código avaliado: `beeb7588ae109d5d42f649ffa7a732e840712064`, tarefa `fiscal-service-failure-20261021`, owner `CodexFiscalIncident`. Check do coordenador aprovado, base de integração `0da8bf35c624cd2032fb86633531a3cf13f43f3e`. Nesta rodada foram acrescentados testes e documentação; sem alteração da lógica de aplicação, migrations ou dados produtivos.

## Matriz nova

`src/test/fiscalSyntheticMatrix.test.ts`: **680 testes aprovados** na execução individual.

- 648 combinações: processamento, terminalidade e necessidade de conciliação; cada campo recebe false, true, null, ausência, string ou número; fatos na raiz, documento ou ambos. Cada caso executa o classificador SQL e o classificador da Edge contra a expectativa de tipos estritos.
- JSON malformado, tipos incorretos/ausência nos identificadores e fatos contraditórios entre raiz e documento.
- HTTP 200/202/409/422/502/503 com prova explícita de não transmissão: o resultado fiscal não é inferido apenas do HTTP.
- Referência, ambiente, CNPJ e autorização contraditórios não encerram a tentativa. Outro tenant não consegue concluir a operação.
- Callback repetido, versão antiga, autorização posterior e tentativa de regressão após autorização.
- Quatro chamadas da mesma operação após timeout sem ID do Hub resultam em apenas um POST; as demais retornam pendência de conciliação.
- Resposta ao cliente derivada do estado confirmado: error, provider_unknown, processing, authorized e rejected, com indicadores coerentes na raiz/documento.

## Suíte ampliada e evidências

Selecionados 116 arquivos pelo nome relacionado a fiscal, CT-e, NFS-e, MDF-e e consumidores, incluindo testes adicionais encontrados pelo filtro. Manifesto exato: `F:/AGVLOG/checks/fiscal-synthetic-suite-manifest-20261021.txt`.

Execução com Node 22 e Vitest, dois workers conforme configuração do projeto. Banco SQL em PGlite, requisições externas substituídas por respostas sintéticas e interface em DOM simulado com React Query real.

Evidências:

- `F:/AGVLOG/checks/fiscal-synthetic-matrix-20261021.json`: matriz individual.
- `F:/AGVLOG/checks/fiscal-synthetic-suite-20261021.json`: suíte ampliada, incluindo a matriz. Não somar as duas execuções como testes distintos.

**Resultado final: 1.481 testes aprovados, zero falhas, zero pendentes/pulados, em 116 arquivos.** O contador de suites do Vitest é 228 (inclui agrupamentos describe), não 228 arquivos. O total de 1.481 já inclui os 680 testes da matriz. Nenhuma falha exigiu correção da aplicação nesta rodada.

TypeScript da aplicação (`tsc --noEmit -p tsconfig.app.json`), ESLint do teste novo com zero warnings e `git diff --check` aprovados. As evidências JSON e o manifesto foram salvos fora do checkout em `F:/AGVLOG/checks/`.

## Limites

“Completo” nesta rodada significa executar todos os arquivos selecionados e a matriz declarada, sem pular casos deliberadamente. Não representa prova exaustiva de qualquer entrada ou interleaving possível. Os testes de ordenação são sequenciais e não substituem concorrência MVCC em PostgreSQL nativo. Não houve emissão fiscal real, deploy, reenvio de documento produtivo ou navegação autenticada contra backend real. A homologação integrada da árvore de release continua separada.
