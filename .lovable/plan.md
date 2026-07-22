
## Objetivo

Facilitar o manejo de cargas em /loads: hoje, depois de criada, a carga parece "empurrada" para o fluxo de despacho. Vamos permitir **pausar/adiar** uma carga sem cancelar nem apagar, e dar uma **visão consolidada em Kanban** por situação.

Sem criar módulo novo — é uma nova visão + um estado operacional adicional em cima do que já existe.

## Escopo funcional

### 1. Novo estado operacional "Em espera" (hold)

- Carga em espera fica **fora do fluxo de despacho**: não aparece em Route Planning, não é sugerida em Trips, some das telas operacionais como "próximas cargas".
- Continua totalmente visível em /loads, com badge próprio, e pode ser reativada a qualquer momento voltando ao status anterior.
- Não é status do pipeline (não substitui `planned/assembling/ready/...`). É uma flag operacional paralela, para não quebrar as transições canônicas nem a auditoria já existente.

### 2. Ações rápidas na carga

Na lista e no detalhe da carga:
- **Colocar em espera** (com motivo opcional em texto livre).
- **Retomar** (tira do hold, volta a aparecer nas telas operacionais).
- Motivo e datas ficam registradas para auditoria simples.

### 3. Nova visão Kanban em /loads

Botão de alternância **Tabela ↔ Kanban** no topo (mantém a tabela atual intacta).

Colunas do Kanban, agrupando os status existentes:

```text
┌────────────┬────────────┬──────────────┬──────────────┬──────────────┬─────────────┐
│ Em espera  │ Backlog    │ Preparação   │ Pronta       │ Em rota      │ Concluídas  │
│ (hold)     │ planned    │ assembling   │ ready/loaded │ in_transit   │ delivered / │
│            │            │ loading      │              │              │ terminais   │
└────────────┴────────────┴──────────────┴──────────────┴──────────────┴─────────────┘
```

- Cards mostram: número da carga, cidade/rota predominante, cliente predominante, veículo, motorista, contagem de NFs, badge de "sem app" se motorista não tem conta vinculada.
- **Drag & drop entre "Em espera" e "Backlog"** (única transição livre). Demais colunas seguem o pipeline canônico e só reagem aos eventos operacionais existentes — arrastar entre elas mostra tooltip explicando por que a transição precisa vir da operação (não vamos burlar `statusPipeline.ts`).
- Filtros e busca da tela atual (data, veículo, cliente, avançados) ficam aplicáveis ao Kanban.

### 4. Integrações com o resto do sistema

- **Route Planning / cargas pendentes**: passam a filtrar `on_hold = false`.
- **DriverHome / app do motorista**: cargas em hold não aparecem como "atribuídas" nem geram alerta de "sem viagem".
- **Auditoria**: cada hold/unhold entra em `load_status_history` como evento não-transicional (com campo `note` = motivo), reutilizando a tabela que já existe.

## Detalhes técnicos

### Banco (uma migração)

Em `public.loads`:
- `on_hold boolean NOT NULL DEFAULT false`
- `hold_reason text NULL`
- `held_at timestamptz NULL`
- `held_by uuid NULL` (referência a `auth.uid()`)
- Índice parcial: `CREATE INDEX loads_on_hold_idx ON loads (tenant_id) WHERE on_hold = true;`

RPCs:
- `hold_load(_load_id uuid, _reason text)` — seta os campos + insere em `load_status_history` (tipo `hold`).
- `unhold_load(_load_id uuid)` — limpa os campos + insere `unhold`.
- Ambas com `SECURITY DEFINER`, validando pertencimento ao tenant e papel operator/admin/owner.

Sem novas tabelas, sem novas policies (as políticas atuais de `loads` já cobrem update via RPC).

### Frontend

Arquivos afetados (edição apenas, sem novos módulos):
- `src/hooks/useLoads.ts` — expor `on_hold`, `hold_reason`, `held_at`; hooks `useHoldLoad` / `useUnholdLoad`.
- `src/pages/Loads.tsx` — toggle Tabela/Kanban, ações rápidas "Colocar em espera" / "Retomar" no menu da linha e em ações em lote.
- `src/components/loads/LoadsKanban.tsx` (novo componente, uma tela só) — colunas descritas acima, cards e DnD entre `Em espera ↔ Backlog` usando `@dnd-kit/core` (já no projeto se disponível; caso não esteja, usar botões "Retomar" / "Pausar" no card, sem DnD — a decisão fica dentro do componente, não bloqueia o plano).
- `src/pages/RoutePlanning.tsx` e hooks correlatos — adicionar `.eq('on_hold', false)` nas queries de cargas pendentes.
- `src/pages/driver/DriverHome.tsx` e `_driver_load_ids()` — excluir cargas com `on_hold = true` da visão do motorista.
- `src/lib/status/loadStatus.ts` — helpers `isHold(load)` e mapeamento coluna Kanban por status.

### Testes

- Ampliar `src/test/rlsDriverLoads.test.ts` (ou arquivo novo curto) para: motorista **não** vê carga em hold; ao dar unhold, volta a ver.
- Teste unitário do mapeamento `status → coluna Kanban`.

## Fora de escopo (para não inchar)

- Prioridade alta/normal/baixa, arquivamento, agenda por data prevista de despacho: ficam para uma rodada seguinte se você validar essa primeiro.
- Nenhuma mudança no pipeline canônico de status nem em Trips.

## Entrega

1. Migração (campos + RPCs).
2. Ajuste dos hooks e queries afetadas (Route Planning, DriverHome, `_driver_load_ids`).
3. Kanban + ações de hold/unhold em /loads.
4. Testes.
5. Build + testes passando.
