# A6 — acesso próprio a pessoal atribuído

Base congelada: `1e1564bfcf28142c469749ee6b4985f4a4571bdd`, tree `a377f812c7c6e23a4b8100a10bfb5c427850b9c6`. Diagnóstico nativo: `task-3/1e-current-handoff/1E-A6-ASSIGNED-PERSONNEL-RLS-BLOCKER.md` e catálogos SAFE de `task-3/1e-backend-before`. O revisor mantém a fonte e os serviços UI4185/API57331/Edge57334; esta tarefa não altera esses serviços, bancos ou dados.

## Falha reproduzida

As políticas SELECT de `incident_responsible` e `employee_incident_actions` consultavam `employees` com EXISTS executado sob RLS do solicitante. Em1e, a leitura de RH permite somente owner/admin/operator. Por isso, o funcionário driver ativo, corretamente vinculado ao próprio employee e tenant, recebe listas vazias. A fixture anterior concedia SELECT de employees a todo membro e mascarava o defeito. O gate completo de1e (7707 testes aprovados/1 skip) não é aceite de A6 nem evidência para este sucessor.

## Escopo da correção

Lookup booleano no schema private, SECURITY DEFINER com proprietário controlado, search_path vazio, UID da sessão, tenant/workspace assinados, membership interna ativa e employee próprio ativo. Apenas authenticated recebe EXECUTE; não há argumento para escolher outro usuário, retorno de campos de RH ou nova permissão de tabela. A versão com assigned_user_id também exige o snapshot da atribuição; a versão publicada sem esse campo continua vinculada ao employee atual.

Somente os dois ramos de leitura própria são alterados por ALTER POLICY. Os ramos administrativos e todas as políticas de RH, writers, contexto restritivo, grants, constraints, triggers e helpers predecessores são preservados. Preflight verifica políticas e identidade/configuração/ACL/corpo dos helpers; drift ou estado parcial interrompe a transação. Não se desabilita RLS nem se amplia a leitura de employees.

O forward deve ser gerado pelo Supabase CLI fixado no projeto e adicionado ao manifesto suplementar com SHA256 final. Os13 forwards originais e12 suplementos anteriores permanecem byte-idênticos. Em ambiente isolado já em1e, adotar somente esse novo forward; uma restauração limpa exige a baseline e a sequência completa13+13. Nenhuma migration foi aplicada à réplica compartilhada ou produção nesta tarefa.

## Validação e limites

Testes locais usam PostgreSQL em memória e fixtures sintéticas: reproduzem o vazio antes do forward e verificam leitura própria depois, RH inacessível, pares/outro tenant/client/anon negados, status/inativação/revogações/contextos inválidos, snapshot/rebind, probes diretos do helper, writers preservados, replay, drift e rollback. Catálogos comparados antes/depois preservam objetos fora dos dois predicados alvo. Esses testes não substituem GoTrue/PostgREST/navegador nativos.

O novo candidato inicia os19 objetivos nativos como pendentes. O revisor continua os11 pendentes de1e, mas resultados anteriores não são herdados por outro SHA/tree. A6 exige reteste nativo próprio positivo e negativo, employee ainda ilegível, contexto real do JWT, verificação de private fora dos schemas expostos, catálogos/grants e rollback ensaiado em réplica descartável. Gate completo, CI, homologação combinada e publicação continuam pendentes até evidência do mesmo SHA/tree.

## Concorrência e retorno

O lookup STABLE usa o snapshot da instrução PostgreSQL e não modifica dados. Após commit de revogação/rebind/inativação, uma instrução nova deve perder o acesso antigo. Uma consulta já iniciada pode terminar com seu snapshot anterior; o forward não promete cancelar leituras em andamento. A variante sem assigned_user_id concede ao binding atual e não preserva identidade histórica adicional. Não se introduzem locks, versão de assignment ou alterações de escrita nesta correção.

O revisor deve exercer duas sessões nativas concorrentes: leitura iniciada versus revogação/rebind, commits em ambas as ordens e nova leitura posterior. Preservar rollback da transação recusada. A restauração das duas políticas anteriores e remoção do novo helper reintroduz o vazio de A6 e não desfaz dados, pois o forward não os altera. Executar somente após backup/catálogo atual e em ambiente autorizado; drift deve interromper o rollback também. Rollback local em memória não aprova rollback produtivo.

O executor nativo deve configurar `SET LOCAL lock_timeout = '3s'` e `SET LOCAL statement_timeout = '30s'` antes do DO, na transação externa controlada pelo executor. Configurar statement_timeout dentro do DO não garante limitar a instrução já em curso. O artefato não controla BEGIN/COMMIT nem altera timeouts de serviços compartilhados.

A política e o helper executam com os privilégios descritos na [documentação Supabase sobre RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). O comportamento de subqueries, SECURITY DEFINER e snapshots/races consta da [documentação PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Consultados em2026-10-06, junto com o changelog público Supabase (última entrada2026-10-05); nenhuma atualização de dependência faz parte desta correção.

## Entrega e restrições

O handoff contém candidato congelado, bundle com pré-requisito1e, delta binário, hashes dos arquivos e forward, logs locais do SHA exato e preservação das fontes. Correções futuras somente no novo worktree atribuído pelo coordenador. Sem enqueue/integrate, commit final de release, push, deploy, providers ou contas reais. Fontes manual e1e, task-2, integração e pin publicado preservados.

Novo forward CLI: 20261006013354_restore_assigned_incident_personnel_reads.sql, SHA256 e1f14cf67240bf29cc2a06d597bfef57fbc2f6fb965cfc88d540b4a9bb256470. Fixture usa catálogos SAFE nativos de1e; source draft manifest SHA256 68c46f69680f5445d604a69fd3db65a672d16d7710576dd11eb137babfdf0269.

Revisão estática independente confirmou preflight dos oito helpers (sete dependências de autorização mais admin preservado), ACL na primeira criação e replay, snapshot UUID/ausente, identidade interna+portal e rollback guardado. Após o draft fechado, a fixture foi corrigida para criar helpers na ordem de dependências, sem mudar corpos/owners/ACL, e o teste de rollback passou a comparar também todas as quals completas. A primeira tentativa parou na construção da fixture; logs foram preservados. Gates e hashes finais constam no handoff externo do SHA exato; nenhum passe nativo é herdado.
