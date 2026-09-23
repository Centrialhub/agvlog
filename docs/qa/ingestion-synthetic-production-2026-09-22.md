# Teste sintético da importação na Vercel

Data: 22/09/2026. Executado diretamente no Chrome, após login realizado pelo usuário, em https://agvlogistica.vercel.app/ingestion.

Versão publicada testada: `ebf6c46ea77a66305c7b1853d62c0585f087965a`.

## Lote principal

Foram gerados e selecionados pelo controle de upload 337 arquivos XML sintéticos, com chaves de acesso de 44 dígitos e dígitos verificadores consistentes. Os documentos foram marcados como dados de teste sem valor fiscal e não possuem assinatura/autorização fiscal real.

| Medida | Esperado | Observado |
|---|---:|---:|
| Arquivos/notas | 337 | 337 |
| Itens por nota | 30 | 30 |
| Itens totais | 10.110 | 10.110 |
| Valor total | R$ 1.011.000,00 | R$ 1.011.000,00 |
| Peso total | 168.500 kg | 168.500 kg |
| Tamanho do lote | 3.157.016 bytes | 3.157.016 bytes |
| Erros de validação | 0 | 0 |
| Páginas da revisão | 14 | 14 |
| Notas nas páginas 1–13 | 25 em cada | 25 em cada |
| Notas na página 14 | 12 | 12 |
| Notas únicas percorridas | 337 | 337 |

Os 337 avisos de cliente não cadastrado eram esperados: o destinatário é sintético e não foi cadastrado no sistema.

O log da aplicação informou `[Ingestion] files processed` com `fileCount: 337` e `durationMs: 3175`. Esse tempo mede leitura e validação dos arquivos; não inclui toda a montagem final da revisão.

Um observador de DOM registrou 170 atualizações de progresso, de `Lendo arquivos: 0 de 337` até `Lendo arquivos: 337 de 337`. O botão de seleção e as abas de upload ficaram desabilitados durante a leitura. A primeira e a última nota percorridas foram `900000001` e `900000337`.

Não houve erro de JavaScript registrado pelo navegador nem travamento persistente. A instrumentação de desempenho registrou duas tarefas longas, com máximo de **981 ms** no intervalo observado de leitura/revisão. Ainda existe, portanto, uma pausa perceptível a otimizar; o resultado não comprova ausência de lentidão em equipamentos mais modestos ou XMLs maiores.

## Lote com erros deliberados

Selecionados três arquivos: uma nota válida, uma cópia dessa nota com outro nome e um XML truncado.

- A revisão apresentou `Válidos (1)` e `Erros (2)`.
- A duplicata apresentou `NF-e 900000001 duplicada neste lote de importação`.
- O arquivo truncado apresentou erro de leitura XML com `Premature end of data in tag infNFe`.
- O filtro de erros exibiu os dois documentos problemáticos, sem eliminar a nota válida.
- Nenhum erro de JavaScript foi registrado.

## Efeitos e limpeza

O teste foi encerrado com `Recomeçar`, deixando o upload disponível e removendo os documentos sintéticos da revisão em memória. Os 314 documentos pendentes já existentes continuaram aparecendo como antes do teste.

Os eventos de rede observados não contiveram requisição de criação/atualização de notas. Os únicos POSTs capturados foram consultas à RPC `get_finance_access`. Não foram acionados salvar, agrupar ou executar; gravação de notas e cálculo de frete persistido não fazem parte desta validação.

Os observadores temporários de desempenho foram desligados e removidos. Nenhuma configuração da aplicação foi alterada.

## Reprodução

Fixtures e gerador disponíveis localmente em `F:/agvlog-main/test-results/ingestion-synthetic-2026-09-22/`:

- `generate.mjs`: gera os 337 XMLs e o arquivo inválido.
- `fixtures.json`: lista de arquivos e totais esperados.
- `xml/`: lote principal.
- `duplicate.xml` e `invalid.xml`: cenário de falhas.

Esses arquivos são dados sintéticos de teste e não devem ser persistidos como documentos operacionais.
