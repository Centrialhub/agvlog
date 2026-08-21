# Certificação do Núcleo Operacional — Baseline 2026-08-21

Escopo: apenas certificação. Nenhuma função nova foi desenvolvida, nenhum dado do banco vinculado
foi alterado e nenhuma feature flag desativada foi habilitada.

## Resumo PASS/FAIL

| # | Gate / Teste | Resultado | Evidência |
|---|--------------|-----------|-----------|
| 1 | `bun install` | PASS | `Checked 626 installs across 693 packages (no changes)` |
| 2 | Typecheck (`tsgo --noEmit`) | PASS | exit 0, zero diagnósticos |
| 3 | Lint (`eslint .`) | PASS (com ressalva) | `2758 problems (0 errors, 2758 warnings)` — warnings preexistentes (`no-explicit-any`) |
| 4 | Testes (`vitest run`) | PASS | `Test Files 41 passed (41)` / `Tests 343 passed (343)` em 24,08s |
| 5 | Build (`bun run build`) | PASS | `✓ built in 28.62s` (aviso de chunk >500 kB, não bloqueante) |
| 6 | Guardrail `migration-integrity.py` | PASS | `Integridade das migrations OK (289 migrations)` |
| 7 | Guardrail `db-linter.py` | PASS | `Guardrails validados com sucesso!` |
| 8 | Guardrail `schema-check.py` (assinaturas) | PASS | `Análise de assinaturas OK (289 migrations)` |
| 9 | Reset desde schema vazio (cluster local descartável, porta 55432) | PASS | `OK: 289 migrations aplicadas desde schema vazio`; `schema-check` concluiu com `histórico completo e integridade de assinaturas validados` |
| 10 | Testes unitários do parser (`test_schema_check.py`) | PASS | `Ran 10 tests ... OK` |
| 11 | Smoke de rotas (não autenticado) | PASS | 13 rotas retornam HTTP 200, sem `pageerror`; todas redirecionam para `/auth` |
| 12 | Smoke autenticado em dois tenants | **FAIL / BLOQUEADO** | `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged` — Supabase externo/não gerenciado: nenhuma sessão pode ser injetada nem emitida no ambiente local |
| 13 | Auditoria de congruência no banco vinculado (leitura) | PASS parcial | RPC não executável pelo runner SQL (`42501 permission denied for function audit_operational_congruence_v1`); contagens obtidas replicando as 8 verificações da função em SELECT puro |

## Ambiente local descartável

- Cluster Postgres 17.9 descartável em `/tmp/pgreset` (socket), porta 55432, banco `resetdb`.
- Reset executado por `scripts/guardrails/local-db-reset.sh 55432` com `PGDIST=/tmp/pgdist`.
- O banco vinculado **não** foi tocado: nenhum `supabase db push`, nenhum DDL/DML remoto.
- Docker/Supabase CLI ausentes no sandbox; o gate usa o caminho de fallback do cluster local, que é
  o próprio caminho probatório previsto em `schema-check.py`.

## Smoke de rotas (preview local, http://localhost:8080)

Rotas verificadas: `/`, `/loads`, `/load-control`, `/billing`, `/cte-monitor`, `/cte-search`,
`/financial`, `/operational-routes`, `/data-quality`, `/drivers`, `/employees`, `/driver`, `/portal`.

- Todas retornaram HTTP 200 e renderizaram a tela de autenticação (`AGVLog — Entrar / Criar conta`),
  confirmando que `ProtectedRoute` bloqueia acesso anônimo em 100% das rotas do núcleo.
- Nenhum erro de runtime (`pageerror`) ou falha de módulo. O único ruído de console é um aviso
  preexistente do React (`Function components cannot be given refs`) originado em providers de terceiros.

### Limitação de cobertura autenticada (FAIL registrado)

Seleção de tenant, dashboard, cargas, romaneio, hold, faturamento, CT-e monitor/consulta,
financeiro, rotas e navegação por papéis **não puderam ser exercitados de ponta a ponta**:
o projeto usa Supabase externo/não gerenciado, portanto o ambiente de automação não recebe
sessão injetada e não é possível emitir sessão de teste, nem existem dois tenants de teste
dedicados (os dois tenants do banco vinculado são de produção e ficaram intocados).

