# Guards de vínculo para RPCs operacionais de motorista

## Resultado e limite de aceite

Candidato local, não integrado nem publicado, baseado em `50b6fe92a5501aac9588eec7b88d47dc3a21cf38`. Corrige o bypass comprovado em que a mesma sessão continuava lendo jornada e criando eventos depois de todos os vínculos da operação ficarem inativos. Não implementa a ação administrativa de desativar uma operação, não altera `drivers.active`, não desvincula cadastros e não revoga a identidade Auth global. A falha do fluxo administrativo de suspensão permanece uma pendência distinta.

O forward altera somente corpos de 23 funções existentes e cria um helper privado sem execução para `anon`, `authenticated` ou `service_role`. Não faz DML, não muda roles, RLS, ACLs existentes, senhas ou identidade. Contas/cadastros e acesso válido em outra operação permanecem separados.

## Causa e versões

`driver_get_journey_context`, `_assert_driver_owns_trip` e `_lock_driver_journey_trip` comprovavam `drivers.user_id=auth.uid()` e `drivers.active`, mas não o vínculo ativo do ator ao tenant da viagem. São funções privilegiadas; a RLS que nega acesso direto após a desativação não compensa esse guard ausente. `driver_create_event` e `driver_save_checklist` herdam a autorização de `_lock_driver_journey_trip`.

A reconciliação somente de código da coordenação confirmou os corpos publicados de `driver_get_journey_context`, `driver_create_event`, `_lock_driver_journey_trip` e `_assert_driver_owns_trip` iguais aos da base 50b6fe92, originados em `20260830024309_enforce_driver_journey_state_machine.sql`. Todos são SECURITY DEFINER, owner postgres/BYPASSRLS, search_path vazio; as tabelas têm RLS sem FORCE. Evidência: `production-driver-deactivation-reconciliation-20261012/LIVE-TO-50B6FE92-COMPARISON.json`, selo SHA-256 `d0a4098fb4c801f997b9e52f238df7761ee4db28d7e2dc8fcba1b8d880683281`. Nenhuma RPC produtiva foi executada com ator real.

O frontend publicado conhecido continua PATCH1 `df6dfd513098ff8967256ae9a2bbad8118fa35cd`; a base PATCH2 acima não é evidência de publicação. Os demais corpos deste forward têm predecessores locais pinados; sua correspondência com o catálogo live ainda exige leitura mínima pela coordenação. A migração recusa predecessor desconhecido e não deve ser aplicada para descobrir divergência em produção.

## Inventário e escolha do guard

O inventário combinou chamadas do frontend/Edge, corpos SQL, migrações de rename/revoke e políticas. O JSON auxiliar de busca lexical não substitui o catálogo final. A lista exata dos 23 predecessores, arquivos, assinaturas e hashes de corpo antes/depois está em `src/test/helpers/driverOperationalMembershipPins.json`.

| Superfície | Decisão |
| --- | --- |
| Jornada, evento, checklist | Leitura exige `is_tenant_member`; lock compartilhado em `_lock_driver_journey_trip` cobre as escritas consumidoras sem reescrever seus fluxos. |
| Chegada, saída, início de viagem, entrega | Lock do vínculo no tenant concreto antes das escritas/locks de negócio. `_lock_driver_delivery_stop` cobre os consumidores de resultado de entrega. |
| Ocorrência operacional | Lock após resolver a viagem e seu tenant, antes de escrever. |
| Comandos offline | Lock antes de consultar recibo/replay; uma repetição também precisa de autorização atual. |
| Carga e lacres | `require_trip_cargo_actor` exige vínculo; wrapper `driver_update_trip_cargo_v1` trava antes do replay/escrita privada. A revisão posterior de precisão de peso da função privada não é sobrescrita. Leituras de carga já exigem vínculo. |
| Helpers RLS de motorista/viagem/carga/parada/veículo e posição | Predicados de vínculo ativo sem mudar o conjunto de roles permitido pelo restante da função. |
| Jornada física | Ramo motorista exige vínculo no tenant canônico pertencente ao workspace da jornada. Mantém contrato existente sem seletor de tenant e sua ordenação; não inventa empresa padrão nem primeiro tenant. Ramo operador preservado. |
| Qualidade de comprovante | Ramo motorista passa a exigir vínculo; ramo operador preservado. |
| Observabilidade | Lock antes dos guards existentes de contexto e role; nenhum novo acesso. |
| Chat, despesas/financeiro, arquivo fiscal | Guards vigentes já exigem vínculo ativo; chat/financeiro possuem seus próprios locks. Nenhuma reescrita de autoridade financeira ou portal. |
| SQL legado de evento/workspace/transição | Endpoints anteriormente revogados ou reservados a serviço não recebem grant novo. |
| Acesso direto às tabelas e Storage autenticado | Mantidas as políticas de contexto ativo e permissivas existentes; não se afirma que uma policy de contexto sozinha confira vínculo. Helpers de ownership recebem o guard. |
| Edge `secure-upload`/cleanup | Valida vínculo ativo na entrada. Upload não financeiro tem janela entre essa leitura, scanner e escrita Storage via service_role; fora da garantia transacional SQL deste forward. |

`private.require_driver_operation_membership_v1` consulta somente o vínculo existente do ator ao tenant resolvido pela operação, exige `active`, verifica workspace canônico não nulo e usa `FOR SHARE OF m,t NOWAIT`. Não exige um novo role `driver`: os predicados originais continuam responsáveis por role e atribuição. O lock impede que uma desativação ou mudança do vínculo/tenant se confirme no meio de uma escrita protegida. Se a desativação já detém o lock, a operação falha fechada com `55P03`; vínculo ausente/inativo dá `42501`. Isso pode exigir retry de uma ação válida durante concorrência, sem autorizar a ação revogada.

