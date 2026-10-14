# Correções da revisão de credenciais — candidato local, 2026-10-12

Task `driver-credentials-review-fixes-20261012`, owner `CodexDriverCredentialFixes`. Fork-review oficial de `9a2248c8762dd775de23529532c0adf3d292cb7a`, tree `f862cc2901f745f98ab33dac29449b80e29ea3ea`. Fonte congelada preservada. Revisão motivadora: `C:/Users/Thomaz/Documents/Codex/2026-10-01/task-2/driver-credentials-9a2248c8-review-20261012/REVIEW.md`, selo informado `37e91f7ef5e96da721cec1d90010d477eea82dc66d89932a65a6ce430488a501`.

Este delta é somente local. Não houve integração, deploy, execução Auth real, leitura de usuários produtivos, deleção/desvinculação real nem interferência na homologação. A revisão anterior favorável a cadastro/pós-lock não autoriza publicar credenciais.

## Falhas reproduzidas e correções

1. **Reativação:** 49a19add tratava suspensão por UPDATE, mas a reativação de conta convertida voltava ao INSERT/UPSERT de workspace/tenant membership e falhava antes de ON CONFLICT. As duas sincronizações agora tratam alteração de estado de acesso gerenciado por UPDATE dos vínculos já existentes, preservando IDs, papéis e empresas. Um helper privado revalida escopo exclusivo de motorista na operação, incluindo vínculos inativos, papéis, portal e flags/identidades Auth. Não cria memberships faltantes nem escolhe o primeiro tenant. A criação legítima pode deixar workspace_membership ausente; essa ausência permanece preservada, sem bloquear a reativação do vínculo tenant existente. Legado não convertido mantém o bloqueio anterior de reativação.
2. **Status fora do escopo:** somente um comando ou cancelamento conhecido e pertencente ao mesmo ator/tenant/user pode ser reconciliado sem repetir a elegibilidade atual do alvo. Para request_id ainda ausente, `driver_workspace_credential_status_v1` exige a autorização completa de `private.driver_workspace_credential_scope_v1` antes de inserir cancellation. Um owner de outra empresa sem vínculo local não gera registro nem alteração Auth. Falha de reconciliação retorna unconfirmed; não libera repetição. Mudança posterior de elegibilidade do alvo não destrói a possibilidade de reconciliar um recibo conhecido, desde que o ator ainda seja admin ativo do contexto e dono do pedido.
3. **Desvinculação:** o guard examina e trava a identidade OLD quando user_id muda, antes do retorno rápido para NEW.user_id NULL. Se a conta anterior é workspace-managed, recusa NULL e substituição por outra identidade com 42501. Um trigger BEFORE DELETE também recusa remover o cadastro ligado à identidade convertida por um caminho administrativo genérico. Cadastros sem conta continuam criáveis e editáveis; projeção continua sem provisionar acesso. Não foi retirada a nulabilidade da tabela.
4. **Contrato defensivo de recibo:** Edge e frontend deixaram de aceitar `not_found` como terminal. Somente succeeded/cancelled confirmados liberam a reconciliação. O cancelamento persistente anterior à preparação continua impedindo um pedido atrasado de aplicar credenciais.

## Dependências e objetos

Forward incremental criado pelo CLI: `20261012224659_driver_credentials_review_boundaries.sql`, após:

- `20261012214500_separate_driver_registry_and_suspend_existing_access.sql` do SHA **49a19add4e467567934f4daf36f3eccab4cf91fe**, tree **579d77d900dbd9ab5011569dc98746dc2b4c5979**;
- `20261012215337_driver_workspace_credential_commands.sql` do SHA **9a2248c8762dd775de23529532c0adf3d292cb7a**.

49a19add é dependência funcional, não ancestral Git deste fork. A fixture inclui uma cópia **apenas de teste** da migration de 49 em `src/test/helpers/driverRegistry49Pinned.sql`; SHA-256 do blob LF `6be1f95e05e944392b3a24466724b96829d08b883bd692dc320b0e6864692ab0`, verificado ao carregar. Não existe uma segunda migration de 49 no diretório produtivo. A integração deve incorporar o pacote original 49 antes de 9a e deste delta.

