
## Smoke test — resumo do que confirmei

**Banco (leituras somente)**
- 48 rotas ativas nos 2 tenants, 21 inativas. **0 cidades servidas por 2+ rotas ativas** no mesmo tenant (colisão MG-* × ROTA já foi limpa).
- 358 `destinations` em forma `object`, 0 em `string` — schema consistente.
- 22 loads no tenant ativo (`planned` / `ready` / `loading`), **0 em `pending` e 0 em `on_hold`**; **0 loads com driver faltando**.
- 19 rascunhos, **0 vazios** / **0 duplicados por load** / **0 antigos (≥7d)**.
- 114 fiscal_documents órfãos aguardando vinculação (esperado).
- `dispatch_planned_route`, `_driver_load_ids`, `has_role` presentes e SECURITY DEFINER.
- `route_planning_stop_drafts`: 0 linhas — tabela existe com RLS/GRANT mas frontend nunca lê/escreve.

**Testes:** 217/217 passando (22 arquivos).

**Nota visual só de exibição:** ainda há 1 rascunho antigo cujo nome começa com `MG - ...` ao lado de um novo `ROTA - ...` para a mesma cidade. É rótulo textual do rascunho (não do catálogo de rotas), sem impacto operacional.

## Achados de código ainda pendentes

1. **`LoadReallocation.tsx`** – 3 pontos escapando da normalização canônica:
   - `mergeDestinations` (l. 23-38) deduplica tokens com `.toUpperCase()` **sem strip de acentos** → "SÃO PAULO" e "SAO PAULO" viram tokens diferentes ao combinar destinos.
   - `norm` local (l. 336-341) redefine o que `normalizeCity` já faz — 7ª cópia divergente do repositório.
   - `recipientsSummary` (l. 90-107) usa `recipient.trim()` cru → "Empresa X" ≠ "EMPRESA X" ao contar predominância.

2. **`RoutePlanning.tsx`** – 3 ocorrências in-line (`filteredLoads`, `destinations`, grouping key nas linhas 291, 300, 373) fazendo a normalização à mão em vez de importar `normalizeCity`.

3. **`PendingDocsGrouping.tsx` – fallback fuzzy perigoso** (l. 120-125). Quando não há match exato, aceita substring bidirecional: uma rota chamada só `RIO` casaria com "Rio Pardo"; `VELHO` casaria com "Porto Velho". Já há badge de ambiguidade + sort determinístico, mas o critério em si ainda contamina casos-limite. Precisa passar a exigir limite de palavra.

4. **Cobertura de testes** – `routeMatcher.test.ts` já cobre `RIO` × `Rio Pardo`, mas nada trava o fallback fuzzy hoje. Vale adicionar caso explícito e um teste novo para `mergeDestinations` (acento) e `recipientsSummary` (case).

## O que este plano faz

Rodada curta de código, sem migração e sem mexer em `route_planning_stop_drafts`/`op_route_norm` (permanecem deferidos).

### Passos

1. `src/pages/LoadReallocation.tsx`
   - Importar `normalizeCity` de `@/lib/utils/normalizeCity`.
   - Trocar a chave de dedupe em `mergeDestinations` de `t.toUpperCase()` para `normalizeCity(t)` (mantendo o token original na saída).
   - Remover a `norm` local e usar `normalizeCity`.
   - Normalizar chaves de `recipients`/`cities` em `recipientsSummary` (exibe o rótulo original, agrega pela chave normalizada).

2. `src/pages/RoutePlanning.tsx`
   - Importar `normalizeCity` e substituir as 3 expressões `.normalize('NFD').replace(...).toUpperCase()` inline por chamadas ao utilitário.

3. `src/components/loads/PendingDocsGrouping.tsx`
   - Reforçar o fallback fuzzy: aceitar apenas quando o token de rota aparecer como **palavra inteira** dentro da cidade (regex com `\b`), impedindo `RIO ⊂ RIO PARDO` sem match exato.
   - Manter o path de exato + sort determinístico + badge de ambiguidade já existentes.

4. Testes
   - Estender `src/test/routeMatcher.test.ts` com o caso fuzzy: rota "VELHO" **não** deve casar com "Porto Velho" quando não há match exato.
   - Novo `src/test/loadReallocationMerge.test.ts` com casos:
     - `mergeDestinations("Pai Pedro", "SÃO PAULO")` + `mergeDestinations(..., "SAO PAULO")` — não duplica.
     - Agregação de destinatários é case/acento-invariante.
   - Rodar toda a suíte (esperado ≥219 testes verdes).

### Deferido explicitamente

- Remover `route_planning_stop_drafts` (tabela, RLS, GRANT, tipos) — envolve migração destrutiva.
- Substituir `op_route_norm` (translate) por versão NFD no Postgres — envolve reindexação de `operational_routes(tenant_id, op_route_norm(name))`.
- Renomear rascunhos antigos `MG - ...` no tenant ativo — decisão de UX do operador.

### Detalhes técnicos

```text
Arquivos alterados
  src/pages/LoadReallocation.tsx           (import + 3 hotspots)
  src/pages/RoutePlanning.tsx              (import + 3 inlines)
  src/components/loads/PendingDocsGrouping.tsx  (fallback fuzzy com \b)
  src/test/routeMatcher.test.ts            (+1 caso)
  src/test/loadReallocationMerge.test.ts   (novo)

Sem migração. Sem mudança de contrato de RPC. Sem alteração no motorista/app.
```

Aprova essa rodada?
