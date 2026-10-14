# Auditoria complementar: cadastros compartilhados e preservação de acesso

## Identidade e coordenação

Fonte congelada: `driver-offline-repaired-20261013/CodexMerge`, SHA `65f4e9bd2b4786f213a862534c75b128a5f6cd94`, tree `ebb3a1b5eb14d30c1acc6222a3cb7b2147d4d22e`. Fork oficial `driver-shared-lifecycle-audit-20261013/CodexDriverLifecycle`, criado pelo coordenador com claims explícitos. Integração `50b6fe92a5501aac9588eec7b88d47dc3a21cf38` e candidatos anteriores preservados.

Esta rodada não repete a revisão dos nove fixtures já aprovada. Investiga uma hipótese nova: assimetria da proteção do vínculo entre conta criada diretamente por username e conta legada convertida para username. Usa apenas dados sintéticos, PGlite em memória e jsdom, um worker, rede bloqueada, ambiente privado excluído, sem Docker/WSL, serviços ou infraestrutura compartilhada.

## Achado confirmado — conta criada por username pode perder seu cadastro

**Prioridade proposta: alta para integridade do vínculo de acesso.** Na base, editar o cadastro e selecionar “Sem vínculo” remove `drivers.user_id` de uma conta criada pelo fluxo reservado de username. A identidade Auth e a membership ativa continuam existindo. O resultado é uma conta ativa sem o cadastro que identificava o motorista. A exclusão do cadastro sem histórico restritivo também foi aceita na fixture. Não se afirma que todo cadastro produtivo possa ser excluído: FKs de histórico podem recusar casos específicos.

Pontos do código:

- `src/pages/Drivers.tsx:775`: seletor de usuário permite `__none__` e transforma em `user_id: null`.
- `src/pages/Drivers.tsx:480`: filtro do payload não exclui `user_id`.
- `src/pages/Drivers.tsx:493`: UPDATE direto com id, tenant e revisão; CAS protege edição obsoleta, mas não impede a desvinculação deliberada de uma revisão atual.
- `supabase/migrations/20261012224659_driver_credentials_review_boundaries.sql`: `private.guard_driver_account_scope_v1()` protege a identidade OLD apenas quando `driver_workspace_managed=true`. Se a conta tem somente `driver_username_managed=true`, a mudança para NULL ultrapassa essa proteção e chega ao retorno antecipado de NEW nulo.
- A mesma migration cria `private.protect_converted_driver_registry_delete_v1()` com a mesma limitação ao marcador de conta convertida.
- `manage-driver-access/handler.ts` retorna `unlink:false` e `delete_identity:false` no contrato V3, mas o cadastro genérico segue um caminho independente.

**Prova antes do patch:** `unlink-baseline.json` contém 1 PASS / 1 FAIL: a conta convertida recusou a desvinculação; a conta recém-criada aceitou o UPDATE, fazendo falhar a expectativa de erro `42501`. O teste final preserva também uma reprodução explícita da aceitação de unlink/delete antes da proposta, com rollback da transação sintética e conferência do grafo.

**Prova da UI:** o teste jsdom executa “Editar motorista → Sem vínculo → Salvar”, confere payload `user_id:null`, filtros id/tenant/updated_at e ausência de chamada à Edge. É uma testemunha do comportamento ainda existente, não uma afirmação de correção da UI. O adaptador da UI é simulado; a aceitação/rejeição do banco é provada separadamente pelo SQL real na fixture.

Impacto no login deve ser descrito com precisão: esta prova não diz que GoTrue rejeita a senha. Ela demonstra perda do vínculo usado para resolver o cadastro operacional, enquanto Auth/membership continuam presentes. Login por username, tokens antigos e comportamento exato do aplicativo autenticado precisam da validação Native/GoTrue do mesmo candidato.

## Proposta mínima ensaiada

Arquivo `docs/qa/driver-shared-lifecycle-link-protection-proposal.sql`. **É proposta de revisão, não migration, não forward registrado e não é aplicada automaticamente ao produto.**

Amplia somente os dois predicados existentes de proteção OLD/delete para aceitar `driver_workspace_managed=true OR driver_username_managed=true`. Mantém a verificação OLD antes do retorno por NEW nulo, o lock existente, o código `42501` e todas as demais regras. Não cria memberships, não muda tenants/papéis, não escreve Auth, não altera RLS/grants/owners, não repara nem remove dados.

O SQL exige hashes exatos dos dois predecessores, preserva todos os metadados de `pg_proc` exceto `prosrc`, confere os hashes posteriores e é idempotente. Um predecessor desconhecido no segundo objeto desfaz também a alteração do primeiro no mesmo DO atômico. A ordem de implantação futura deve ser depois de `20261012224659`; nenhum manifesto foi alterado nesta rodada.

