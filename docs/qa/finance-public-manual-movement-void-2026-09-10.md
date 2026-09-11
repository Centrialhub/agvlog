# Promoção pública da correção manual livre

Migração candidata local: 20260910192831_finance_manual_movement_void_public_dispatch.sql.
SHA-256: c90da6bb84d7733b920b818f78761b3d8bb3fce53e255a3b6371d4381d536595.
Factory publicManualMovementVoidDatabase.ts: 255a8c17390904560f9f08eb7e81d38ccb8f299840b77e8c50ca50e6248b2979.

## Caminho público e permissões

public.void_finance_manual_movement(_payload jsonb) é SECURITY INVOKER e delega a finance_private.dispatch_manual_movement_void, SECURITY DEFINER com search_path vazio. Somente authenticated recebe EXECUTE nesses dois pontos. O dispatcher confere formato básico, tenant e can_access, e delega ao writer original191905. A ACL e o corpo do writer privado não mudam; seus baselines congelados continuam íntegros.

Payload estrito e resultado permanecem os de191905. O writer valida integralmente payload, reautoriza após trava, executa replay, reavalia origem/revisão/elegibilidade, exige ticket e guard INSERT. Resultado expressa bank_money_transacted=false e deltas prospectivos do registro invalidado; nunca representa transferência bancária executada.

## Prévia

preview_finance_movement_correction mantém a mesma revision do contexto190516. Apenas can_execute passa a exigir simultaneamente elegibilidade, readiness190516, baseline191905 íntegro, identidade/tipo/flags dos7guards e EXECUTE autenticado disponível no RPC/dispatcher; o writer original deve continuar sem EXECUTE autenticado. Ausência ou revogação de capacidade nunca é interpretada como true. Já corrigido permanece não executável.

Can_execute é disponibilidade atual; não é permissão persistente. A escrita sempre repete suas verificações autoritativas. Alteração de guard ou ACL pode deixar a revision monetária igual e can_execute=false, pois não houve alteração do fato financeiro revisado.

## Testes

8 testes PGlite passaram em publicManualMovementVoid.test.ts. A chamada usa SET ROLE authenticated por financeAs, não invocação privilegiada do writer privado. Prévia e resultado passam pelos schemas reais movementCorrectionPreviewSchema/movementVoidResultSchema.

Cobertura: caminho público positivo sem grant ao writer; resultado e auditoria únicos sob replay; conflito da mesma chave; perfil motorista misto e tenant indevido; perda de acesso inclusive replay; guard desabilitado fecha disponibilidade e impede escrita; ACLs anon/service/private negadas; revogação de EXECUTE em RPC e dispatcher desabilita disponibilidade e chamada; obrigação surgida após prévia causa stale e preserva dinheiro. ESLint dos testes/helper passou. Root também confirmou4 testes de contrato da prévia junto aos8públicos.

A factory instala190516/190635/191905/192831 reais. Nenhuma migração anterior ou baseline congelado foi alterado. A validação nativa independente foi solicitada ao agente bank_period_evidence com esse hash; resultados pertencem ao relatório nativo específico. Não executei PostgreSQL nativo, TSC, banco remoto nem implantação.

## Limites

A promoção cobre invalidação manual livre, sem pagamentos ou dependências. Não implementa correção de valor/data/conta por replacement, remoção de baixas reais, correção de transferência ou cascata fiscal/folha. O schema remoto completo ainda requer a revisão e aplicação coordenadas do plano de implantação; esta entrega é código e validação locais.
