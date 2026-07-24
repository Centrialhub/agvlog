## Correção end-to-end — App do Motorista

Rodada curta e cirúrgica para fechar as 7 lacunas identificadas na auditoria. Sem funcionalidade nova.

### 1. `/driver/events` e `/driver/events/:id` — plugar em produção
- Substituir `DEMO_EVENTS_INITIAL` hardcoded por query real em `operational_events`, filtrando pelo `dispatch_trip_id` da viagem ativa (`useActiveTrip`) e/ou `driver_id` de `useCurrentDriver`.
- Manter fallback demo apenas quando `canUseDriverDemo === true` e não houver viagem ativa.
- Detalhe (`/driver/events/:id`): buscar o evento por `id` na mesma tabela; manter botão "Ir para entregas" como CTA secundário.
- Realtime: assinar `operational_events` (já publicado) filtrado por `dispatch_trip_id`.

### 2. Realtime — publicar tabelas faltantes
Migration append-only:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.dispatch_stops,
  public.dispatch_events,
  public.driver_expenses;
```
Adicionar `REPLICA IDENTITY FULL` nas três para payloads completos.
Nas telas do motorista (`DriverStops`, `DriverJourney`, `DriverExpenses`), acrescentar canal Realtime dentro de `useEffect` com cleanup via `supabase.removeChannel`, invalidando as queries relevantes.

### 3. RLS `driver_direct_messages` — endurecer INSERT
Migration:
```sql
ALTER POLICY "tenant members insert driver direct messages"
  ON public.driver_direct_messages
  WITH CHECK (is_tenant_member(tenant_id));
```
(Mantém USING atual; só adiciona a validação de tenant no INSERT.)

### 4. `proof_of_delivery` — policy SELECT para motorista dono da parada
Migration:
```sql
CREATE POLICY "Driver can read own POD"
  ON public.proof_of_delivery
  FOR SELECT
  TO authenticated
  USING (driver_owns_stop(stop_id));
```
Não altera nada da UI atual; destrava reabertura futura do comprovante no app.

### 5. `DriverChat` — só limpar input após sucesso
Mover `setText('')` para dentro do `onSuccess` da mutation de envio. Em falha, o texto permanece e o toast de erro guia o retry.

### 6. `NoLoadsHelp` — filtrar probe por tenant
Adicionar `.eq('tenant_id', tenantId)` (via `useTenant`) no `select` que hoje só depende da RLS. Sem mudança de contrato; apenas evita ruído em cenários multi-tenant.

### 7. Verificação
- `bun run build` e `bunx vitest run` (esperado: manter suite atual verde, incluindo `rlsDriverLoads.test.ts` e `rlsCrossTenant.test.ts`).
- Smoke manual (não bloqueante): abrir `/driver/events` com viagem ativa e confirmar lista real; simular chegada/saída de parada pelo operador e ver a tela do motorista atualizar sem refresh.

### Escopo fora
- Nenhuma nova tela, RPC ou lógica de negócio.
- Sem tocar em CT-e, folha, ocorrências RH, portal do cliente ou fiscal hub.
- Sem refactor estético.

### Detalhes técnicos
- Arquivos previstos:
  - `src/pages/driver/DriverEvents.tsx`, `src/pages/driver/DriverEventDetail.tsx` — trocar demo por query real + realtime.
  - `src/pages/driver/DriverStops.tsx`, `src/pages/driver/DriverJourney.tsx`, `src/pages/driver/DriverExpenses.tsx` — adicionar canais realtime.
  - `src/components/driver/DriverChat.tsx` — mover `setText('')` para `onSuccess`.
  - `src/components/driver/NoLoadsHelp.tsx` — filtro por `tenant_id`.
  - 1 migration SQL cobrindo publicação realtime + policies (itens 2, 3, 4).
- Sem alteração em `types.ts` (regenerado automaticamente pela migration).
