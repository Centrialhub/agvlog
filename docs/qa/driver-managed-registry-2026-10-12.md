# Rename cadastral gerenciado e suspensão de acesso existente

Candidato local sobre `2511c927f68371e9c9672925a3e956b2db5c0989`, tree de origem `0a3605e7780014aa9995855a24cce63aa1652275`. Fork-review oficial `driver-managed-registry-20261012`, owner `CodexManagedRegistry`. Origem congelada com aceite apenas parcial pela coordenação; nenhum arquivo/ref da origem foi alterado. Sem integração, publicação, operação Auth real ou dados pessoais.

## Causa e correção

Após criação de username, só o cadastro de origem e sua membership têm a identidade gerenciada. Rename dispara projeção que tenta INSERT de membership nos CNPJs irmãos, causando `managed_driver_invalid_membership`. Ignorar apenas esse INSERT ainda copia user_id para outros cadastros e provoca `managed_driver_invalid_link`. Cadastro compartilhado não pode servir de provisionamento de conta.

O forward `20261012214500_separate_driver_registry_and_suspend_existing_access.sql` exclui user_id da atualização de projeções de drivers, define user_id=null em novos cadastros projetados e remove o provisionamento de memberships desse trigger. Preserva todos os user_id já existentes, campos de pessoa compartilhados e a otimização de campos exclusivamente veiculares do forward anterior. Não altera guards de vínculo/criação, nem profiles.full_name. A consulta aos consumidores locais de projeção não encontrou outro leitor que use workspace_people.source_data como concessão de acesso; o snapshot de origem permanece dado cadastral, sem autorização nova.

A suspensão pelo CAS de Equipe falhava pelos mesmos INSERTs antes do ON CONFLICT, nos triggers de sincronização tenant→workspace e workspace→tenants. Os dois ganham um ramo exclusivamente para UPDATE de driver que mantém identidade, role e escopo, com active=false. Atualiza só vínculos existentes no workspace canônico, sem inserir ou deletar linhas, sem tocar drivers.active, user_id ou Auth. Ausência de workspace_membership não obriga sua criação. Outro workspace permanece intacto. Papéis mistos, inclusive owner, fazem rollback com `driver_suspension_mixed_operation_roles`; nenhum papel é convertido ou silenciosamente suspenso.

Reativação legada continua sujeita ao guard anterior e permanece recusada. Criar/converter conta, promover role, mudar identidade ou retirar vínculos não recebe permissão neste pacote. A aprovação posterior de credenciais será implementada em pacote separado.

## Locks, invariantes e alcance

O CAS existente trava a linha selecionada, valida administrador daquela empresa, revisão e owner. O trigger de suspensão adquire NOWAIT: lock exclusivo da linha Auth do alvo, shares das linhas tenant do workspace, locks dos memberships existentes e do workspace_membership. Guards originais de INSERT/UPDATE de escopo usam SHARE nessa mesma linha Auth; o upgrade exclui novos/movidos vínculos durante a suspensão, sem alterar dados Auth. Há custo de contenção breve para a mesma identidade entre operações; falha de lock exige retry/releitura, nunca sucesso parcial. A ordem determinística e NOWAIT evitam esperar com o lock inicial do CAS já adquirido em outro tenant.

Revalida papéis mistos depois dos locks. Exige bodies/owner/SECURITY DEFINER/search_path esperados nos cinco alvos, corpo conhecido do guard de escopo e triggers de escopo habilitados nas duas tabelas. Forward atômico, idempotente, sem DML durante instalação. Preserva todos os demais campos pg_proc, inclusive ACLs, OIDs, owner e configuração. Não substitui o modelo de autorização do CAS nem afirma resolver todas as alterações concorrentes possíveis de autoridade do administrador; isso requer validação integrada/Native.

Não altera os guards de RPC operacional de `59a048bbf21e6b19d9e4003b0c6736c8e46baab3`. A suspensão administrativa e esses guards são complementares: sem os guards operacionais, a pós-condição administrativa sozinha ainda permite o bypass previamente comprovado. Este branch contém 2511c927, não incorpora 59a048bb. O integrador precisa validar a árvore combinada, sem presumir cherry-pick automático ou aceite integral.