O modelo pressupõe que desativar uma operação torna inativos todos os vínculos tenant dessa operação. Alterar somente `workspace_memberships.active` deixando `tenant_memberships.active=true` não implementa essa pós-condição. O candidato não cria tal mutação administrativa nem resolve o trigger que hoje pode revertê-la.

## Migração e segurança

`20261012211033_driver_operational_membership_guards.sql` foi criada pelo CLI. Um único DO valida todos os predecessores antes de alterar corpos. Exige owner/SECURITY DEFINER esperados e hash de corpo conhecido, verifica contagem das âncoras, hash final e igualdade dos demais campos de `pg_proc`. Reaplicação é idempotente; qualquer divergência aborta tudo. `is_tenant_member(uuid)` também é pinado (`9dc8218defa0226b77bcb3d8b6718fcb`). Novo helper: MD5 do corpo `094c0e69e6b4c861e2d4b607a427bb23`.

ACL, owner, volatility e configuração dos 23 alvos são preservados, não reinterpretados. A pré-validação pinou corpo, owner e SECURITY DEFINER, mas não autentica todo o catálogo live; a coordenação deve confrontar também grants/configuração antes de homologar. Nenhum Auth ban/reset, escolha de tenant, remoção de vínculo ou mudança de cadastro participa da correção.

## Reprodução e testes leves

`src/test/driverOperationalMembershipBoundary.test.ts`: 15 testes PGlite PASS; lint e TypeScript direcionados PASS. A fixture executa os corpos SQL reais dos predecessores e o forward inteiro, com schema mínimo e dados/claims sintéticos. O teste antes/depois mantém as claims: antes aceita leitura e evento mesmo com vínculos inativos; depois ambos dão 42501, sem efeitos, e outra operação continua utilizável. Exercita ainda checklist, replay offline, chegada/saída/início, carga, qualidade, ocorrência, observabilidade, helpers, jornada física, ator alheio, trip de outro workspace, role válido alternativo, rollback, idempotência, ACL/metadata e recusa atômica de drift.

As tabelas mínimas não equivalem ao schema integral nem à execução completa de todos os fluxos de entrega/carga. Alguns testes negativos param deliberadamente antes do negócio, provando a fronteira de autorização; não certificam o caminho positivo completo desses módulos. A fixture aplica a pós-condição de desativação diretamente, sem simular sucesso do fluxo administrativo atualmente bloqueado.

Execução isolada: um worker, sem cache compartilhado, sem WSL/Docker/serviço; Node 24.19.0 disponível (projeto exige Node 22). Dependências somente lidas do checkout QA por junction local. Configuração de execução e cache ficam na pasta da tarefa em C:. A diferença de runtime e o Native abaixo permanecem gates.

## Gates Native e limite de concorrência

Não há PostgreSQL nativo disponível no ambiente inspecionado. PGlite não prova concorrência de duas sessões: o teste de rollback sequencial não é apresentado como tal. Antes de qualquer integração/publicação, executar em ambiente Native próprio coordenado, com fixture sintética e mesmas claims:

1. Sessão A inicia transação e cria evento protegido sem commit. Sessão B tenta desativar todos os vínculos da operação com timeout curto: deve aguardar/falhar, sem confirmar desativação enquanto A detém o lock. Após commit de A, B confirma. Novo evento/leitura/replay com claims antigas deve negar.
2. B detém update não confirmado do vínculo; A tenta evento/checklist/offline/carga: deve falhar `55P03`, sem efeitos/recibos. Commit de B: retry nega `42501`. Rollback de B: retry válido funciona.
3. Repetir com rollback do evento, alteração concorrente de role/workspace canônico, dois tenants da mesma operação e acesso válido em outra operação. Verificar ausência de deadlock, efeitos parciais e ampliação de escopo. Não usar identidades reais.
4. Executar caminhos positivos completos de entrega/carga/observabilidade e migrations contra schema integral. Comparar ACL e corpos de todos os alvos com o manifesto.

Leituras iniciadas antes do commit podem observar snapshot anterior. Requisições Edge já autorizadas, scanner/upload em voo e URLs Storage já emitidas não são canceladas por locks SQL. A janela de upload exige decisão/contraprova separada antes de afirmar revogação integral. Não há alteração silenciosa de Auth global para encobri-la.

## Pendências relacionadas, fora deste pacote

O pacote anterior `2511c927f68371e9c9672925a3e956b2db5c0989` é aceite parcial de inspect/projeção legada, não fechamento integral do relato. Rename após criar username ainda provoca `managed_driver_invalid_membership` e, se apenas o INSERT for ignorado, pode provocar `managed_driver_invalid_link` ao copiar user_id. A correção deve separar projeção de cadastro de provisionamento de conta e preservar vínculos existentes. Fork isolado solicitado foi recusado pelo coordenador: `review fork requires an existing exact frozen candidate`; aguarda registro correto do freeze, sem contorno por Git manual.

Conversão/credenciais globais dependem da decisão de autoridade ainda pendente. Suspensão administrativa, profiles.full_name global e a janela RPC→Auth preexistente não foram resolvidos por este forward. Nenhuma alegação de resolução integral deve acompanhar os 15 testes.

Execução final após o ajuste de compatibilidade TypeScript: **15/15 PASS, 35,29 s**. Duas tentativas no sandbox pararam antes dos testes (EPERM no temporário Vite e resolução de PGlite pela junction). A repetição pela escalada normal, aprovada, com TEMP/TMP da própria tarefa e `--no-cache`, passou. Não houve negativa de auto-review nem modificação das dependências QA. O bloqueio de fork descrito acima é uma recusa distinta do coordenador do repositório e não foi contornado.
