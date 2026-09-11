# Comprovante pré-batch — mapa e ensaio independente

11/09/2026. Validação local da64852, SHA256 3c43f6aaa74571d03f86fb9533989098bdf689c12f5a3ac453dc4537dde3f215. Nenhuma migração/produto foi alterada por esta frente.

## Dependências concretas

- 212514 finance_delivery_unloading: receipt_path NOT NULL na cobrança; writer exige prefixo do tenant. Nova alternativa precisa comprovação por intenção/artefato exatos, não string sintética.
- 213959 finance_expense_batches: allowlist do item, CHECK receipt_path ou justificativa, validação e forward para record_unloading; grava também receipt_path no payable. Null é deliberado para a alternativa v2, sem justificar artificialmente ausência.
- 211156 unloading_projection_repair e45402 unloading_origin_amendments: prova da origem exige igualdade entre comando original e charge.receipt_path. Os dois precisam reconhecer consumo v2; NULL=NULL não comprova origem.
- 42754 expense_receipt_source/history e44823 expense_receipt_count: artefato hoje pertence diretamente à despesa. A nova intenção deve ser contada apenas após consumo pela mesma linha/pedido/ator, com objeto/hash/método/evento ainda válidos.
- 51729 e60700 list_expenses: consumo deve remover a pendência de comprovante e preservar origem/custo verificados no DTO real. Totais não podem criar custo adicional por anexo.
- 53349/54915/60519: cancelamento/correção usam origem de cobrança e snapshots de expense/batch/payable. Não adicionar colunas em expense; comparar to_jsonb, verified e revision de uma correção existente antes/depois. A prova nova pertence somente à nova origem.
- 62534: boundary pública exige leitor60700. A integração deve conservar reader/writer boundary e não ampliar ACL raw/anon.

## Fixture pronta

`src/test/helpers/preparedReceiptCostIntegrationDatabase.ts` instala40123/42754/44437 completas sobre a factory monetary existente; instala auxiliares de empresa ativa/not_driver dos arquivos reais e reutiliza60700/62534. O adapter evita exclusivamente3excertos DDL/DTO idênticos já executados pelas migrations completas; não substitui função por sucesso simulado. Uma mudança desses excertos falha explicitamente.

`src/test/helpers/preparedReceiptImageCallback.ts` faz reserva pública autenticada e prepare/finalize pelo papel service_role reais. Metadata do Storage representa callback do PNG observado no benchmark hospedado anterior. Não afirma novo upload/decodificação Edge, nem escaneamento antivírus.

`src/test/preparedReceiptCostIntegration.test.ts`: primeiro caso passou03:53:38 em PGlite. Cria descarga/gasto reais, corrige150→120 antes da integração; instala comprovantes/leitores; compara registros expense/charge e resultado inteiro do resolver (inclui revision/verified/history); valida parser expenseHistory. Reserva/finaliza imagem com protocolo SQL real e confirma revisão do custo inalterada. Esse caso ainda NÃO prova a nova64852.

## Casos da candidata agora aprovados

Descarga v2 completa com receipt_path/no_receipt_reason NULL, reader count1/origem/custo verificados; custo legado corrigido preservado antes/depois64852; replay; tenant/ator/linha/pedido divergentes; imagem não finalizada/hash/método inválido; falha do último item/evento revertendo custos/recebíveis/payables/consumo e conservando intenção para retomada. Testes SQL não substituem o teste do modal/Edge nem concorrência PostgreSQL nativa.


## Resultado final independente

6 testes passaram em2arquivos em11/09/2026 às04:05:21, duração Vitest4.80s, exit0. ESLint dos4arquivos TS de teste/helper terminou com exit0. Nenhuma alteração em SQL ou fixtures compartilhadas. A candidata corresponde ao hash congelado informado acima.

- Trip/office/personnel/maintenance/other: preparação→reserva→prepare/finalize de imagem→batch real→constraints diferidas executadas explicitamente→history count1/receipt_intent_id→replay idêntico. Nenhum movimento financeiro criado.
- Office/maintenance/other rejeitam trip_id indevido; tenant diferente, linha trocada e imagem ainda quarantined falham sem consumo.
- Nova descarga real possui expense.receipt_path, no_receipt_reason e charge.receipt_path NULL. Origem de cobrança permanece verified no fornecedor devedor distinto do prestador; custo verified15000, readercount1. Prévia de correção positiva e cancelamento coordenado elegíveis, sem bloqueios.
- Outro ator com papel admin válido não usa a intenção do primeiro. Falha de teste no evento do segundo comprovante ocorre após criar a primeira descarga; rollback preserva contagens anteriores de gastos, descargas, recebíveis, pagáveis, comandos, eventos e consumos. Tickets remanescentes0; remover somente a falha injetada permite retomar o MESMO payload e consumir os2comprovantes.
- Correção150→120 existente ANTES64852: to_jsonb(expense/charge), catálogo de colunas da despesa e resolver inteiro (verified/revision/history/valores) permanecem iguais após instalar a candidata. A prova não depende do banco produtivo vazio.

Parsers de produção usados: expenseReceiptIntentResultSchema, uploadArtifactSchema, expenseArtifactsSchema, expenseHistorySchema, unloadingEffectiveOriginSchema, expenseCostOriginSchema. Somente o import do cliente Supabase de navegador é isolado por mock vazio para ler o schema em Node; todas as chamadas de negócio são SQL real via PGlite.

A primeira coleta do teste novo falhou porque importar o schema do client inicializava localStorage em Node; corrigido apenas isolamento de import. A fixture ancestral omitira finance_expense_items_check: foi restaurado o CHECK original exato ANTES da candidata, preservando MD5 obrigatório b72a632f12899cf7765a46b46770ed8f. Nenhum guard foi relaxado.

Limites: PGlite e grafo monetário selecionado, não concorrência PG nativa nem schema inteiro da produção. Imagem é callback com metadata do benchmark anterior e SQLfinalizer real; não novo download/upload/codecEdge. Mantêm-se fora deste ensaio a interface e disputa de sessões simultâneas. Não certificar readiness integral de produção por estes testes. Manifesto de hashes: finance-prepared-receipt-independent-2026-09-11.json.
