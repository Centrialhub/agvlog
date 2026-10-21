# Fixtures historicas de regressao

Copias exatas de fontes locais preservadas. Mantem comparacoes de comportamento anterior sem depender de commits ausentes em clones remotos. Os testes verificam o SHA-256 dos bytes normalizados para LF. Nenhuma chamada externa e feita por estas fixtures.

- `ssx-finalization-e2b5dfb.sql`: `e2b5dfb9935431cfc4dceea0025d8b5964331bbf`, `supabase/migrations/20261007122904_fence_ssx_rule_violation_finalization.sql`, SHA-256 `e60ab41541ca35dfeb2247b26c2ccad0c0e797b4e8803fd01667ac5f6ff8c20d`.
- `ssx-bounded-commit-e2b5dfb.sql`: `e2b5dfb9935431cfc4dceea0025d8b5964331bbf`, `supabase/migrations/20261007131504_add_bounded_ssx_violation_commit_v3.sql`, SHA-256 `1be7865866a9e4d251b5805b6287fd7a510a582d05cf0675db4aac4fddd5d087`.
- `address-worker-0cfa824.fixture.txt`: `0cfa82473a56df813d2e2c883e3035afa6d98585`, `supabase/functions/process-address-resolution-queue/index.ts`, SHA-256 `04e5a1d743a8565322c00fa99a367e5333852dfee5bed0db778310907248e1b1`.
- `address-worker-6f6361c.fixture.txt`: `6f6361ce86dc1c8d4d8d7c6e4849bcb340aa5838`, `supabase/functions/process-address-resolution-queue/index.ts`, SHA-256 `b8ea226e542ba4fff626186a025b2063c4cbcb19d9126b2cb4baa612e0f786dc`.