Cobertura substitutiva já verde nesta rodada:
- `src/test/securityLayerHardening.test.ts` — bloqueio de auditoria cross-tenant, reparo não autorizado
  e acesso cross-tenant ao workspace do motorista.
- `src/test/securityMatrix.test.ts` — `execute_data_repair_v1` negado para todos.
- `src/test/hrSecurity.test.ts` — DML direto revogado em `employees`, criação negada para anônimo.
- `src/test/integrationScenarios.test.ts` — bloqueio cross-tenant na criação de carga, idempotência de
  `plan_dispatch_trip_v3`, rollback em falha parcial.
- `src/hooks/createLoadV2.test.tsx`, `src/hooks/route-planning/planDispatchTripV3.test.tsx`,
  `src/test/loadKanbanColumn.test.ts`, `src/test/loadReallocationMerge.test.ts`,
  `src/test/clientInvoices.test.ts`, `src/test/documentStatusCongruence.test.ts`.

## Auditoria de congruência — banco vinculado (somente leitura)

`public.audit_operational_congruence_v1(uuid)` existe, é `SECURITY DEFINER`, `STABLE`,
`search_path = public, pg_temp`, com `EXECUTE` apenas para `authenticated` e `service_role`
(`proacl: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`). A execução direta
pelo runner SQL falha com `42501 permission denied` — comportamento esperado do endurecimento de
permissões. As contagens abaixo foram obtidas executando as mesmas oito verificações da função em
`SELECT` puro (leitura, sem `UPDATE`/`DELETE`/reparo).

| Verificação | Severidade | tenant `db36dc9b…7ee97` | tenant `6e874e6e…6989c4` |
|---|---|---|---|
| Item de carga com `load_id` divergente da NF | error | 0 | **53** |
| NF aponta para carga sem item correspondente | warning | 0 | **1** |
| `loads.trip_id` sem vínculo em `dispatch_trip_loads` | error | 0 | 0 |
| Vínculo de despacho sem `trip_id` na carga | warning | 0 | 0 |
| Item de carga cross-tenant com a carga | critical | 0 | 0 |
| Item de carga cross-tenant com a NF | critical | 0 | 0 |
| Vínculo de despacho cross-tenant | critical | 0 | 0 |
| Parada cross-tenant com a viagem | critical | 0 | 0 |
| Viagem concluída/cancelada com parada pendente | warning | 0 | 0 |
| `dispatch_stop_documents` incoerente | error | 0 | 0 |
| Totais da carga divergentes dos itens | warning | 0 | 0 |
| `access_key` duplicada entre NFs ativas | error | 0 | 0 |
| Tabelas públicas sem RLS | critical | 0 | 0 |

Total: **54 ocorrências** (53 error + 1 warning), todas concentradas no tenant
`6e874e6e-5bca-486d-9928-bef0646989c4`, no domínio `composition`. Nenhuma ocorrência `critical`.
Nenhum dado foi corrigido — registro apenas.

## Estado das feature flags (inalterado, exceto o já aprovado)

```
DRIVER_WORKSPACE: false
CLIENT_PORTAL: false
OPERATIONAL_LEDGER: false
DATA_QUALITY_CENTER: true   (habilitado na entrega anterior, aprovada)
LOGISTICS_CONSOLIDATION_V2: false
HR_CORE: false
LOAD_CONTROL: false
```

## Conclusão

Núcleo técnico **CERTIFICADO** nos gates automatizados (install, typecheck, lint, test, build,
guardrails e reset reprodutível de 289 migrations desde schema vazio) e no smoke de proteção de
rotas. Duas ressalvas explícitas permanecem abertas:

1. Smoke funcional autenticado em dois tenants de teste — **não executável** neste ambiente
   (Supabase externo/não gerenciado, sem sessão nem tenants de teste). Requer credenciais de
   teste dedicadas ou execução manual pelo operador.
2. 54 divergências de composição no tenant `6e874e6e…` aguardando decisão de correção em rodada
   separada (nenhuma ação corretiva tomada aqui).
