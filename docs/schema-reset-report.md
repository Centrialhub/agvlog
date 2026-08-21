# Prova de reprodutibilidade do schema (reset desde schema vazio)

Objetivo: provar que o histórico de migrations aplica-se integralmente desde um
schema vazio, sem `db push` e **sem tocar no banco vinculado**.

## Ambiente da prova

- Cluster PostgreSQL 17 local **descartável** em `/tmp/pgreset`, porta `55432`
  (usuário `lovable`, socket local; nenhuma conexão com o projeto Supabase).
- Extensões providas via Nix e mescladas em `/tmp/pgdist`: `postgis`, `pg_cron`,
  `pg_net`, `pg_trgm`, `unaccent`.
- Paridade de plataforma: `scripts/ops/local-reset-bootstrap.sql`
  (roles `anon`/`authenticated`/`service_role`, stubs de `auth`/`storage`,
  publicação `supabase_realtime`).
- Runner: `scripts/guardrails/local-db-reset.sh <porta>` (aplica a baseline e
  todas as migrations em ordem cronológica, parando na primeira falha).
- Supabase CLI e Docker não existem neste sandbox; `schema-check.py` aceita o
  reset local **apenas** como execução real equivalente (`PGDIST` definido) e
  falha se ele não passar. Nada é silenciado.

Comando dos gates:

```bash
python3 scripts/guardrails/migration-integrity.py
python3 scripts/guardrails/db-linter.py
PGDIST=/tmp/pgdist python3 scripts/guardrails/schema-check.py   # inclui o reset
python3 scripts/guardrails/test_schema_check.py
```

## Ciclos (comando, primeira falha, causa, correção, evidência)

| # | Primeira falha | Causa | Correção | Evidência |
|---|---|---|---|---|
| 1 | `20260306153948_...sql` | comentário `--` não fechado quebrava a instrução seguinte | comentário corrigido | reset avançou além da migration 8 |
| 2-4 | falhas de extensão | `pg_cron`/`pg_net` apontando para banco errado e `search_path` sem `extensions` | workers configurados para `resetdb`; `ALTER DATABASE ... SET search_path` na baseline | extensões criadas sem erro |
| 5 | `20260513203902_...sql` | `INSERT` de veículos com `tenant_id` fixo (dados, não schema) → violação de FK em base vazia | dados movidos para `scripts/ops/seeds/` e migration reduzida a comentário | reset avançou para (95) |
| 6 | `20260513205409_...sql` | mesma classe (DML de tenant específico) em 12 migrations | todas extraídas para `scripts/ops/seeds/`, migrations sem instruções | reset avançou para (97) |
| 7 | `20260515185902_...sql` | `publication "supabase_realtime" does not exist` (objeto criado pela plataforma) | publicação criada na baseline de plataforma | reset avançou para (132) |
| 8 | `20260625191433_...sql` | `syntax error at or near "RPCs"`: comentário quebrado em 5 migrations pela inserção automática de `SET search_path` | linhas convertidas em comentário | reset avançou para (196) |
| 9 | `20260810221523_...sql` | `column "nfse_emitted_at" does not exist` — drift real: colunas existiam no banco sem DDL no histórico | `ADD COLUMN IF NOT EXISTS nfse_emitted_at / nfse_emitted_document_id` na migration irmã `20260728192400` (tipos conferidos no banco: `timestamptz`, `uuid`) | reset avançou para (205) |
| 10 | `20260812191353_...sql` | `cron.unschedule('nfse-status-poll-every-5min')` de job criado fora do histórico | remoção condicional (`IF EXISTS ... cron.job`) | reset avançou para (267) |
| 11 | `20260821004409_...sql` | grants antecipados: `GRANT/REVOKE EXECUTE ON FUNCTION` de funções criadas em migrations posteriores | `scripts/ops/conditional-function-grants.py` reescreve para grants condicionais por `to_regprocedure` (efeito real preservado) | reset avançou para (277) |
| 12 | `20260821020043_...sql`, `20260821020545_...sql` | mesma classe de grants antecipados | mesmo utilitário aplicado (6 e 22 instruções) | **reset verde: 288 migrations aplicadas desde schema vazio** |
| 13 | `schema-check` (estático) | falso positivo: `public.app_role` ≠ `app_role` na normalização de assinaturas | `normalize_type` resolve prefixo `public.`/`pg_catalog.`; teste novo cobre o caso | `Análise de assinaturas OK (288 migrations)` |

## Estado final dos gates

- `migration-integrity.py`: OK (288 migrations, MANIFEST.sha256 raiz e canônico regenerados).
- `db-linter.py`: OK (escritas diretas no frontend e DML sem tenant).
- `schema-check.py`: OK (assinaturas + reset executado desde schema vazio).
- `test_schema_check.py`: 10 testes OK.

## Regras derivadas

1. Migrations não carregam dados de um tenant específico; seeds vivem em
   `scripts/ops/seeds/` e são executados manualmente.
2. `GRANT/REVOKE EXECUTE ON FUNCTION` em migration anterior à criação da função
   deve ser condicionado por `to_regprocedure`.
3. Objetos de plataforma (publicação de realtime, roles, schemas `auth`/`storage`)
   pertencem à baseline, não ao histórico da aplicação.
4. Toda coluna usada por migrations precisa de DDL no histórico; drift do banco
   vinculado é corrigido com `ADD COLUMN IF NOT EXISTS` idempotente.
