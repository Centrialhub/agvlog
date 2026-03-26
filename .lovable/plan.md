

# Plano de Ação: Completar Funcionalidades para Produção

## Estado Atual

O sistema tem uma base sólida mas várias funcionalidades estão incompletas ou superficiais. Após auditoria do código, identifiquei 13 itens de trabalho organizados em 3 fases por prioridade de impacto.

---

## FASE 1 — Fechar o Ciclo Operacional (maior impacto)

Sem estes itens, o sistema é apenas um painel administrativo. Motoristas não conseguem operar e a ponte admin→campo não funciona.

### 1.1 Fluxo de Despacho com Múltiplas Paradas
**Problema**: O diálogo de despacho em `LoadDetail.tsx` cria apenas 1 parada fixa. Não permite definir sequência de entregas.
**Solução**: Refatorar o diálogo de despacho para permitir adicionar N paradas (cliente + destino + ordem), usando os `load_items` da carga para sugerir paradas automaticamente por cliente/destino. Criar as `dispatch_stops` em lote.

### 1.2 Filtrar Driver por Usuário Logado
**Problema**: `DriverHome`, `DriverStops`, `DriverDeliveries`, `DriverJourney` buscam trips de todo o tenant — não filtram pelo motorista logado.
**Solução**: Adicionar coluna `user_id` na tabela `drivers` (migration). Criar hook `useCurrentDriver` que busca o driver vinculado ao `auth.uid()`. Usar `driver_id` como filtro em todas as queries do workspace do motorista. Adicionar RLS policies para drivers verem apenas seus dados.

### 1.3 Persistir Checklist do Motorista
**Problema**: `DriverChecklist.tsx` usa apenas `useState` local — dados perdem-se ao recarregar.
**Solução**: Salvar checklists como `dispatch_events` com `event_type = 'checklist_pre'` ou `'checklist_post'` e `payload` contendo os itens marcados. Carregar estado anterior ao abrir.

### 1.4 Vincular Despesas à Viagem Ativa
**Problema**: `DriverExpenses.tsx` cria despesas sem `dispatch_trip_id` nem `driver_id`.
**Solução**: Usar o hook `useCurrentDriver` para preencher `driver_id`. Buscar trip ativa do motorista para preencher `dispatch_trip_id` automaticamente.

### 1.5 Upload de Comprovante (bucket privado)
**Problema**: O bucket `receipts` é privado (`is_public: false`), mas o código usa `getPublicUrl()` que não funciona para buckets privados.
**Solução**: Usar `createSignedUrl()` para visualização, ou criar uma storage policy que permita leitura autenticada. Ajustar `ExpenseApproval.tsx` para usar signed URLs ao exibir comprovantes.

---

## FASE 2 — Fortalecer o que Existe

### 2.1 Pedidos com Filtros e Vínculo a Cargas
**Problema**: `Orders.tsx` é uma tabela crua sem filtros por status/cliente e sem mostrar vínculo com cargas.
**Solução**: Adicionar filtros por status e cliente. Fazer join com `load_orders` para exibir badge de carga vinculada. Adicionar link para `/loads/:id`.

### 2.2 Documentos Fiscais com Filtros e Link à Carga
**Problema**: `FiscalDocuments.tsx` não filtra por tipo (NF-e vs CT-e) nem mostra carga vinculada.
**Solução**: Adicionar filtros por `document_type` e status. Exibir `load_id` como link clicável para `/loads/:id`.

### 2.3 Client Portal Filtrado pelo Cliente Logado
**Problema**: `ClientPortal.tsx` busca todos os pedidos/cargas do tenant — clientes veem dados de outros clientes.
**Solução**: Vincular `user_id` ao `client_id` (similar ao driver). Filtrar queries por `client_id` do usuário logado. Adicionar indicador de progresso visual por carga.

### 2.4 Permissões por Role no Frontend
**Problema**: Qualquer usuário pode acessar qualquer rota digitando a URL. Sidebar mostra tudo para todos.
**Solução**: Filtrar `navSections` em `AppLayout.tsx` baseado no `currentRole`. Adicionar guard em `ProtectedRoute` que redireciona roles não-autorizadas. Drivers → `/driver`, clients → `/portal`.

### 2.5 Produtividade com Dados Reais
**Problema**: `ProductivityReports.tsx` calcula métricas apenas de loads em memória, sem usar `dispatch_events` (tempos reais).
**Solução**: Buscar `dispatch_events` para calcular tempo médio por parada, tempo de jornada, tempo parado. Adicionar filtro por período de data.

---

## FASE 3 — Escalar com Confiança

### 3.1 Testes Unitários para Caminho Crítico
**Solução**: Criar testes para:
- `documentParsers.ts` (parsing XML/CSV)
- `ingestionValidator.ts` (validação)
- `statusPipeline.ts` (transições de status)
- Cálculo de totais de load_items

### 3.2 Notificações Realtime
**Solução**: Usar Supabase Realtime channels para:
- Notificar motorista quando trip é criada
- Notificar operador quando motorista confirma entrega
- Atualizar `OperationsCenter` em tempo real

### 3.3 Busca Global (Command Palette)
**Solução**: Criar componente de busca global (Cmd+K) que pesquisa cargas, pedidos e clientes simultaneamente usando queries debounced.

---

## Mudanças de Banco de Dados Necessárias

```text
Migration 1: ALTER TABLE drivers ADD COLUMN user_id uuid REFERENCES auth.users(id);
Migration 2: ALTER TABLE clients ADD COLUMN user_id uuid REFERENCES auth.users(id);
Migration 3: Storage policy para bucket receipts (leitura autenticada)
Migration 4: RLS policies para drivers INSERT em dispatch_events (permitir motoristas registrarem eventos)
Migration 5: RLS policies para drivers INSERT em driver_expenses
Migration 6: RLS policies para drivers UPDATE em dispatch_stops (marcar chegada/saída)
```

---

## Estimativa de Escopo

| Fase | Itens | Complexidade |
|------|-------|-------------|
| Fase 1 | 5 itens | Alta — fecha o ciclo operacional |
| Fase 2 | 5 itens | Média — melhora UX e segurança |
| Fase 3 | 3 itens | Média — qualidade e escala |

**Recomendação**: Implementar Fase 1 primeiro (itens 1.1–1.5), pois desbloqueiam o uso real do sistema por motoristas e operadores.