## Prova sintética e limites

Arquivo novo `src/test/driverManagedRegistryProjection.test.ts`, com predecessores SQL reais de guards, reserva/INSERT Auth modelado, projeção e CAS/auditoria. Usa PGlite, um worker, dados e claims sintéticos; sem GoTrue, PostgREST, rede, WSL/Docker ou infraestrutura compartilhada. O teste de criação modela INSERT Auth com metadata esperada; não certifica a ordem completa Native de GoTrue.

Cobertura: rename gerenciado antes/depois e novo cadastro em terceiro CNPJ sem conta; rename legado com membership ausente; vínculo inativo e outro role preservados; identidade diferente no destino não sobrescrita; workspace estrangeiro intacto; suspensão legada e gerenciada antes/depois; ausência de workspace membership; entrada por workspace membership; papéis mistos/operator/owner negados; CAS e ator; guards de criação/vínculo globais intactos; rollback se audit de irmão falhar; metadata/ACL/idempotência; recusa atômica de predecessor ou trigger divergente.

A fixture instala o grafo de triggers pertinente, mas não é schema Native integral. RLS completa, fluxo de navegador e duas conexões reais permanecem gates. Na árvore anterior existem testes de caracterização que deliberadamente esperam falhas agora corrigidas (por exemplo o primeiro pacote de design); não executar esse arquivo antigo e interpretar tais expectativas históricas como comportamento desejado. Os testes novos fixam o contrato novo sem editar o registro congelado.

Node disponível 24.19.0; engine do projeto Node 22. Dependências somente lidas por junction para node_modules do QA; temporário/config/cache em C: exclusivos da tarefa. Nenhuma instalação ou alteração de dependências.

## Gates de revisão/Native

1. Suspensão e evento com mesmas claims em duas sessões, incluindo cada ordem de aquisição de locks, commit/rollback e retry. Após commit da suspensão, todas as RPCs protegidas de A negam; B continua válida. Testar árvore combinada com 59a048bb.
2. Corrida entre dois tenants irmãos tentando suspender a mesma identidade; NOWAIT deve negar uma transação sem efeitos parciais. Corrida com INSERT/movimento de membership/papel deve bloquear/falhar no guard Auth; após a corrida, revisar escopo completo novamente.
3. Alteração concorrente do workspace canônico, do administrador e de atribuições de viagem. Confirmar autorizações atuais, não apenas snapshots antigos.
4. Schema integral, owner/grants/bodies live reconciliados, GoTrue e frontend, sem usar dados pessoais produtivos. Não publicar para descobrir divergência.

Storage continua fora da garantia transacional: secure-upload autoriza antes do scanner e grava não financeiro com service_role posteriormente; requisição já em andamento e URLs emitidas não são canceladas por esta suspensão ou pelo forward de RPCs. Não afirmar revogação completa.

## Pins dos cinco corpos

| Assinatura | Antes → depois (MD5 prosrc) |
| --- | --- |
| private.apply_shared_projection_columns(text,jsonb,uuid) | 7e7a0bd09ba0dc5e44e27f93708a3c0f → 8b50844ce9b96b1df5d6924e1886507e |
| private.insert_shared_projection(text,jsonb,uuid,uuid) | 3db01028e6671223606631f7117e9b95 → 3e4187d2b532cce30e3b2b82485e6c47 |
| private.sync_workspace_person_projection() | 9dbdd1516632ffdcc7082fa6eae782da → b7630d4403a3d529cea2f71169ed802a |
| private.sync_employee_from_tenant_membership_v1() | 3b05db0b8a1eb30ca63e13047c593118 → 89a57e095f3af86c2f4bfb5488b0cfac |
| private.sync_employee_from_workspace_membership_v1() | e41ac02a0164e958e93a552d546dba65 → 5fb06f91e10ba2253f343c9a189665d5 |

Validação final direcionada: **17/17 testes PASS, 36,40 s; lint e TypeScript noEmit PASS**. Diff whitespace verificado antes do commit local. Sem validação Native ou concorrência de duas sessões nesta execução.
