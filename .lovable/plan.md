## Diagnóstico do caso 1004 / GVJ3909 / Leandro

Verificado direto no banco (não é hipótese):

- `loads` `1004`: `driver_id = LEANDRO`, `vehicle_id = GVJ3909`, `trip_id = 69383db8`, `status = ready`, `on_hold = false`, `tenant_id = 6e874e6e…`.
- `dispatch_trips 69383db8`: `driver_id = LEANDRO`, `status = planned`, mesmo tenant.
- `drivers` LEANDRO: `active = true`, `user_id = 87873f27…`.
- `tenant_memberships`: usuário `87873f27` tem role `driver` no tenant correto.
- RLS: `_driver_load_ids()` cobre os 3 caminhos (direto, via `trip_id`, via `dispatch_trip_loads`) e a política `Drivers view own dispatch_trips` cobre `planned`.

Ou seja, do lado do banco a carga **deveria** aparecer. O que aparece "despachada" na visão do operador é na verdade `load.status=ready` + `trip.status=planned` — a viagem nunca saiu de "planejada", então nada foi realmente despachado, apesar do rótulo na UI operacional. O ponto mais provável para o app não mostrar é do lado do cliente:

1. Em `src/pages/driver/DriverHome.tsx` as duas queries filtram por `.eq('tenant_id', currentTenant.id)`. Se, na sessão do motorista, `useTenant` ainda não resolveu o tenant (ou resolve outro tenant no primeiro render), o filtro exclui tudo mesmo com RLS liberando.
2. O canal Realtime também usa `filter: tenant_id=eq.${currentTenant.id}`, então uma inconsistência de tenant nunca é auto-corrigida.
3. `NoLoadsHelp` mostra "sem cargas" sem qualquer sinal de que existe carga atribuída em outro escopo, o que mascara o problema.

Não vou tratar como resolvido antes de logar de fato como Leandro no preview e confirmar. Também vou checar se o trigger `trg_loads_autofill_driver` está sobrescrevendo `driver_id` quando o `current_driver_id` do veículo muda (potencial causa "generalizada" mencionada pelo usuário).

## Plano de correção

### 1. Confirmar sintoma real (antes de qualquer edição)
- Rodar Playwright autenticado como o usuário do motorista (`87873f27…`) via sessão gerenciada, abrir `/driver`, capturar: `currentTenant.id` real na sessão, retorno das duas queries, e a UI final. Sem esse passo o resto fica marcado UNVERIFIED.
- Consultar `entity_audit_log` do `loads 0b988ce7…` e histórico do `driver_id` para descartar sobrescrita por trigger.

### 2. Remover dependência frágil de `currentTenant` no app do motorista
Ajustes contidos em `src/pages/driver/DriverHome.tsx`:
- Remover `.eq('tenant_id', currentTenant.id)` das queries `driver_my_trips` e `driver_my_loads`. A RLS já restringe ao driver logado; o filtro por tenant client-side não protege nada e quebra quando o tenant tarda a resolver.
- Habilitar as queries com `enabled: !!driver` (sem exigir `currentTenant`).
- No canal Realtime: trocar `filter: tenant_id=eq.…` por `filter: driver_id=eq.${driver.id}` em `loads`, mantendo o listener de `dispatch_trips` que já usa `driver_id`.
- Em `useActiveTrip` (`src/hooks/useCurrentDriver.tsx`), mesma remoção do filtro de tenant.

### 3. Tornar o vazio informativo
Em `src/components/driver/NoLoadsHelp.tsx`:
- Adicionar uma chamada leve a `loads` sem qualquer filtro além de `driver_id = me` para detectar "existem cargas atribuídas, mas nenhuma passou o filtro atual" e exibir texto: "existe(m) N carga(s) vinculada(s) a você — se não estão aparecendo, peça à operação para verificar tenant/status/on_hold".
- Mostrar `driver.id` e email logado num bloco copiável para suporte.

### 4. Blindar o trigger de auto-preencher motorista
Auditar `trg_loads_autofill_driver`:
- Se ele hoje sobrescreve `driver_id` no `UPDATE` quando `current_driver_id` do veículo muda, restringir para atuar somente em `INSERT` ou apenas quando `NEW.driver_id IS NULL`. Isso é o que costuma "sumir" cargas de um motorista quando o veículo passa a outro.
- Só emitir migration se a auditoria confirmar sobrescrita indevida.

### 5. Verificação final
- Nova sessão Playwright do motorista real → carga `1004` aparece em "Cargas atribuídas" ou dentro de "Viagens ativas".
- Rodar `bunx vitest run src/test/rlsDriverLoads.test.ts src/test/loadKanbanColumn.test.ts` — devem continuar verdes.
- Adicionar um teste em `rlsDriverLoads.test.ts` cobrindo o cenário "carga com `trip_id` planejada" para congelar o contrato.

## Fora de escopo
- Não vou mexer no fluxo operacional que hoje mostra a carga como "despachada" enquanto o `trip` está `planned` — isso é outra rodada.
- Nenhum ajuste de RLS/GRANT (as políticas atuais já cobrem o caso).
