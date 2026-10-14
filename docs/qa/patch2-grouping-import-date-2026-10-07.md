# PATCH2: data de importação para Agrupar NF-es

Demanda D-P2-IMPORT; aceite CT-IMPORT-GROUP. Task patch2-ssx-loads-reconciled-20261007, owner CodexPatch2, base administrativa reconciliada 6f6361ce86dc1c8d4d8d7c6e4849bcb340aa5838 (tree idêntica ao PATCH1 publicado). Fontes PATCH1, worktree anterior e candidato8d preservados. Sem publicação, execução fiscal, SQL novo para cargas ou alteração produtiva.

## Comportamento

O botão Agrupar NF-es e o modal de Retomar agrupamento oferecem Importação de/até, Importados hoje e Limpar datas. Campos vazios incluem todas as pendentes elegíveis. O período usa imported_at e, somente se ausente/nulo, created_at; nunca emissão/faturamento ou criação da carga. Reutiliza os helpers do fluxo manual, sem alterá-los: dia civil no fuso da empresa, início inclusivo e fim exclusivo no próximo dia. Importados hoje captura o dia no clique; a seleção permanece estável se o relógio vira durante um pedido pendente.

O filtro precede grupos, combinações, paletes, peso, valor e document_ids. Alteração deliberada do período limpa combinação, seleção e atribuições anteriores e recalcula sugestões. Nenhuma nota oculta pelo período entra no comando. Campos permanecem visíveis e editáveis em intervalo inválido ou sem resultados. Erro de intervalo impede criação. Criação em curso, recuperação pendente, erro de outbox, leitura em curso/indisponível bloqueiam mudanças do período. Refetch no mesmo contexto conserva seleção e período. Troca de empresa limpa o período; a boundary real existente desmonta estado em troca de ator/role/signout, conservada pelos testes herdados.

O transporte continua paginado e escopado por tenant, inbound, confirmed, sem carga/exclusão; seleção mantém o guard histórico de tentativa anterior emitida. Não exclui indiscriminadamente documentos que já tiveram emissão. Mesmas APIs, UUID/outbox e recuperação: resultado incerto recupera o pedido original, sem reconstruir payload com outro período.

## Problema confirmado de escopo na Importação

Finding PROD-AUD-INGESTION-PENDING-SCOPE-001 / risco R-PROD-AUD-INGESTION-PENDING-SCOPE-001 / revisão REV2-PROD-AUD-INGESTION-PENDING-SCOPE-001. Aceite independente CT-PROD-AUD-INGESTION-SCOPE na demanda oficial D-P2-INGESTION-PENDING-SCOPE, relacionada a D-P2-IMPORT. IDs conciliados com a releitura do catálogo central AGVLOG-CAT-DEMANDAS-001 após o primeiro selo; são objetivos distintos, sem duplicar filtro de datas. A página contava qualquer documento não cancelado/sem carga, mas o modal aceitava somente inbound/confirmed e disponibilidade histórica válida.

A contagem, lista e promessa Retomar agrupamento agora usam esse conjunto elegível. Cinco registros mistos reproduzem a diferença anterior3 versus elegível1; fixture adicional inclui transfer, exclusão e tentativa anterior emitida, preservando primeira emissão sem tentativa anterior. Erro de leitura exibe indisponibilidade e retry, escondendo a lista/promessa anterior; refresh bloqueia abertura até nova leitura. As cifras produtivas506/253 isoladamente não demonstram quantidade de CT-es excedentes ou notas elegíveis. Nenhum dado produtivo foi alterado.

## Verificação e limites

Testes próprios usam UI, React Query, SDK PostgREST, paginação e outbox reais com HTTP sintético e actors/tenants fictícios. Casos: dia São Paulo/UTC, limites inclusivo/exclusivo, importação diferente da criação/emissão, legado, período unilateral/vazio/inválido, grupos/totais/payload, reset de combinação, refetch/erro/retry, recuperação do mesmo UUID/payload e troca de empresa. Testes da lista Ingestion isolam a apresentação com dados mistos; não homologam Auth, RLS ou SQL real. Os testes herdados da boundary Auth/Tenant/reconexão complementam os mocks de contexto do teste novo.

Typecheck, lint, qualidade, build e testes serão registrados no handoff com SHA/tree exatos. O documento não é prova de homologação nativa/CI hospedado. Automações/acessos previamente bloqueados continuam restritos. Não há mudança no controle de contas de motorista (outra frente), address queue (outro worker), emissão fiscal ou exclusões suspensas.
