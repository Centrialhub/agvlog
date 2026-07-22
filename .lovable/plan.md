## Varredura de duplicatas — resultado

Rodei checagens em 20+ tabelas críticas cruzando chaves óbvias e compostas. Só 2 achados reais restaram — o resto (receivables, payables, CT-e, NFSe, client_invoices, closing_reports, load_items, load_documents, bank_transactions, drivers/employees/user, memberships, pallet, occurrence sheets, assignments, integration accounts) está limpo.

### Achado 1 — `vehicles.plate` sem normalização
Mesmo veículo cadastrado duas vezes com placas diferindo só por espaço:

```text
PXT 0255   → id 58d37ad1... (2026-03-09, sem modelo)
PXT0255    → id 9ac6701a... (2026-05-13, VW 10.160 DRC 4X2)
```

Ambos ativos no mesmo tenant. Não há índice único sobre placa normalizada, então o sistema aceitou os dois.

### Achado 2 — `freight_tables` com 12 tarifas "fantasma"
12 linhas ativas (não bloqueadas) do mesmo tenant, todas com `client_id=NULL`, origem/destino/veículo `NULL`. Só se distinguem por `table_code` (1..12) — parecem rascunhos/testes que ficaram ativos. Como nenhum registro tem contexto (rota/cliente/veículo), o motor de match de frete pode escolher qualquer uma pela pontuação de especificidade, gerando decisões não determinísticas.

## Correções propostas

### 1. Placa duplicada (dado + prevenção)
- Migration:
  - `UPDATE vehicles SET plate = UPPER(regexp_replace(plate,'[^A-Za-z0-9]','','g'))` no tenant, com backup do valor original em `plate_raw` (novo, nullable).
  - Mesclar os dois registros: consolidar no mais completo (`9ac6701a...`), reatribuir FKs (`current_driver_id`, `loads.vehicle_id`, `dispatch_trips.vehicle_id`, `vehicle_driver_assignments.vehicle_id`, `driver_settlements.vehicle_id`, `vehicle_fueling`, `vehicle_maintenance`, `vehicle_odometer`, `vehicle_events`, `vehicle_tracker_links`, `maintenance_orders`, `positions_last`) do id antigo para o novo. Depois `active=false` no antigo (soft delete — mantém histórico).
  - Índice único parcial:
    ```sql
    CREATE UNIQUE INDEX uq_vehicles_plate_norm
      ON vehicles (tenant_id, UPPER(regexp_replace(plate,'[^A-Za-z0-9]','','g')))
      WHERE active=true;
    ```
  - Trigger `BEFORE INSERT/UPDATE` normalizando `plate` (uppercase + strip de não-alfanumérico).
- Frontend: `NewVehicleDialog` / `EditVehicleDialog` — aplicar mesma normalização no submit + mensagem clara em erro `23505`.

### 2. Tarifas de frete fantasma
- Migration:
  - `UPDATE freight_tables SET blocked=true, notes = coalesce(notes,'')||' [auto-blocked: registro vazio sem rota/cliente]'` onde `client_id IS NULL AND origin_state IS NULL AND destination_state IS NULL AND origin_municipality IS NULL AND destination_municipality IS NULL AND vehicle_type IS NULL`.
  - Trigger `BEFORE INSERT/UPDATE` em `freight_tables`: rejeita `active` (não-bloqueado) sem pelo menos um dos campos (client_id, origem, destino, veículo) — evita novos "fantasmas".
  - Índice único parcial:
    ```sql
    CREATE UNIQUE INDEX uq_freight_tables_context
      ON freight_tables (tenant_id, COALESCE(client_id::text,''),
        COALESCE(origin_state,''), COALESCE(destination_state,''),
        COALESCE(origin_municipality,''), COALESCE(destination_municipality,''),
        COALESCE(vehicle_type,''))
      WHERE blocked=false;
    ```
    Isso trava overlap exato futuro (mantendo diferenças por vigência via `valid_from/until` se necessário — se atrapalhar, incluí-las na chave).
- Frontend: no editor de tarifa, avisar quando os campos-chave estão todos vazios antes de salvar.

### 3. Testes
- `src/test/backendDuplicates.test.ts` (unit puro, sem DB): 
  - Normalização de placa (`PXT 0255` == `pxt-0255` == `PXT0255`).
  - Validação client-side de tarifa sem contexto retorna erro.
- Sem novos testes de RLS — todos os 223 existentes continuam válidos.

## Fora do escopo desta rodada
- Deduplicação heurística por nome (clientes/employees/POIs sem CNPJ/CPF) — precisaria de UX de merge manual; achei zero grupos por chave forte.
- Reprocessar `route_planning_stop_drafts` e `op_route_norm` — já listados como débito adiado em rodadas anteriores.

Aprova?
