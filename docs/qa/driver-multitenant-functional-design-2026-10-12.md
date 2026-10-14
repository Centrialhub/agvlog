# Motorista compartilhado: prova, correção local e limites

Complemento ao relatório `driver-multitenant-investigation-2026-10-12.md`. Prevalece sobre suas conclusões preliminares sobre edição cadastral e ausência de reconciliação live. O primeiro commit `97d09c4e0236e4c5295664fa30b911bf4be8a5d5` permanece separado como registro da investigação inicial. Nenhuma publicação, migração remota, operação Auth real, exclusão ou desvinculação foi executada.

## Causa comprovada

Há dois mecanismos distintos, ambos presentes no código publicado reconciliado:

1. **Consulta de acesso tratada como administração global.** `manage-driver-access/handler.ts` chama `driver_access_scope_v1` também em `inspect`. A função privada correspondente em `20261005204938_driver_username_access.sql` rejeita qualquer outro tenant, mesmo duas empresas do mesmo workspace com papel driver ativo. Retorna `driver_account_shared_or_other_role`, convertido em HTTP 409. O componente comum `DriverAccessControls` propaga o erro em Motoristas e Equipe. Não é resolução ambígua do username: o login deriva um e-mail global determinístico e chama Auth diretamente.
2. **Edição cadastral dispara tentativa de novo vínculo.** `private.sync_workspace_person_projection`, em `20260910142232_synchronize_shared_master_projections.sql`, roda após qualquer INSERT/UPDATE em drivers. Ao projetar para outra empresa do workspace, tenta INSERT em `tenant_memberships`, mesmo quando o vínculo já existe, usando ON CONFLICT DO NOTHING. O BEFORE INSERT `guard_driver_account_scope_v1` rejeita o driver legado antes de resolver o conflito. A atualização inteira reverte com `driver_accounts_require_username_creation`. Isso afeta nome e até `current_vehicle_id`, que nem é um campo compartilhado.

**Correção da conclusão inicial:** o primeiro ensaio não instalava `drivers_sync_workspace_projection`; provava somente que o guard de conta permitia manter user_id/tenant_id. Com o trigger e os vínculos canônicos instalados, a edição cadastral compartilhada falha. O relatório inicial não deve ser usado para concluir que o cadastro publicado estava livre desse defeito.

Também foi reproduzida falha atômica da desativação pelo CAS real `update_tenant_membership_v1`: a sincronização de empregados/workspace tenta inserir novamente o driver legado. Não corrigimos esse terceiro caminho neste pacote: ele tem semântica de propagação entre empresas, não de revogação estritamente local.

## Versão efetivamente afetada

