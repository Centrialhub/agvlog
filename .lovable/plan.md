
## Diagnóstico (verificado no banco)

Na tabela `operational_routes` do seu tenant existem **49 rotas ativas**, mas na verdade são **dois catálogos sobrepostos** que foram semeados em datas diferentes:

- **15/04** — catálogo por município: `MG-JAIBA`, `MG-JANUARIA`, `MG-DIAMANTINA`, `MG-PIRAPORA`, `MG-JANAUBA`, `MG-CURVELO`, `MG-BOCAIUVA`, `MG-ESPINOSA`, …
- **16/04** — catálogo por rota comercial: `ROTA 24 - JANUARIA`, `ROTA 29 - DIAMANTINA`, `ROTA 26 - PIRAPORA`, `ROTA 23 - JANAUBA / ESPINOSA`, `ROTA 22 - MONTES CLAROS / CURVELO`, …

Nenhuma linha tem `updated_at ≠ created_at`, ou seja, **nenhuma rota foi renomeada manualmente**. O que o operador percebeu como “a rota mudou de nome sozinha” é o **matcher** de `src/lib/route-planning/loadGrouping.ts` escolhendo a primeira rota cuja lista de `destinations` bate com a cidade predominante da carga — como existem duas rotas cobrindo a mesma cidade, ora vem `MG-JANUARIA`, ora `ROTA 24 - JANUARIA`, dependendo da ordem do array. E, na tela `/operational-routes`, ambos aparecem lado a lado, dando a sensação de duplicata.

Também não há `UNIQUE(tenant_id, name)` nem normalização, então nada impede novas duplicatas por acento/caixa (`MG-JAIBA` vs `MG-JAÍBA`, `ROTA 24 - JANUARIA` vs `Rota 24 – Januária`, etc.). Não há linhas em `route_templates` nem em `route_planning_drafts`, então o problema está isolado neste catálogo.

## Plano

### 1. Consolidar o catálogo em uma versão só (banco)

- Escolher a família **`ROTA NN - NOME`** como canônica (é a que a operação nomeia no dia-a-dia).
- Para cada par sobreposto (mesma cidade base), fazer:
  - copiar destinos da versão `MG-…` para a `ROTA NN - …` se faltar algum;
  - marcar `active = false` na versão `MG-…` (não deletar — preserva histórico e qualquer referência antiga).
- Deixar ativas apenas rotas `MG-…` que **não têm** equivalente em `ROTA NN - …` (ex.: `MG-MC-001`, `MG-MIRABELA`, `MG-ARACUAI`, `MG-ITACAMBIRA`, `MG-FRANCISCO SA`, `MG-BR. DE MINAS`, `MG-C. JESUS`, `MG-PORTEIRINHA`), até o operador decidir.

Migration executa esse merge em SQL determinístico, sem apagar nada.

### 2. Impedir novas duplicatas e renomes silenciosos

- `CREATE UNIQUE INDEX operational_routes_tenant_name_key ON operational_routes (tenant_id, lower(unaccent(name))) WHERE active`;
- Trigger simples que **preserva `name` quando não foi enviado no `UPDATE`** — corta o caso em que a UI envia o form inteiro com um campo em branco e “renomeia” a rota sem querer;
- Auditoria: adicionar `INSERT INTO entity_audit_log` em `AFTER UPDATE OF name` para que qualquer alteração futura fique rastreável (quem, quando, de onde para onde).

### 3. Corrigir o matcher para ser estável

Em `src/lib/route-planning/loadGrouping.ts`:

- Ordenar `operationalRoutes` de forma determinística antes do `for` (por `name`), para que o mesmo load caia sempre na mesma rota;
- Ignorar rotas inativas;
- Quando **mais de uma** rota ativa casar com a cidade, marcar o grupo com `requires_review = true` e `review_reason = "Cidade X pertence a mais de uma rota cadastrada."` — força o operador a resolver a ambiguidade no catálogo em vez de sortear.

### 4. UX de `/operational-routes`

- Coluna extra “Cidades” contando destinos, e badge `Duplicada?` quando existir outra rota ativa com pelo menos uma cidade em comum;
- Filtro “Somente ativas” ligado por padrão;
- Botão em massa **Desativar selecionadas** (não excluir) para consolidação futura;
- Ao salvar, se o `name` normalizado colidir com outra ativa, mostrar toast com link para a rota existente em vez de erro cru do Postgres.

### 5. Congruência com o resto do sistema

- `/route-planning` e `/loads` já leem `operational_routes` filtrando por `active`? Confirmar e ajustar as duas queries — caso contrário rotas desativadas na etapa 1 continuariam aparecendo em selects.
- Nenhuma alteração no app do motorista, no portal ou nos PDFs (não referenciam esta tabela).

## Detalhes técnicos

```text
Passo 1 — merge SQL (idempotente):
  WITH pares AS (
    SELECT r_mg.id AS old_id, r_rt.id AS new_id
    FROM operational_routes r_mg
    JOIN operational_routes r_rt
      ON r_rt.tenant_id = r_mg.tenant_id
     AND r_rt.name LIKE 'ROTA %'
     AND r_mg.name LIKE 'MG-%'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(r_mg.destinations) d_mg
         JOIN jsonb_array_elements(r_rt.destinations) d_rt
           ON translate(lower(coalesce(d_mg->>'name', d_mg::text)), 'áàâãéêíóôõúç', 'aaaaeeioooucс')
            = translate(lower(coalesce(d_rt->>'name', d_rt::text)), 'áàâãéêíóôõúç', 'aaaaeeioooucс')
     )
  )
  UPDATE operational_routes SET active=false, updated_at=now()
   WHERE id IN (SELECT old_id FROM pares);
```

Migração adicional cria o índice único parcial, o trigger de proteção de nome e o gatilho de auditoria em `entity_audit_log`.

Frontend:

- `src/lib/route-planning/loadGrouping.ts` — filtro `active` + sort + detecção de ambiguidade.
- `src/hooks/useOperationalRoutes.tsx` — passar a filtrar `active=true` por padrão, com flag opcional `includeInactive` para a tela de gestão.
- `src/pages/OperationalRoutesPage.tsx` — badge de duplicata, filtro ativo/inativo, mensagem de conflito no salvar.

## O que **não** vou fazer

- Não vou deletar rotas históricas — apenas desativar.
- Não vou renomear rotas existentes.
- Não vou mexer em `route_templates` (corredores de telemetria) — problema é só em `operational_routes`.
