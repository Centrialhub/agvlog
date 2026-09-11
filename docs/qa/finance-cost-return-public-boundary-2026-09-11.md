# Fronteira pública da devolução registrada80545

SQL de autoria do root: `supabase/migrations/20260911080545_finance_cost_disposition_return_public_boundary.sql`.
SHA256 testado: `ee7e5c73f88e47f882e0490175c574cb50418b23a7f44346f2ae61d3d24aa184`.
Teste novo: `src/test/costDispositionReturnPublicBoundary.test.ts`.

Sete testes passaram em2026-09-11,05:13:31(local); ESLint0. Nenhuma migração foi editada por este agente nesta tarefa.

## Evidências

- Authenticated recebe prévia válida com can_execute true e sem _evidence; picker e resultado passam nos schemas reais de produção.
- Comando público vincula1000 da entrada3000, replay retorna o mesmo resultado e mantém um vínculo; constraints diferidas são efetivamente executadas. Saída usada15000 permanece e entrada usada passa a1000.
- Funções brutas de contexto, comando e opções permanecem sem EXECUTE para authenticated, anon e service_role. SELECT da tabela privada e chamada direta do writer são negados. Chamadas anônimas reais de preview e picker também são negadas.
- Outro tenant, motorista e papel motorista misto são negados. Replay após revogação da associação da empresa é negado.
- Revogar EXECUTE de authenticated no comando público faz a prévia retornar can_execute false.
- Antes da primeira promoção, três contraprovas preservam nome/função do trigger e trocam: INSERT por DELETE; condição por WHEN(false); argumentos por valor inesperado. Todas são rejeitadas pela precondição, sem criar o dispatcher ou comando público.

Fixture usa cadeia real de lote, custo, pagamento, regularização72557, leitores72723, promoção74203 e overlay74603; acrescenta os mesmos corpos/trigger reais de recálculo e capacidade já documentados na prova do núcleo. Não há mocks de sucesso nem mudança manual de estado pago. A transação do ensaio é revertida ao final de cada caso. Não é ensaio de navegador/Auth hospedado nem concorrência nativa.

Nenhuma aplicação remota, commit, TSC ou deploy nesta tarefa. A publicação permanece coordenada pelo root após integração e verificações finais.

## Verifica��o do coordenador

Consulta somente leitura em produ��o confirmou os tr�s predecessores da74603: expense_cost_effective e0328bd06900f17657a6bbc985f491fa; receipt_movement_used_cents 05196cc18b7993460be1b4aa705eb291; expense_cost_coverage e03ebbe00144dbac0874cdb2c6e1a8e9. Todos security definer, search_path vazio e ACL somente postgres. Compatibilidade do ponto de partida confirmada; candidata ainda n�o aplicada. Typecheck global42570 passou antes do congelamento final da interface.
