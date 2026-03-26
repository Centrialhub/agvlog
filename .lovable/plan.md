

# Diagnóstico: O que falta para acelerar o crescimento

## Análise do estado atual

Após revisão completa do código, a plataforma tem uma boa fundação mas possui lacunas significativas que impedem uso real em produção. Abaixo, organizadas por impacto no crescimento:

---

## 1. LACUNAS CRÍTICAS (bloqueiam uso real)

### 1.1 Driver Workspace incompleto
- **DriverStops**: página vazia — não carrega paradas da viagem, não permite marcar chegada/saída
- **DriverDeliveries**: página vazia — não permite confirmar entrega, entrega parcial, ou reportar divergência
- **DriverIssues**: página vazia — não permite reportar ocorrências do campo
- **DriverJourney**: funciona apenas em memória local (useState) — eventos não são persistidos no banco `dispatch_events`
- **DriverExpenses**: não permite upload de foto do comprovante (bucket `receipts` existe mas não é usado)
- **DriverChecklist**: checklist não é persistido
- **DriverHome**: query busca trips mas não filtra pelo driver logado (busca todas do tenant)

**Impacto**: motoristas não conseguem operar pelo app.

### 1.2 Modelo de Trip/Dispatch desconectado
- Tabelas `dispatch_trips`, `dispatch_stops`, `dispatch_events` existem mas não há UI para criar trips a partir de uma carga
- Não há fluxo para: Carga pronta → Criar Trip → Atribuir paradas → Liberar para motorista
- O LoadDetail não tem botão para "Despachar" (criar viagem)

**Impacto**: a ponte entre operação administrativa e execução no campo não existe.

### 1.3 Aprovação de despesas não funciona
- O botão "Revisar" no OperationsCenter não leva a nenhuma tela
- Não existe UI para aprovar/rejeitar despesas

### 1.4 Client Portal inexistente
- `RoleRouter` redireciona para `/portal` mas a rota não existe
- Clientes não têm nenhuma visibilidade sobre seus pedidos/cargas

---

## 2. FUNCIONALIDADES FRACAS (existem mas são superficiais)

### 2.1 Pedidos (Orders)
- CRUD básico genérico — tabela crua sem workflow
- Não mostra vinculação com cargas
- Não mostra status de entrega
- Sem filtros por status ou cliente

### 2.2 Documentos Fiscais
- Mesma tabela genérica — sem link visual para a carga
- Sem filtro por tipo (NF-e vs CT-e)
- CT-e gerado é um mock simplificado

### 2.3 Produtividade
- Dados calculados apenas em memória a partir de loads — sem métricas reais de tempo
- Não usa dados de `dispatch_events` (jornada real do motorista)
- Sem filtro por período

### 2.4 Estoque (Inventory)
- Existe mas desconectado do fluxo de cargas
- Não baixa automaticamente ao criar carga de saída

### 2.5 Ocorrências Operacionais
- CRUD genérico sem workflow de resolução
- Sem vinculação automática a trips/paradas

---

## 3. AUSÊNCIAS ESTRUTURAIS (necessárias para crescer)

### 3.1 Sem testes automatizados
- Apenas `example.test.ts` com teste trivial
- Zero testes para: parsing de XML/CSV, validação de ingestão, pipeline de status, cálculo de totais

### 3.2 Sem permissões por role no frontend
- Operator, driver, client veem exatamente o mesmo menu se acessarem rotas manualmente
- Navegação não filtra itens por role

### 3.3 Sem notificações/realtime
- Motorista não recebe aviso quando nova carga é atribuída
- Operador não vê quando motorista confirma entrega
- Sem uso de Supabase Realtime

### 3.4 Sem busca global ou atalhos
- Operadores precisam navegar por múltiplas telas para achar uma carga

---

## 4. PLANO DE AÇÃO RECOMENDADO (por prioridade)

### Fase 1 — Fechar o ciclo operacional (maior impacto)
1. **Fluxo de Despacho**: LoadDetail → criar trip → definir paradas → liberar
2. **Driver Stops/Deliveries**: carregar paradas reais, permitir marcar chegada/saída/entrega
3. **Driver Journey persistido**: salvar eventos em `dispatch_events`
4. **Upload de comprovante**: integrar bucket `receipts` nas despesas
5. **Tela de aprovação de despesas**: para admin/operador

### Fase 2 — Fortalecer o que existe
6. **Filtrar DriverHome por driver logado** (vincular user_id ↔ driver_id)
7. **Pedidos e Documentos**: adicionar filtros, links para carga, status visual
8. **Permissões no frontend**: esconder rotas/menus por role
9. **Client Portal mínimo**: `/portal` com lista de pedidos e status

### Fase 3 — Escalar com confiança
10. **Testes unitários**: parsing, validação, status pipeline, totais
11. **Notificações realtime**: Supabase channels para updates de carga/entrega
12. **Produtividade real**: usar dispatch_events para métricas de tempo
13. **Busca global**: command palette para cargas/pedidos/clientes

---

## Resumo visual

```text
FEITO                          FALTANDO
─────────────────────────────  ─────────────────────────────
✓ Schema completo              ✗ Trip creation flow
✓ Ingestion pipeline           ✗ Driver stops/deliveries
✓ Load CRUD + status pipeline  ✗ Journey persistence
✓ Role-based routing           ✗ Expense photo upload
✓ Driver layout                ✗ Expense approval UI
✓ Operations Center            ✗ Client portal
✓ CT-e generation (basic)      ✗ Role-based menu filtering
✓ Productivity page (basic)    ✗ Tests
✓ Expense table exists         ✗ Realtime notifications
```

A maior alavanca de crescimento agora é **fechar o ciclo operacional**: permitir que uma carga vire uma viagem e que o motorista execute entregas pelo app. Sem isso, o sistema é apenas um painel administrativo.

