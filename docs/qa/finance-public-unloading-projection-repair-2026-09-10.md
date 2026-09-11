# Promoção pública da reparação da projeção — 2026-09-10

Migração `20260910212550_finance_public_unloading_projection_repair.sql`, SHA256 `0bbf8948dbbfe8bdfd4f5cbb157be6da61558d1a8387c1036038b619e0164d74`.

Preparada sem aplicação enquanto o nativo211156/211740 estava ativo. Depois de aprovado o ensaio privado de cinco casos e encerrado PostgreSQL, foi aplicada apenas no PGlite para três testes públicos. Não houve aplicação remota nem alteração das migrações congeladas.

RPC `repair_finance_unloading_projection(jsonb)` é invoker e chama dispatcher privado específico, único novo grant de mutação a authenticated. Dispatcher verifica administração e chama writer original, que mantém reauth/replay/revisão/ticket/atomicidade. Rawwriter e rawcontext continuam sem grants. Preview seguro omite_evidence e só oferece can_execute quando eligible,can_repair e permissões/configuração da invocação estão coerentes. Revogar EXECUTE do endpoint ou dispatcher faz can_executefalse. Essa verificação é capacidade de invocação, não manifesto geral de integridade de todos os guards.

Três testes PGlite e ESLint passaram com parsers reais do produto: batch real reparado pela RPC pública, repetição idempotente e histórico único; revisão idêntica antes/depois da promoção e ao revogar grants; rawcontext/writer privados e anon/service/operator/foreign/mixeddriver negados. SQL de origem privada permanece intacta. Reabertura, regularização de recebimentos antigos e alteração real da charge não são acrescentadas por esta promoção.

Pendente validação nativa da camada pública, revisão final e integração de UI. Nenhum TSC ou PostgreSQL nativo foi iniciado por este agente.
