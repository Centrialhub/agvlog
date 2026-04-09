

# Auditoria Pós-Mudanças Recentes

Após analisar o código-fonte, o build, os logs de runtime e a estrutura do banco, identifiquei os seguintes problemas e riscos:

---

## Bugs Confirmados

### 1. `calcTotals` com dependência circular no `useCallback`
**Arquivo:** `src/pages/Orders.tsx`, linha 81-119

A função `calcTotals` depende de `[form]` inteiro no array de dependências do `useCallback`. Isso significa que **a cada tecla digitada**, uma nova referência é criada. Porém o problema real é que `calcTotals` lê `form` do closure e depois chama `setForm` — se o usuário digitar rapidamente e clicar "Calcular", os valores podem estar desatualizados. Deveria usar `setForm(prev => ...)` para ler o estado mais recente.

### 2. Cast `(o as any).city` no PDF do RoutePlanning
**Arquivo:** `src/pages/RoutePlanning.tsx`, linha 307

O campo `city` está definido na interface `PendingOrder` (linha 44), então o cast `(o as any).city` é desnecessário. Não é um bug funcional, mas indica código inconsistente.

### 3. `useGenerateCTe` — join incorreto em `load_items`
**Arquivo:** `src/hooks/useGenerateCTe.tsx`, linhas 82-85

A query faz `.select('..., orders(order_number, clients(company_name))')` sobre `load_items`, mas a tabela `load_items` não tem foreign key declarada para `orders`. O Supabase PostgREST **não** consegue resolver joins sem FK. O resultado será um erro silencioso ou dados nulos no `itemSummary`. A query precisa ser ajustada para buscar orders separadamente via `load_orders`.

### 4. Falta `pallet_count` com default diferente entre Order interface e DB
**Arquivo:** `src/hooks/useOrders.tsx` — `pallet_count: number` (não nullable)
**DB:** `pallet_count integer DEFAULT 0` (nullable: Yes)

A interface declara `pallet_count: number` mas o DB permite null. Se um pedido antigo tiver null, o TypeScript não reclamará mas o runtime pode mostrar `null` onde espera número.

---

## Riscos Funcionais

### 5. Status transition sem validação no frontend
**Arquivo:** `src/pages/Orders.tsx`, linhas 162-164

O formulário permite selecionar **qualquer** status ao editar um pedido. O `statusPipeline.ts` define transições válidas (`ORDER_TRANSITIONS`), mas **nunca é usado** na tela de pedidos. Um operador pode pular de "Recebido" direto para "Entregue".

### 6. RoutePlanning — estado perdido ao navegar
As rotas planejadas ficam apenas em `useState`. Se o usuário sair da página e voltar, perde tudo. Não há persistência no banco.

### 7. Tabela de fretes sem FK — integridade referencial fraca
`freight_tables`, `client_regions`, `orders`, `loads`, `load_items`, `load_orders` — nenhuma dessas tabelas possui foreign keys declaradas no banco. Isso permite dados órfãos (ex: `load_items.order_id` apontando para um order deletado).

### 8. `useGenerateCTe` — sem campos IBS/CBS no CT-e
O CT-e gerado pelo `useGenerateCTe` não inclui os novos campos de IBS e CBS que foram adicionados na reforma tributária. A tabela `fiscal_documents` também não possui essas colunas — elas só existem em `orders`.

---

## Plano de Correção

### Etapa 1 — Corrigir bugs críticos
- **Corrigir `calcTotals`**: Usar `setForm(prev => { ... })` em vez de ler do closure
- **Remover cast `(o as any).city`** no RoutePlanning
- **Corrigir query do CT-e**: Substituir o join inválido `load_items → orders` por busca via `load_orders`

### Etapa 2 — Validação de transições de status
- Na tela de pedidos, filtrar o Select de status usando `getNextStatuses()` do `statusPipeline.ts`, mostrando apenas transições válidas a partir do status atual

### Etapa 3 — Consistência de tipos
- Ajustar `pallet_count` na interface `Order` para `number | null` ou garantir coerção no fetch

### Etapa 4 — IBS/CBS no CT-e (se necessário)
- Avaliar se `fiscal_documents` precisa das colunas de IBS/CBS para o portal fiscal. Se sim, criar migração e atualizar o hook `useGenerateCTe`.

### Etapa 5 — Persistência de rotas planejadas (melhoria futura)
- Considerar salvar rascunhos de roteirização no banco para não perder ao navegar

---

## Resumo de Prioridades

| # | Problema | Severidade | Esforço |
|---|----------|-----------|---------|
| 3 | Join sem FK no CT-e | Alto — dados sempre nulos | Baixo |
| 5 | Status sem validação | Médio — erro operacional | Baixo |
| 1 | calcTotals closure | Baixo — raro em uso normal | Baixo |
| 8 | IBS/CBS no CT-e | Médio — compliance fiscal | Médio |
| 6 | Rotas não persistidas | Médio — UX | Alto |
| 7 | FKs ausentes | Baixo — dados órfãos possíveis | Alto |