- Frontend publicado conhecido e confirmado pelo preflight: PATCH1 `df6dfd513098ff8967256ae9a2bbad8118fa35cd`.
- Base candidata: PATCH2 `50b6fe92a5501aac9588eec7b88d47dc3a21cf38`, tree `365951219f38d2e63d7f00de80bc9995010a6ffe`. Não presumimos publicação de PATCH2.
- Reconciliação read-only fornecida pela coordenação: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task/production-driver-runtime-reconciliation-20261012`.
- `manage-driver-access` live v1, bundle SHA256 `d20f62c4053b3b388976c503db07a4819395ee195d25fe1f161329dc11e85dfc`.
- `update-team-member` live v84, bundle SHA256 `89fcceb1d744e5d7cc26a7627575d73407827e8287a4999ad09388a024d2904d`.
- Nove arquivos Edge e os três corpos RPC comparados coincidem entre live/PATCH1/PATCH2. Os corpos de projeção e sincronização ativos também coincidem com o candidato. O pin do frontend sozinho não provaria isso.
- SHA256 do catálogo de código: `df8c12238216136d1a0d0c2b7b58a36b70417be383b7c3f0e6c239a56c7a3eff`; comparação: `cfdee35ef59939017d10f1100b6372d88fdc1926c732e8fef9cafe0e3f5e492b`.

Isso comprova aplicabilidade dos mecanismos ao código publicado, não identifica uma conta ou reproduz a sessão pessoal do cliente. Apenas código/catálogo e dados sintéticos foram examinados.

## Fronteiras e matriz de ações

O modelo já define workspace como grupo operacional e tenant como empresa legal/fiscal (`20260910125751_workspace_tenant_foundation.sql`). Compartilhar pessoas entre CNPJs do mesmo workspace é esperado. Identidade Auth continua global, inclusive quando existe vínculo em outro workspace.

| Ação/dado | Escopo real | Regra e resultado deste pacote |
| --- | --- | --- |
| Inspecionar acesso em Motoristas/Equipe | Vínculo na empresa selecionada | Exige JWT, contexto ativo e owner/admin efetivo dessa empresa. Novo inspect v2 retorna vínculo/capacidades; compartilhamento não vira erro genérico. |
| Veículo atual do motorista | Empresa | Edição isolada deixa de disparar projeção de pessoa. Trigger próprio de veículo não é alterado. |
| Nome, telefone, e-mail, CPF, notas, ativo de drivers | Pessoa compartilhada no workspace | A projeção existente compartilha todos os campos exceto identidade de linha/escopo/auditoria e current_vehicle_id. Não chamar esses campos de edição local. Correção preserva a projeção existente e memberships já existentes. |
| user_id/tenant_id/workspace_id | Referências de identidade e escopo | Não expor edição livre. Guards e constraints existentes preservados. |
| full_name na Equipe | profiles global | `update-team-member/index.ts` atualiza por profiles.id; não é apelido local. Não alterado. Revisão deve separar nome cadastral de identidade global, especialmente entre workspaces. |
| Suspender/reativar membership | Atualmente propaga pelo workspace | Falha legada reproduzida. Não liberar como se fosse operação só daquela empresa; exige contrato explícito e revisão de triggers. |
| Criar username para cadastro sem conta | Identidade global + vínculo autorizado | Fluxo atual preservado; exige cadastro ativo sem user_id. Não cria segunda identidade sobre conta existente. |
| Converter conta legada/trocar credencial compartilhada | Auth global | Ainda indisponível. Capacidade false. Não remover guard nem desvincular para contornar. |
| Excluir identidade/retirar conta antiga | Auth global e revogação relacional | Nenhuma nova permissão. Retire existente revoga relacionamentos antes do soft delete Auth; não é revogação local. Fora da execução autorizada. |

`private.is_workspace_admin` já aceita owner/admin ativo de qualquer empresa do workspace, além de workspace_membership. Portanto não inventamos uma autoridade distinta de “administrador global” nem afirmamos que essa função separa administrador de uma empresa de administrador do grupo. A correção SQL preserva RLS, grants, roles, assinatura, owner e SECURITY DEFINER. O novo endpoint mantém sua verificação explícita de administrador da empresa selecionada.

Não há coluna `tenants.active` neste baseline. Há memberships.active e workspaces.active. “Empresa inativa” precisa especificar qual entidade/regra significa; o pacote não inventa essa política. Vínculo driver inativo já existente é preservado sem reativação; papel diferente também não é rebaixado.

## Correção mínima preparada, somente local

**SQL:** migration `20261012203921_driver_existing_workspace_projection.sql`, criada com Supabase CLI, altera somente o corpo de `private.sync_workspace_person_projection()`:

- Ignora UPDATE de drivers quando a única mudança é current_vehicle_id/updated_at/updated_by.
- Antes do INSERT existente em tenant_memberships, verifica ausência do par tenant/user. Preserva exatamente a intenção anterior de ON CONFLICT DO NOTHING para vínculo já existente, sem acionar desnecessariamente o BEFORE INSERT.
- Vínculo ausente continua sujeito ao guard original. Não provisiona acesso legado automaticamente, não reativa nem muda papel.
- Preflight recusa corpo/trigger/owner/SECURITY DEFINER/search_path inesperados. Hash prosrc anterior `e57ff8b148a6e8c4ac4b11913f9b8916`, candidato `9dbdd1516632ffdcc7082fa6eae782da`. Reaplicação é idempotente. Não há DML de migração de usuários ou concessão de permissões.

**Edge/UI:** inspeção opt-in `version:2`. Primeiro comprova driver local ou membership driver local; IDs globais sem vínculo local recebem 404. Só a recusa identificada `account_scope_restricted` é convertida em estado `linked` somente leitura. Não retorna e-mail, nomes/IDs/quantidades de outras empresas, papéis externos ou metadata. Falhas reais permanecem erros. Capabilities de senha derivam da regra estrita já existente; mutações continuam revalidando pelo mesmo RPC. Criar/alterar senha/retire não ganham novas permissões.

O componente comum renderiza o vínculo como estado normal, sem “tentar novamente” para uma restrição permanente. Remove instrução de excluir conta como pré-requisito, também no fallback legado. O endpoint v1 continua compatível; implantar Edge antes do frontend é necessário para obter a inspeção v2. Frontend novo com Edge antigo continua recebendo o 409 compartilhado, sem ganho indevido de capacidade. Nenhuma escolha automática de tenant foi introduzida.

## Prova local e limites de validação

- Resultado final direcionado: **4 arquivos / 66 testes PASS** (35 handler existentes, 10 regressões de gerenciamento, 16 SQL de fronteira/projeção, 5 UI), 44,53 s, um worker. Lint dos seis arquivos TypeScript alterados PASS. Verificação de tipos direcionada (arquivos alterados e dependências, noEmit) PASS; foram corrigidas tipagens de snapshots sintéticos, sem alteração de lógica.
- Configs de execução preservadas em `C:/Users/Thomaz/Documents/Codex/2026-10-12/task/investigation.vitest.config.mjs` e `investigation.tsconfig.json`. Comando: `node F:/AGVLOG/work/patch2-final-validation-v2-20261012/node_modules/vitest/vitest.mjs run --config C:/Users/Thomaz/Documents/Codex/2026-10-12/task/investigation.vitest.config.mjs --configLoader native --no-cache`, executado no workspace próprio. As quatro suítes são explicitadas nessa configuração; não é execução da suíte completa.
- Regressão Edge: dois testes v2 falharam antes do handler novo (esperado 200, recebido 409). Com a correção, a inspeção funciona pelos dois alvos, driver_id e user_id; negativos cobrem ator externo, driver externo, divergência de contexto e identidade sem vínculo local. Spies confirmam ausência de chamadas Auth de mutação e snapshot confirma grafo inalterado.
- SQL sintético PGlite: o mesmo UPDATE falha antes e passa depois da migration; nome propaga para duas empresas do mesmo workspace e não para workspace independente. Memberships, workspace_memberships, profiles e Auth permanecem iguais. Testes cobrem veículo local, vínculo ausente, inativo, outro papel, idempotência e preservação de metadata/guards.
- UI: estados compartilhado/legado/inativo são apresentados sem formulário indevido; falha de transporte continua alerta.
- Execução direcionada com um worker, sem cache compartilhado, sem WSL/Docker/serviço compartilhado. Dependências já disponíveis foram lidas; nenhuma instalação. Node local 24.19.0 difere do engine esperado Node 22.
- Fixture SQL inclui corpos reais dos triggers pertinentes, não todo o grafo de Native/Postgres. Não valida RLS completa, concorrência, FK/trigger integral de veículo, JWT real ou GoTrue. Isso exige revisão/QA coordenada antes de integração/publicação.

## Próxima etapa e bloqueios remanescentes

Este pacote corrige inspeção e edição do cadastro com vínculos existentes; **não resolve toda a conversão para username nem habilita gestão global de credenciais compartilhadas**. Isso precisa de contrato que preserve user_id, histórico e memberships, com revalidação transacional de pertencimento ao mesmo workspace e permissões efetivas, sem outro workspace, papéis privilegiados ou portal incompatível. Metadata tenant de origem e guard de provisionamento precisam ser tratados juntos; retirar um OR tenant diferente isoladamente é incorreto.

Para a próxima decisão: distinguir consulta local, edição de pessoa do workspace, suspensão por empresa/grupo, alteração de identidade e alteração de senha. Não confundir desvinculação com revogação: um JWT já emitido pode continuar válido e precisa de autorização relacional em cada operação. Considerar conta com vínculos inativos, identidade em dois workspaces, ator desativado durante a operação, CAS/conflito, concorrência com mudança de papel, compatibilidade de versão e auditoria sem dados secretos.

O primeiro relatório contém as referências complementares de Auth/onboarding/seleção. O fallback preexistente memberships[0] não é usado como solução; escolha de empresa deve ser revisada separadamente se exigida pelo produto. Módulos fiscais/licenciamento permanecem fora do escopo.

Revisão independente e integração pertencem à coordenação. Nenhum checkout de homologação, branch integradora, banco real ou recurso QA foi alterado. A primeira execução de ajuda do CLI encontrou EPERM no arquivo local de telemetria; a mesma operação foi autorizada pelo fluxo normal de auto-review e concluída, sem contorno. Não resta bloqueio de permissão; restam decisão de contrato e validação Native antes de release.