Quatro corpos alterados, sem mudar assinatura, owner, ACL ou outra metadata:

| Função | MD5 anterior | MD5 final |
|---|---|---|
| private.sync_employee_from_tenant_membership_v1() | 89a57e095f3af86c2f4bfb5488b0cfac | 8ebbd5461ef85ccf798e12539f4ba2ef |
| private.sync_employee_from_workspace_membership_v1() | 5fb06f91e10ba2253f343c9a189665d5 | b7aedce35cbe75bcde38c3f7cb131853 |
| public.driver_workspace_credential_status_v1(uuid,uuid,uuid,uuid,boolean) | 78cfcdb03509a1cbe84cd7b54ad8a947 | 6c1e4d0f1e5e3be7c80e8bc95a393d71 |
| private.guard_driver_account_scope_v1() | 2ee9f8e664c19efdc6226d6cd1a8190b | ca6e0ce58e27d1e68ba2b91865b4cc3f |

Dois helpers privados novos: `require_driver_reactivation_scope_v1(uuid,uuid)` e trigger function `protect_converted_driver_registry_delete_v1()`, ambos sem EXECUTE para PUBLIC/anon/authenticated/service_role. Não há concessão nova, mudança de roles ou policies RLS. Preflight exige hashes dos predecessores, metadata essencial e guard de drivers ativo; alteração desconhecida/reaplicação é recusada. Instalação requer transação única.

## Verificação

A fixture combina corpos reais de sincronização, projeção, CAS de Equipe, auditoria, guards de conta, as migrations 49 e 9a e o novo delta. Não omite os triggers responsáveis pela contraprova. Os 70 testes anteriores passaram na primeira combinação. A suíte nova reproduziu os três defeitos antes do delta e validou as correções. Um primeiro ciclo de criação expôs a exigência indevida de workspace membership na nova revalidação; removida a exigência, preservando ausência e sem INSERT. Três falhas adicionais desse ensaio eram cleanup duplicado de PGlite em testes sem banco; corrigidas na fixture.

Resultado final: **88/88 PASS em cinco arquivos, 81,51 s** (18 casos novos + 70 anteriores), com lint/TypeScript direcionados aprovados. Hashes do candidato constam no handoff desta tarefa. Casos incluem ambos os caminhos tenant/workspace, criação reservada e conversão, edição, suspensão/reativação com CAS, terceiro CNPJ sem acesso, outros workspace/papéis/privilégios, status sem alvo autorizado, recibo conhecido após suspensão, cancelamento/preparação/Auth atrasados, resultados incertos, not_found adversarial, metadata/ACL e recusa de reaplicação. A autorização de navegador via ACL/RLS integral não é inferida da contraprova service_role.

## Limites preservados

Node 24.19.0; baseline esperado 22. PGlite com dados sintéticos e schema parcial, sem duas sessões concorrentes e sem GoTrue real. Os updates de senha/email do produto continuam passando por `auth.admin.updateUserById`; o finalizador de 9a continua escrevendo diretamente em `auth.users.raw_app_meta_data`. Este delta não remove nem homologa essa superfície.

Permanecem obrigatórios: nova revisão independente; GoTrue/schema/catalog exatos e compatibilidade dos triggers/metadata; Native de duas sessões para reativação, suspensão, conversão, cancelamento e alteração de vínculos/roles; ACL/RLS integral; árvore combinada com guards operacionais 59a048bb + pós-lock a0863712 e gates de release. Nenhuma promessa de revogação de JWT/URL/upload em voo. Retenção/expurgo de recibos permanece decisão separada, sem remover barreiras. Nenhuma integração está autorizada antes da nova revisão.

O CLI inicialmente recebeu EPERM ao tentar gravar sua telemetria local durante `migration new --help`. A escalada normal de permissão foi aprovada; ajuda e criação do arquivo local concluíram. Não houve negativa de auto-review, bypass ou alteração de dependências/serviços compartilhados.
