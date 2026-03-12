

# Plano: Ativar Funcionalidades do AGVLog com Dados Reais

## Diagnóstico Crítico

Antes de ativar qualquer funcionalidade, existe um **bug crítico na ingestão de posições** que invalida todos os dados atuais:

**Problema**: O polling SSX retorna posições de TODAS as unidades rastreadas e armazena tudo sob o `vehicle_id` da unidade sendo processada. Evidência:
- Veículo `GVJ3095` tem posições de 14 TrackedUnits diferentes (PVM 3834, PVK 0939, HFB 4G43, etc.)
- Cada vehicle_id tem ~220 áreas geográficas distintas (deveria ter ~5-10 para uma frota regional)
- Trips calculadas mostram 117.000+ km em 4 horas (absurdo — as coordenadas saltam entre veículos)
- `metrics_daily` está todo zerado porque os dados de trips/stops são incoerentes

**Causa raiz**: O filtro `IntegrationCode` usado no PositionHistory está retornando TODOS os veículos da conta SSX, não apenas o veículo filtrado. Isso ocorre porque o SSX pode ignorar filtros quando o valor não corresponde exatamente a um `TrackedUnitIntegrationCode` válido.

## Fases do Plano

### Fase 1: Corrigir a Ingestão (Crítico)

**1.1 Filtrar posições no lado do cliente após recebê-las**

No `ssx-poll-positions/processPositions()`, antes de inserir no banco, validar que cada posição pertence à unidade sendo pollada:
- Comparar o campo `TrackedUnit` (ou `IdTrackedUnit`) da posição com os identificadores conhecidos do `provider_unit`
- Descartar posições que não correspondem à unidade sendo pollada
- Logar quantas posições foram descartadas como `cross_unit_filtered`

**1.2 Limpar dados contaminados**

Criar migration ou script SQL para:
- Deletar todas as `positions_raw` onde `telemetry->>'TrackedUnit'` não corresponde ao veículo
- Deletar `trips`, `trip_stops`, `events` (source='engine'), `metrics_daily` gerados a partir de dados inválidos
- Resetar `ingestion_cursors` para forçar recoleta limpa
- Resetar `vehicle_processing_queue`

**1.3 Melhorar o hash de deduplicação**

O hash atual usa `unit.external_code|lat|lng|captured_at`. Deve incluir o `TrackedUnit` ou `IdTrackedUnit` da posição para evitar que a mesma posição SSX gere hashes diferentes quando armazenada sob vehicle_ids diferentes.

### Fase 2: Ativar o Pipeline de Inteligência

Após dados limpos fluindo corretamente:

**2.1 Executar processamento retroativo**

- Trigger manual do `agvlog-pipeline-run` com `pipeline_mode: "full"` para reprocessar todos os veículos
- O `agvlog-run-queue` já implementa trips, stops, overspeed sessions, harsh events, fuel, geofence checks, alertas, route compliance
- O `agvlog-aggregate-daily` já popula `metrics_daily`

**2.2 Garantir cron executando agregação diária**

O cron `agvlog-daily-aggregate` às 2h já está configurado. Verificar que está rodando com dia correto.

### Fase 3: Melhorar Dashboard

**3.1 Dashboard rico com dados reais**

O Dashboard atual mostra 6 KPIs básicos e um card "Próximos passos". Substituir por:
- Grid de KPIs: Veículos, Online, Offline, Km hoje, Viagens hoje, Alertas abertos
- Gráfico de barras: Km por veículo (últimos 7 dias) usando Recharts
- Gráfico de linha: Atividade diária (km, viagens) últimos 7 dias
- Lista de alertas recentes (últimos 5)
- Lista de veículos inativos/offline há muito tempo
- Resumo de eventos (overspeed, harsh brake, paradas longas) das últimas 24h
- Remover card "Próximos passos" estático

### Fase 4: Enriquecer VehicleDetails

A página já tem tabs para Overview, Timeline, Trips, Stops, Speed, Fuel, Alerts, Geofences, Telemetry. Melhorias:

**4.1 Gráfico de velocidade ao longo do dia**

Na tab Speed, adicionar gráfico Recharts (LineChart) com velocidade × hora usando `positions_raw`.

**4.2 Gráfico de combustível ao longo do dia**

Na tab Fuel, adicionar gráfico Recharts (AreaChart) com nível de combustível × hora usando `fuel_readings`.

**4.3 Timeline visual**

Na tab Timeline, além do mapa com polyline, adicionar marcadores de paradas (círculos vermelhos) e indicadores de overspeed (trechos em vermelho).

**4.4 KPIs consolidados no Overview**

Adicionar cards: Km estimado hoje, Viagens hoje, Paradas hoje, Tempo em movimento, Tempo parado, baseados em `metrics_daily`.

### Fase 5: Melhorar Geofences

**5.1 Criação visual no mapa**

A criação atual é por coordenadas manuais. Integrar `leaflet-draw` (já mencionado na arquitetura) para desenhar polígonos diretamente no mapa. Manter o dialog de coordenadas como fallback.

**5.2 Visualizar geofences no mapa**

Na página Geofences, adicionar mapa Leaflet mostrando todos os polígonos com cores por categoria.

**5.3 Mostrar geofences no FleetMap**

Overlay opcional de geofences ativas no mapa da frota.

### Fase 6: Melhorar Relatórios

**6.1 Gráficos nos relatórios**

Adicionar gráficos Recharts ao lado da tabela:
- BarChart: Km por veículo no período
- LineChart: Evolução diária de km/viagens/paradas

**6.2 Exportação CSV**

Botão para exportar a tabela de ranking em CSV.

## Ordem de Implementação

1. **Fase 1** (corrigir ingestão) — sem isso nada funciona
2. **Fase 2** (reprocessar dados) — popula trips/stops/events/metrics
3. **Fase 3** (Dashboard) — valor imediato ao usuário
4. **Fase 4** (VehicleDetails) — profundidade de informação
5. **Fase 5** (Geofences visuais) — usabilidade
6. **Fase 6** (Relatórios com gráficos) — análise

## Arquivos a Serem Modificados

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/ssx-poll-positions/index.ts` | Filtro de posições por TrackedUnit antes de inserir |
| `src/pages/Dashboard.tsx` | Dashboard completo com gráficos e dados reais |
| `src/pages/VehicleDetails.tsx` | Gráficos de velocidade, combustível, KPIs |
| `src/pages/Geofences.tsx` | Mapa com polígonos, criação visual |
| `src/pages/FleetMap.tsx` | Overlay de geofences (opcional) |
| `src/pages/Reports.tsx` | Gráficos Recharts, exportação CSV |

## Pontos que Dependem de Dados Reais

- Eficácia do filtro por `TrackedUnit` — precisa validar que o campo existe e é consistente nos dados da SSX (já confirmado que existe em `telemetry.TrackedUnit`)
- Métricas de velocidade — os rastreadores não reportam `speed` diretamente (campo null), então velocidade é estimada via GPS no processamento
- Combustível — `vehicle_capabilities` mostra `fuel: false` para todos os veículos, então a tab de combustível permanecerá informativa mas sem dados até que sensores sejam mapeados

