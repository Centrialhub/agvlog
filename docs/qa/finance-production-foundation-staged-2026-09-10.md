# Rollout aditivo staged da fundação — 2026-09-10

Arquivo revisado sem alteração: `supabase/rollouts/20260910220257_finance_production_foundation_staged.sql`, SHA256 `5f0b9e2ad6b7da6d0a2a45eb2a2816f2a5f04651436f5e9c54aca52239051113`.

Dois testes PGlite passaram em `financeProductionFoundationStaged.test.ts`: aplicação em transação única cria finance_movements/finance_commands/finance_events e confirma com can_access=false; administrador não consegue record_finance_movement e nenhuma linha/evento/comando é criado. Colisão com tabela finance_movements preexistente falha naturalmente, rollback remove os objetos tentados e preserva a tabela anterior.

Fixture pré-ledger contém apenas contratos Auth/tenant/membership/driver/account necessários à fundação original. Não há funções financeiras simuladas. Não prova lock concorrente de produção nem infraestrutura Auth real; prova DDL/ACL/gate e atomicidade nesta engine PostgreSQL local. Nenhum remoto, PostgreSQL nativo ou TSC foi executado. Root é o único escritor do rollout autorizado.