| Objeto | MD5 anterior | MD5 proposto |
| --- | --- | --- |
| `private.guard_driver_account_scope_v1()` | `ca6e0ce58e27d1e68ba2b91865b4cc3f` | `e613a1e24ffcf2a56dbb57f18ebfd9be` |
| `private.protect_converted_driver_registry_delete_v1()` | `01666daa80094722b3da5d1509764219` | `ad9e68d28632e8102aaafefa30200fcf` |

Criação reservada continua funcionando porque o vínculo OLD é NULL; edição que preserva a identidade continua permitida. Os ensaios posteriores à proposta conferem criação, rename, suspensão/reativação, ausência de novos acessos em CNPJs irmãos, preservação de Auth e recusa de role/tenant incompatíveis. Contas convertidas mantêm sua proteção anterior.

O seletor antigo da UI ainda oferece a operação. Depois de uma futura aplicação do SQL, a tentativa será recusada pelo backend, mas a experiência precisa de uma correção separada para apresentar o vínculo como somente leitura e direcionar à gestão de acesso. Não removemos a barreira SQL para acomodar o formulário.

## Funcionários compartilhados — contraprova nova

Foi estendida apenas a fixture de `employees` com as colunas necessárias para executar os corpos reais de projeção da base. Cadastro num CNPJ projeta o registro no CNPJ irmão sem copiar `user_id`, `driver_id` ou `manager_id`. Edição/suspensão/reativação do cadastro compartilha nome/status, preservando a identidade local, filial e centro de custo do registro irmão. Outra transportadora com o mesmo CPF sintético permanece intacta. Auth, roles, memberships e todos os cadastros de motorista permanecem byte-equivalentes no snapshot do teste.

Isso prova a separação entre projeção cadastral e conta no grafo parcial. Não prova permissões RLS completas de RH, constraints ausentes da fixture, alteração de pessoal atribuível a viagens nem autenticação real. Nenhum bug adicional foi demonstrado nesse ensaio.

## Execuções e limites

- Baseline: 1 PASS / 1 FAIL esperado para revelar a ausência da proteção de conta criada.
- Proposta SQL: 8 PASS / 0 FAIL, incluindo reprodução prévia, recusas, lifecycle legítimo, metadados/idempotência, rollback por predecessor divergente e funcionários compartilhados.
- Testemunha da UI: 1 PASS. Primeira tentativa falhou por ausência de `ResizeObserver` no jsdom; o shim local ao teste corrigiu somente o ambiente, sem alterar a aplicação.
- Rodada final conjunta: 9 PASS / 0 FAIL / 0 SKIP, 12,814 s. ESLint dos dois testes com `--max-warnings 0` e TypeScript direcionado: PASS. Recibos e resultados no handoff externo, com hashes dos arquivos efetivamente executados.
- Node local `24.19.0`; repetir a rodada em Node 22 antes de aceitação. Não houve suíte completa ou repetição dos 65 testes já aprovados independentemente.

## Bloqueio de empacotamento e próximos responsáveis

A chamada somente de ajuda `supabase migration new --help`, usando a CLI local `2.116.0`, falhou antes de apresentar ajuda: tentou escrever `C:/Users/Thomaz/.supabase/telemetry.json.tmp.<id>` e recebeu `EPERM`, fora da área gravável. Não houve repetição, elevação dessa chamada, troca de binário, mudança de HOME/telemetria ou criação manual de nome de migration para contornar a restrição.

A [skill Supabase](skill://plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995/supabase/SKILL.md) exige: “When you need a new migration SQL file, **always** create it with `supabase migration new <name>` first.” Por isso apenas o SQL revisável foi preparado; o coordenador precisa disponibilizar um caminho autorizado da CLI para empacotar uma migration incremental, revisar seu conteúdo e acrescentá-la ao manifesto. O SQL foi testado exclusivamente em memória; não foi aplicado em ambiente compartilhado ou produtivo.

Referências de implementação consultadas: [triggers Supabase](https://supabase.com/docs/guides/database/postgres/triggers) e [changelog](https://supabase.com/changelog). O endpoint Markdown do changelog não foi renderizado pela ferramenta; a página HTML foi consultada. O delta usa a semântica PostgreSQL já presente no projeto e não introduz API Supabase nova.

Pendentes para Native/GoTrue: conferir o grafo completo de triggers/FKs/RLS, executar UPDATE/DELETE sob os papéis reais de PostgREST e Auth, confirmar ausência de regressão no INSERT reservado e nos fluxos de conversão, ensaiar concorrência de unlink/delete contra criação/credenciais/suspensão em duas sessões, e verificar seleção de CNPJ e acesso operacional após autenticação real. Os testes em PGlite não substituem esses gates. Publicação, integração e resolução final pertencem ao coordenador; todos os candidatos anteriores continuam preservados.
