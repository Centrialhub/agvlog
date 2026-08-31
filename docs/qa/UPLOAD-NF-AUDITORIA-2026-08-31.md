# Auditoria de upload e leitura de NF — 31/08/2026

**Parecer: não liberar a leitura automática como confiável sem correções.** O caminho básico de XML funciona no ensaio, mas existem defeitos reproduzidos de valor, destinatário, identidade fiscal e revisão de scans. Esta auditoria não modifica o comportamento da aplicação.

Foram revisados `/ingestion`, a importação XML do financeiro, validações, utilitários de scan, persistência e a função remota `extract-ort`. Os arquivos do projeto já tinham muitas alterações; nenhuma foi revertida ou substituída.

## Evidências executadas

- npm run typecheck passou (código de saída 0); node --check scripts/audit-nf-upload.mjs também passou.

- 40 testes existentes passaram em 6 arquivos: `uploadPolicy`, `nfeAccessKey`, `ortUtils`, `ingestionReport`, `productionConfiguration` e `prepareOrderItemsDatabase`.
- Ensaio adicional: **19 casos sintéticos; 3 passaram e 16 falharam**. As falhas são expectativas de comportamento seguro não atendidas, agrupadas abaixo; não representam 16 defeitos independentes nem uma taxa de erro sobre notas reais.
- O script importa e executa os módulos reais com DOMParser do jsdom. Os XMLs são simplificados, sintáticos e sem assinatura/autorização fiscal; servem para isolar a leitura, não para homologação SEFAZ.
- O ensaio não faz requisições de rede nem grava no banco. Seu código de saída 1 é intencional enquanto houver falhas.
- Código de OCR remoto: `extract-ort`, versão 60, ACTIVE, `verify_jwt=true`; conteúdo de `index.ts` igual ao local após normalizar quebras de linha.
- Consultas remotas somente de leitura: schema, índices, triggers e contagens agregadas. Nenhuma NF, carga, cliente ou lançamento foi criado/alterado. Não foram acionados IA paga, emissão fiscal, SSX ou deploy.

Reprodução a partir da raiz do projeto:

```powershell
node scripts/audit-nf-upload.mjs
npm test -- src/test/uploadPolicy.test.ts src/test/nfeAccessKey.test.ts src/test/ortUtils.test.ts src/test/ingestionReport.test.ts src/test/productionConfiguration.test.ts src/test/prepareOrderItemsDatabase.test.tsx
```

Artefatos: [script](../../scripts/audit-nf-upload.mjs) e [resultado dos 19 casos](UPLOAD-NF-CASOS-2026-08-31.json).

## Falhas prioritárias

| Prioridade | Problema e reprodução | Impacto e localização |
|---|---|---|
| P1 | **Financeiro multiplica valores por 100.** `vNF=1234.56` vira `123456`; `vDup=617.28` vira `61728`. Também reproduzido em `ValorServicos` de NFS-e. | `src/lib/nfeXmlParser.ts:42–46` remove todos os pontos antes de converter. Afeta preenchimento de contas a pagar/receber e parcelas. O parser principal de `/ingestion` preservou esses decimais no controle. Casos FIN-DECIMAL, FIN-INSTALLMENT e FIN-NFSE-DECIMAL. |
| P1 | **XML com prefixo troca destinatário e perde itens.** O mesmo XML com prefixo `nfe:` retorna `EMITENTE TESTE` como destinatário e zero itens; `ns1:` é rejeitado. O financeiro retorna `unknown` para o XML prefixado. | `src/lib/documentParsers.ts:170–198,365–397` mistura buscas com e sem prefixo. Quando `dest` não é encontrado, busca nome/CNPJ no documento inteiro. Também copia o emitente quando o destinatário está realmente ausente, sem erro bloqueante. Casos XML-PREFIX-RECIPIENT, XML-PREFIX-ITEMS, XML-ARBITRARY-PREFIX, FIN-PREFIX e XML-MISSING-DEST. |
| P1 | **Reaproveitamento da nota errada por número.** Uma NF de emitente/chave distintos, mas com mesmo número de outra nota sem carga, recebe `isOrphanReusable=true` e o ID da nota anterior. | `src/lib/ingestionValidator.ts:130–136` usa número isolado mesmo com identidade conflitante. `src/pages/Ingestion.tsx:894–906` reaproveita esse ID, podendo anunciar que a nova NF já está salva ou vincular a anterior. Caso IDENTITY-OTHER-ISSUER. |
| P1 | **Vínculo por nome sobrepõe CNPJ correto.** Dois clientes com mesmo nome/cidade e CNPJs diferentes: a nota encontra o CNPJ correto, mas acaba vinculada ao outro cliente. | `src/lib/ingestionValidator.ts:257–266` substitui o resultado exato pela correspondência de nome/cidade sem conferir o documento. Afeta cadastro associado, frete e carga. Caso CLIENT-CNPJ-PRIORITY. |
| P1 | **Dados ilegíveis não são bloqueados na validação.** Scan com destinatário e CNPJ `UNKNOWN` resulta em `hasErrors=false`. | Caso SCAN-UNKNOWN-IDENTITY. Inspeção complementar: `src/components/ingestion/ORTReviewStep.tsx:656` permite avançar sem uma condição de bloqueio; `src/pages/Ingestion.tsx:604` limpa `needsReview` ao editar qualquer campo; linhas 661–662 registram revisão manual como informação. A etapa de revisão existe, mas não exige resolver todos os campos críticos. |
| P1 | **Verificação da chave incompleta.** Uma chave de 44 zeros é aceita; alterar o número da nota de 123 para 999 sem mudar a chave também não gera erro. | `src/lib/fiscalDocuments/nfeAccessKey.ts:20` verifica comprimento e DV, sem consistência dos componentes. `validateNFe` não cruza número, série, modelo e emitente com a chave. Casos KEY-ZERO e KEY-IDENTITY. Validação de DV não comprova autenticidade/autorização fiscal. |
| P2 | **Conversão de item de scan inventa preço unitário.** Quantidade 10 e total 100, com unitário ausente, produzem unitário 100. | `src/lib/ingestion/ortUtils.ts:87–88` copia total para unitário (e vice-versa), sem considerar quantidade. Caso SCAN-UNIT-VALUE. Deve preservar ausência ou fazer cálculo explícito e auditável. |
| P2 | **Duplicata no mesmo lote de XML só aparece ao gravar.** Duas cópias da mesma NF passam pela validação como novas. | `src/pages/Ingestion.tsx:376–406` reutiliza índices apenas das notas já existentes, sem incorporar as lidas no lote. Caso XML-BATCH-DUPLICATE. O índice único remoto por empresa/chave mitiga gravação duplicada; não significa que duas notas serão efetivamente criadas, mas a prévia e os resultados parciais podem divergir. |
| P2 | **Mudança em itens não aparece em `changed_fields`.** Alterar quantidade de 1 para 2 mantém a lista de alterações vazia. | `src/lib/ingestion/ortUtils.ts:101` compara arrays de objetos com `String`, ambos viram `[object Object]`. Caso SCAN-AUDIT-ITEM. Os payloads anterior/posterior podem continuar diferentes; o defeito é na identificação de campos alterados. |

