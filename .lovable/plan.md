## Problema

"Janaúba" e "Janauba" (com/sem acento) aparecem como cidades diferentes no romaneio impresso e na etapa de agrupamento da importação, quebrando a unificação por cidade.

## Causa

Dois pontos agrupam cidade só com `toUpperCase()`, sem remover acentos:

- `src/lib/romaneioPrint.ts:63` — chave do agrupamento por cidade no romaneio (`printRomaneioRoutes`, usado em Loads, RoutePlanning e app do motorista).
- `src/components/ingestion/GroupingStep.tsx:224` — chave de agrupamento por cidade na etapa de agrupar notas.

Outros locais (Ingestion.tsx, RoutingStep, ingestionValidator, PendingDocsGrouping, loadGrouping) já normalizam com `NFD` + strip de diacríticos.

## Correção

1. Criar/usar um util único de normalização de cidade para chave (upper + NFD strip + trim de espaços múltiplos), reaproveitando o padrão já existente em `RoutingStep.normalizeCity`. Colocar em `src/lib/utils/normalizeCity.ts` para importação compartilhada.
2. `romaneioPrint.ts`: usar esse util como chave do `cityMap`, mantendo o display original da primeira ocorrência (`d.city`) no cabeçalho da seção — assim "Janaúba" e "Janauba" caem no mesmo grupo e o cabeçalho mostra a grafia canônica encontrada.
3. `GroupingStep.tsx`: mesma normalização para a chave de agrupamento, preservando o nome exibido.
4. Não alterar dados no banco, RPC, telas de cadastro de rotas nem lógica de matching de rotas (já normalizam).

## Verificação

- Rodar `bun test` (suíte atual, incl. `routeConsistency`).
- Sanity check manual: reimprimir romaneio com mistura de "Janaúba/Janauba" e conferir uma única seção.

Sem mudanças de schema, sem migração.
