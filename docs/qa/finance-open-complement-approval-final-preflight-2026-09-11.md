# Preflight final de complemento e aprovação

Candidato local criado via `npx supabase migration new finance_open_complement_approval_final_preflight`. Nenhuma aplicação remota nesta tarefa.

Ordem obrigatória revisada e testada: **81653 → 85400 → 83307 → 90910**. A aprovação vinculada à revisão entra antes da promoção pública do complemento. A última migração apenas valida contratos: não troca corpos, permissões, gatilhos ou dados de negócio.

Arquivo: `supabase/migrations/20260911090910_finance_open_complement_approval_final_preflight.sql`.
SHA256: `5aa5869d811a1474516aeb6804395491a7ac04c7512798acc2ba3649300bb447`.

Valida 17 funções por MD5 do prosrc normalizado CRLF/LF, SECURITY DEFINER/INVOKER, volatilidade, search_path e ACL; 9 gatilhos por função, tabela, eventos, ativação, deferral, ausência de WHEN e argumentos; RLS e ACL privadas do journal e dos tickets. A própria fixture instala os corpos reais e confirma os hashes também dos quatro wrappers 83307. Reaplicar o preflight é permitido e foi testado.

## Evidência local

`npx vitest run src/test/openComplementApprovalFinalPreflight.test.ts`: **5 testes passaram**, saída 0 em 2026-09-11 06:13 local. `npx eslint src/test/openComplementApprovalFinalPreflight.test.ts`: saída 0.

- Cadeia exata: aprovação antiga de 50 rejeitada após correção, aprovação raw bloqueada; nova revisão de 20 aprovada, replay idempotente e pagamento canônico real de 20 concluído.
- Falha no evento de auditoria reverte aprovação e consumo do ticket.
- Outro tenant, papel misto de motorista, revogação, anon e acesso direto aos helpers privados rejeitados.
- Aprovação raw de obrigação ainda não retificada preservada.
- Sete alterações de contrato rejeitadas: SECURITY DEFINER, grant do writer privado, grant da tabela de tickets, trigger desativado, evento DELETE indevido, WHEN false e corpo do wrapper alterado. Restauração de cada savepoint faz o preflight voltar a passar.

A prova usa PGlite com writers e fixtures reais existentes. Não substitui a prova de concorrência PostgreSQL já concluída da cadeia 81653/85400/83307 (8 casos, documentada em `finance-payable-revision-approval-native-2026-09-11.json`). Esta rodada não inicia PostgreSQL nativo, não executa TSC/build e não afirma ensaio de navegador ou Auth hospedado. Todos os processos desta tarefa encerraram.

O ramo custo alvo menor ou igual ao valor alocado continua fora deste candidato e não foi iniciado.
