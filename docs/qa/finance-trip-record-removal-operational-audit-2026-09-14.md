# Exclusão de registro financeiro e viagem: auditoria operacional

Auditoria somente leitura do catálogo de produção qcvnsdrbcchaxvawcngk, 14/09/2026. Nenhuma sessão/JWT fabricada, escrita de negócio ou emissão fiscal. HEAD local observado b59d031a; não certifica os bytes do Sites publicado nem a sessão do usuário.

## Movimento financeiro

- Produção: `void_finance_manual_movement(jsonb)` existe; `manual_movement_void_runtime_ready()` = true; `movement_correction_readiness()` ready=true/missing=[]. Não há evidência de bloqueio global da implantação dessa ação.
- Caminho existente: `FinanceMovements.tsx` → `MovementCorrectionDialog` → `MovementCorrectionReview` (preview atual de origem/dependências) → `MovementVoidConfirmation` → `movementVoidCommandClient.ts` → RPC acima.
- Descoberta estava escondida sob “Conferir correção”. Alterados apenas rótulos para “Corrigir ou excluir registro” e “Excluir registro incorreto”, explicando preservação do original, extrato intacto e ausência de transferência bancária. Continua exigindo motivo, revisão atual e confirmação explícita; vínculos/fechamento/origem não comprovada continuam bloqueando.
- Regressão: `movementCorrectionEntry.test.tsx` + `movementVoidConfirmation.test.tsx`, 10 PASS, 16:47:07, exit 0. A primeira valida abertura do movimento/empresa/ator selecionados sem escrever; a segunda percorre motivo/confirmação até o cliente existente e preserva replay/negações. São testes locais de UI; não reproduzem a sessão de produção.
- Ainda é necessário identificar qual origem o usuário chama de “lançamento”: movimento manual, gasto, título ou extrato têm regras distintas. Não oferecer DELETE genérico para essas origens.

## Viagem despachada

- `RoutePlanning.tsx:397` exclui rascunho por deleteDraft, enquanto `useDispatchRoutePlan.ts` cria viagem por dispatch_planned_route_v3. Exclusão de rascunho não desfaz a viagem já despachada.
- Nenhuma ação cancelar/excluir viagem encontrada em TripDetailsDrawer e nenhuma função pública/private com nome cancel/delete trip no catálogo de produção. Isso é ausência de fluxo localizado, não prova de inexistência absoluta de qualquer comando genérico.
- RLS real dispatch_trips: DELETE permissivo apenas is_tenant_admin(tenant_id), restritivo private.is_request_tenant_member. Operador não tem essa política de exclusão. Não ampliar DELETE para contornar isso.
- Catálogo tem 24 FKs para dispatch_trips. RESTRICT/NO ACTION inclui acertos, recibos de entrega, custódia, despesas, abastecimentos, resultados de documento e comandos offline. CASCADE apagaria dispatch_events, stops e vínculos de carga/rota/jornada. SET NULL retiraria vínculo de cargas/títulos/provas. Portanto mesmo viagem aparentemente vazia não deve ser apagada sem avaliação do grafo.

## Implementação candidata local

A fronteira planejada e a correção de viagem materializada foram implementadas localmente em `20260914200012`, `20260914201830` e `20260914215310`. O fluxo exige empresa/ator, revisão atual, motivo e confirmações explícitas; cancela somente paradas pendentes, preserva viagem, cargas, jornada física, títulos, despesas, acertos e documentos fiscais existentes, e grava journal e auditoria imutáveis. Viagem planejada limpa permanece no fluxo próprio de cancelamento. Nenhuma rotina emite, cancela ou reprocessa documento fiscal.

Validação local concluída: 8 casos em PostgreSQL 17.11 descartável e 3 arquivos/11 testes funcionais/UI. Foram provados os dois wrappers autenticados, cinco helpers privados, RLS e revogações do journal, 26 guardas do grafo, idempotência, revisão obsoleta, isolamento entre empresas, motorista/inativo/anônimo negados, duas correções concorrentes com um único vencedor, revogação de acesso durante lock, imutabilidade e rollback integral quando a auditoria falha. Hash SHA-256 da candidata: `dac12474279bdcd4138191bcb303433ec17d076ac83c4ea40748ee6bcdb27cc2`.

A candidata ainda não foi aplicada no banco principal nem exercitada no Sites autenticado. O preflight remoto somente leitura confirmou que seus cinco objetos ainda estão ausentes e que o predecessor crítico mantém MD5 `e886db6cf5d0e3f0d0578659dd87266d`, `SECURITY DEFINER`, estabilidade e `search_path` vazio; os wrappers e o guarda planejado exigidos também estão presentes. Por instalar writers e gatilhos persistentes, sua ativação continua sujeita à confirmação explícita individual.
