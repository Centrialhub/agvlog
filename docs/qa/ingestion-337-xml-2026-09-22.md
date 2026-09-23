# Importação de 337 XMLs — 22/09/2026

Relato: a página da versão Vercel trava ao selecionar 337 XMLs para importar.

## Evidência

- Projeto Vercel: `agvlogistica`; publicação de produção consultada em estado `READY`, commit `f36b01448a35ec04aa8755ad63134de5a68fdd09`.
- O código desse commit lê todos os arquivos em um `Promise.all`, conserva os buffers juntos, só cede o processamento ao navegador a cada 50 documentos e renderiza toda a revisão sem paginação.
- Não há progresso de leitura nem bloqueio de seleção concorrente nessa publicação.
- Cada criação de documento também invalida consultas ativas, inclusive a consulta paginada que carrega todo o histórico fiscal.
- A consulta dos logs Vercel das últimas 24 horas não retornou registros. Isso não exclui falhas no navegador ou no Supabase.

Os achados são compatíveis com o relato, mas os arquivos reais do cliente e o navegador afetado não foram usados para reproduzir o travamento.

## Correção local

- Preservada a leitura em grupos de dois arquivos, que já estava em alterações locais não publicadas; adicionado progresso e bloqueio síncrono contra seleções concorrentes.
- Limite ajustado de 200 para 500 arquivos para aceitar o lote relatado; mantidos 10 MB por arquivo e 50 MB por lote.
- Revisão de notas e pedidos em páginas de 25, mantendo o lote completo para salvar/agrupar e os índices originais para ações.
- Indexação de clientes por documento para evitar repetir a busca de filiais em cada XML.
- Erros de leitura/formato são exibidos por arquivo, preservando os demais documentos. Falhas inesperadas liberam o estado ocupado.
- Atualização do histórico fiscal adiada até o término de cada fluxo de gravação: salvar notas, salvar ao agrupar e executar importação. O comportamento padrão de criação fora da importação continua atualizando imediatamente.
- Corrigida a origem do import de `assertFiscalDocumentIdentity` em `FiscalDocuments.tsx`, necessário para desbloquear o build do estado local existente.

## Validação

- 51 testes aprovados, distribuídos entre `ingestionBatchReading`, `ingestionReviewPerformance`, `ingestionUploadLimitsReportedBug`, `ingestionSafety`, `ingestionPostCreateFailureReportedBugs` e `billingInvoiceAvailability`.
- Leitura sintética de 337 XMLs: progresso observável, seleção concorrente ignorada, cada arquivo lido uma vez e falha de leitura isolada sem perda do lote.
- Revisão: 25 cartões na primeira página; 12 na última; remoção e filtro preservam o índice correto; página ajustada ao reduzir a lista.
- Cliente PostgREST real com transporte simulado: três gravações em lote não recarregam o histórico entre notas; a invalidação final carrega os resultados uma vez.
- ESLint dos arquivos envolvidos aprovado.
- `npm run build:check` aprovado, incluindo verificações do bundle e do artefato público.
- A checagem global de TypeScript encontrou erros preexistentes em `BillingEdi`, `OperationsDashboard` e testes de outras alterações locais. O erro de import em `FiscalDocuments` foi corrigido e a compilação de produção foi repetida com sucesso.

## Publicação

Após autorização para atualizar a `main`, a correção foi transplantada para um checkout isolado da versão remota, sem incluir as demais alterações locais. Foram aprovados 48 testes relevantes nesse checkout, dois testes de pipeline, lint dos arquivos alterados e build de produção. As pendências globais preexistentes estão descritas no relatório versionado `docs/qa/ingestion-337-xml-release-2026-09-22.md`.

- Commit publicado na `main`: `ebf6c46ea77a66305c7b1853d62c0585f087965a`.
- Deploy Vercel: `dpl_EbcbQLgM97sh3WLyXUSCwGZ9hdPD`, produção, status `READY`.
- Endereço: https://agvlogistica.vercel.app.
- `/release.json` confirmou o commit acima, com build hash `72738e983fbf0266`.
- HTML e chunks de entrada, importação e documentos fiscais acessíveis; verificadas as marcas de progresso e adiamento de consultas no JavaScript publicado.
- Consulta de logs desse deploy sem registros retornados. Não houve importação de dados reais para validação.
