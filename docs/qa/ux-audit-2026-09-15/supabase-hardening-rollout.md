# Rollout seguro de endurecimento do Supabase

Data do baseline: 2026-09-15 18:40 UTC  
Projeto consultado: `PROJETO AGV LOG` (`qcvnsdrbcchaxvawcngk`)  
Escopo: advisors e catálogos PostgreSQL, somente leitura remota. Nenhum DDL,
DML, revoke, publicação ou alteração de configuração foi aplicado.

## Regras de segurança do rollout

1. Não aceitar grants implícitos para objetos novos. Funções devem nascer com
   ACL explícita e somente as roles necessárias recebem `EXECUTE`.
2. Toda tabela em schema exposto pela Data API deve ter RLS. Views expostas
   precisam usar `security_invoker=true` ou sair da superfície exposta.
3. `SECURITY DEFINER` só é aceita com `search_path=''`, referências a objetos
   schema-qualified e uma verificação explícita de `auth.uid()` ou helper de
   autenticação revisado e documentado.
4. Grants de `EXECUTE` são nominativos e constam em allowlist versionada.
5. Em RLS, chamadas invariantes como `auth.uid()` devem usar
   `(select auth.uid())` para gerar initPlan.
6. Nunca executar `REVOKE EXECUTE ... FROM authenticated` em massa. Primeiro
   inventário, telemetria de uso, canário, testes por perfil e rollback.

## Evidência ao vivo

Os Security e Performance Advisors foram atualizados no projeto saudável,
PostgreSQL 17.6.1. Os achados observados foram:

| Achado | Nível | Contagem | Classificação |
|---|---:|---:|---|
| RLS habilitada sem policy | INFO | 45 | Intencional, com allowlist |
| `SECURITY DEFINER` public executável por `authenticated` | WARN | 187 | Exige inventário/canário |
| Proteção de senha vazada desabilitada | WARN | 1 | Ação segura imediata |
| Opções de MFA insuficientes | WARN | 1 | Exige fluxo de produto |
| `auth.*` sem initPlan em RLS | WARN | 16 | Migração de baixo risco |
| Múltiplas policies permissivas | WARN | 19 | Exige decisão semântica/migração |

Links oficiais:

- [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [SECURITY DEFINER executável por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [MFA do aplicativo](https://supabase.com/docs/guides/auth/auth-mfa)
- [Auth initPlan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
- [Múltiplas policies permissivas](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)

## Classificação dos achados

### Ação segura imediata

#### Leaked-password protection

Habilitar no painel de Auth, se o plano suportar, e validar login, cadastro,
convite e redefinição de senha. A proteção rejeita senhas presentes no corpus
Have I Been Pwned. Não requer migração SQL e não altera hashes existentes.

Critérios de aceite:

- senha comprometida é rejeitada com mensagem útil;
- senha forte continua aceita;
- login e reset não entram em loop;
- o Security Advisor deixa de emitir `auth_leaked_password_protection`.

#### Controles preventivos no repositório

- executar o script de preflight em CI/staging;
- versionar allowlists de RPC, tabelas deny-by-default e exceções de extensão;
- falhar revisão quando uma função nova depender de `PUBLIC EXECUTE`, quando
  uma tabela exposta não tiver RLS ou quando um novo `SECURITY DEFINER` não
  tiver `search_path=''`;
- definir default privileges seguros em uma migração futura, após confirmar
  todos os owners que criam funções. Não alterar defaults remotamente nesta fase.

### Intencional, mas precisa ser documentado

#### 45 tabelas com RLS sem policy

Distribuição do Advisor:

- `finance_private`: 19;
- `payable_xml_private`: 3;
- `private`: 5;
- `public`: 11;
- `secure_upload_private`: 7.

O cruzamento de privilégios não encontrou acesso DML efetivo de `anon` ou
`authenticated` nesses 45 objetos. Os 11 objetos `public` também estão fechados
para essas roles; o acesso observado é de backend/service role quando aplicável.
Portanto, RLS sem policy atua como deny-by-default e não deve receber uma policy
genérica apenas para silenciar o Advisor.

O catálogo encontrou 69 tabelas no total nessa condição. A diferença inclui
objetos gerenciados da plataforma; os sete com privilégios externos efetivos
eram `realtime.messages` e tabelas internas de `storage`. Não devem entrar em
migrações da aplicação.

Antes de manter uma tabela na allowlist, registrar owner, escritor autorizado,
leitor autorizado, schema exposto ou não, mecanismo de acesso e teste negativo
para `anon`/`authenticated`.

#### Exceções de extensão e helpers anônimos

O catálogo encontrou três overloads de `extensions.st_estimatedextent` sem
`search_path` próprio; são objetos gerenciados pelo PostGIS e devem ser tratados
como exceção de extensão, não alterados pela aplicação.

Três helpers privados têm `EXECUTE` explícito para `anon` e `search_path=''`:

- `finance_private.can_read_receipt(text)`;
- `finance_private.not_driver(uuid)`;
- `secure_upload_private.can_read_derivative(text)`.

Provavelmente sustentam policies de Storage/entrega. Manter provisoriamente como
intencionais; confirmar o call graph e os schemas expostos antes de qualquer
revogação.

### Exige janela ou migração

#### MFA

O Advisor acusa `auth_insufficient_mfa_options`. MFA não deve ser simplesmente
forçada no painel: a documentação exige enrollment, unenrollment, challenge e
verify no aplicativo, além de tratamento de `aal1`/`aal2`.

Rollout recomendado:

1. implementar TOTP opcional em ambiente de teste;
2. adicionar recuperação/suporte e pelo menos dois administradores com fatores;
3. ativar para um grupo canário;
4. medir falhas de login e recuperação;
5. somente depois avaliar policy restritiva por `aal2` para ações críticas.

Não exigir MFA na organização sem comunicar previamente: usuários sem fator
podem perder acesso imediatamente.

#### 16 policies sem initPlan

As mudanças são mecanicamente pequenas e preservam a decisão de autorização:
trocar `auth.uid()` por `(select auth.uid())` em `USING` e `WITH CHECK`. Mesmo
assim, são DDL e devem passar por branch/staging e testes RLS.

Alvos:

- Fechamentos: `closing_report_charge_claims`, `closing_report_history`,
  `closing_report_items`, `closing_report_payments`,
  `closing_report_sequences`, `closing_report_summary_lines`, `closing_reports`;
- Entregas: `delivery_attempts`, `delivery_document_corrections`,
  `delivery_document_metadata_audits`, `delivery_document_outcomes`,
  `delivery_document_references`, `delivery_receipt_documents`,
  `delivery_receipts`;
- Outros: `operator_command_ledger`,
  `driver_app_observability_snapshots`.

Em policies com subquery correlacionada, envolver somente `auth.uid()`; não
envolver funções cujo resultado depende da linha.

#### 19 sobreposições de policies permissivas

Não consolidar automaticamente. Policies permissivas são combinadas com `OR`;
uma policy ampla pode neutralizar condições de outra.

Prioridade crítica de revisão:

- `driver_settlements`: `agvlog_select_authenticated` permite operador/admin,
  enquanto `settlements_select` também exige tenant de request, acesso financeiro
  e autorização de carga. Pela semântica OR, a regra ampla pode tornar as
  verificações adicionais irrelevantes.
- `geofences`: policies genéricas coexistem com regras que verificam tenant da
  request e membership. Confirmar qual conjunto é a autoridade desejada.
- `client_invoices`, `client_invoice_details`, `client_invoice_charges`: leitura
  para qualquer membro coexiste com leitura para operador. Confirmar se membros
  não operadores devem ver faturamento.

Consolidação que tende a preservar comportamento, após testes:

- branches legitimamente alternativas, como motorista atribuído **ou** operador,
  podem virar uma única policy com expressão `(driver_branch) OR
  (operator_branch)`;
- `driver_app_observability_snapshots` segue o mesmo padrão self **ou** operador;
- nas tabelas `workspace_*`, a policy `ALL` de admin também participa do SELECT
  junto da policy de membro. Dividir admin em policies de escrita e manter uma
  policy SELECT única evita sobreposição sem reduzir direitos.

Inventário completo afetado: `client_invoice_charges`, `client_invoice_details`,
`client_invoices`, `delivery_document_references`,
`delivery_receipt_documents`, `delivery_receipts`,
`driver_app_observability_snapshots`, `driver_settlements`, `geofences`,
`workspace_parties`, `workspace_party_tenant_links`, `workspace_people`,
`workspace_person_tenant_links`, `workspace_ssx_accounts`,
`workspace_vehicle_tenant_links`, `workspace_vehicles`.

#### 187 RPCs SECURITY DEFINER

As 187 funções `public` têm `EXECUTE` explícito para `authenticated`; nenhuma
depende de grant para `PUBLIC`. Todas têm `search_path` configurado, distribuído
assim:

- 117 com `search_path=''`;
- 69 com `search_path=public`;
- 1 com `search_path=pg_catalog, public, private`.

Isso mostra uma superfície RPC deliberada, mas não prova que cada grant ainda é
necessário. As 70 funções sem `search_path=''` precisam de migração individual:
schema-qualificar referências internas, fixar `search_path=''`, testar com o
mesmo JWT e só então substituir a função.

Para cada uma das 187, a allowlist deve registrar:

- assinatura completa e owner;
- roles com `EXECUTE`;
- telas/jobs chamadores;
- leitura ou escrita;
- verificação direta de `auth.uid()` e tenant, ou helper auditado;
- idempotência e trilha de auditoria;
- testes positivos e negativos por role/tenant.

Funções ausentes do inventário ou da telemetria não devem ser revogadas de uma
vez. Revogar uma assinatura por migração canário, observar erros e manter SQL de
rollback que restaura somente o grant daquela assinatura.

## Sequência de rollout

### Fase 0 — baseline

1. Rodar `supabase-hardening-preflight.sql` em produção somente leitura.
2. Exportar resultados sem dados de negócio.
3. Atualizar os dois Advisors e guardar contagens/timestamps.
4. Congelar allowlists de RLS e RPC para comparação.

### Fase 1 — Auth de baixo risco

1. Habilitar leaked-password protection.
2. Executar smoke de login/cadastro/reset.
3. Preparar MFA opcional; não impor `aal2` ainda.

### Fase 2 — initPlan

1. Gerar migração somente para as 16 policies listadas.
2. Validar texto anterior e posterior de cada policy.
3. Rodar matriz anon/authenticated, operador/admin/motorista e tenant cruzado.
4. Comparar resultados e planos; publicar em janela curta.
5. Reexecutar Performance Advisor; esperado: zero nesses 16 alvos.

### Fase 3 — policies permissivas

1. Começar por `driver_settlements`, `geofences` e invoices.
2. Definir a matriz de acesso esperada com o responsável funcional.
3. Consolidar em staging preservando ou, quando deliberado, restringindo ORs.
4. Testar cross-tenant e perfis negativos antes da produção.
5. Migrar uma família por janela; rollback restaura as policies capturadas no
   baseline.

### Fase 4 — RPC

1. Completar allowlist das 187 assinaturas.
2. Migrar primeiro as 70 com search path não vazio.
3. Para RPC aparentemente sem uso, coletar telemetria e aplicar revogação
   unitária em canário.
4. Nunca usar revoke em massa por schema ou role.

### Fase 5 — MFA e fechamento

1. Liberar enrollment/challenge TOTP para canário.
2. Validar recuperação e sessões existentes.
3. Definir onde `aal2` será obrigatório.
4. Reexecutar preflight e Advisors. Comparar com o baseline, documentando toda
   exceção remanescente.

## Gates de aprovação e rollback

- Nenhuma migração segue se ampliar o conjunto de linhas visíveis.
- Testes negativos cross-tenant são obrigatórios.
- Toda alteração de policy preserva uma cópia exata de `roles`, `cmd`, `USING`
  e `WITH CHECK` anteriores para rollback.
- Toda alteração de função preserva assinatura e grant anterior.
- Erros 401/403, falhas RPC ou aumento de latência suspendem a onda.
- RLS sem policy não é “corrigida” com `USING (true)`.
- Objetos de `storage`, `realtime` e `extensions` não entram em migração da
  aplicação sem orientação específica do Supabase.

## Fora do escopo

Nenhum arquivo ou fluxo de OperationsCenter ou BankReconciliation foi lido ou
alterado nesta atividade. Não houve publicação, Sites, emissão fiscal, DDL ou
DML remoto.