## Outros limites encontrados por inspeção

- **Erro de vínculo pode ser anunciado como sucesso:** no ramo de nota já salva, `Ingestion.tsx:898–906` aguarda `assign_fiscal_documents_to_load_v2`, mas não verifica o `error` retornado antes da mensagem de sucesso. Isso foi identificado por código, não reproduzido com gravação em produção.
- **Arquivos de entrada não têm uma política uniforme:** o fluxo XML lê todos os arquivos em paralelo sem limite explícito de tamanho/quantidade. O scan limita a 3 MiB por arquivo no cliente; o servidor aceita até 5 arquivos e limita 4 MiB de base64 por arquivo / 8 MiB no conjunto. O seletor aceita mais arquivos do que o servidor. Testes do gateway `secure-upload` não validam automaticamente esses caminhos, que não passam por ele para extração.
- **OCR depende de instruções ao modelo:** o backend passa os argumentos JSON retornados pelo gateway ao cliente, sem validação independente do schema, dos totais ou da coerência fiscal. Não há timeout explícito nessa chamada. Um prompt para não inventar dados não comprova precisão.
- **Preservação para conferência é limitada:** no caminho principal, o XML é lido localmente e o scan é enviado à IA. O salvamento analisado persiste campos selecionados e resumo de produtos truncado a 500 caracteres; não persiste o arquivo original nem toda a estrutura dos itens junto à nota. Não considerar esse fluxo uma importação integral do XML fiscal.
- **Cobertura configurada é parcial:** `vitest.config.ts` mede apenas cinco módulos selecionados e não inclui `documentParsers.ts`, `nfeXmlParser.ts` ou `ingestionValidator.ts`. A aprovação das suítes existentes não era evidência de precisão desses parsers.

## Situação remota e precisão de OCR

O projeto conectado é `PROJETO AGV LOG` (`qcvnsdrbcchaxvawcngk`). A consulta encontrou **2 auditorias OCR**, última em **21/07/2026**, confiança média registrada de **0,98**, sem alterações registradas nos campos. Esse número é confiança declarada pelo modelo, **não 98% de acurácia**. A amostra é pequena, antiga em relação à função publicada e o defeito de `changed_fields` limita ainda mais seu uso como evidência.

Há 61 relatórios históricos de ingestão, último em 12/08/2026. Seus totais agregados não devem ser usados como quantidade de notas únicas nem como taxa de acerto. Não houve comparação entre documentos reais e resultado extraído nesta auditoria.

O banco possui índice único por empresa/chave de entrada e índice composto para notas sem chave. Esses mecanismos protegem duplicidades exatas, mas não corrigem a seleção errada de uma nota existente no frontend. As CHECK constraints consultadas não incluem validação da chave NF-e.

## Critério para considerar pronto

1. Corrigir decimais e leitura por namespace; nunca buscar dados do destinatário no emitente como fallback.
2. Corrigir identidade de notas e precedência de CNPJ; bloquear conflitos e deduplicar o lote antes de salvar.
3. Validar a coerência da chave e dos campos essenciais; exigir revisão explícita das incertezas críticas de OCR.
4. Corrigir o mapeamento de preços de itens, auditoria de alterações e propagação dos erros de gravação/vínculo.
5. Converter os casos acima em regressões aprovadas e testar upload → revisão → persistência → reabertura, incluindo falha de rede e reenvio, em ambiente controlado.
6. Medir OCR com um conjunto representativo de DANFEs/PDFs/fotos e XMLs de referência, incluindo multipágina e imagens ruins. Comparar campo a campo; não usar apenas confiança do modelo.

**Limite deste parecer:** evidências executáveis locais e inspeção remota de leitura; sem E2E autenticado no navegador e sem chamada real ao OCR. A implementação frontend hospedada não foi comparada ao checkout local. Não foi feito deploy nem correção de lógica nesta tarefa.

