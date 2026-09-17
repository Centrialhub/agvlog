# Ativação final por EMPRESA — artefato local desarmado

2026-09-11. Não aplicado em MAINDB; não ativa produção automaticamente. Sem PG nativo, TSC, Sites ou emissão fiscal.

## Artefatos

- Criado via CLI e movido de migrations para rollouts: `supabase/rollouts/20260911030716_finance_active_company_final_activation.sql`.
- SHA256 desarmado: `0a956f979cdd2ede8db9f8848a0ace5e32156b87c0b7868b65a05ee7f5df9338`.
- SELECT do catálogo: `docs/qa/finance-final-activation-catalog-checkpoint.sql`, SHA256 `a572db67004ba49bbdf1ad68ce5d6f10e7ff4bc5ae5fc113f673b4d1d95b38e5`.
- SELECT de escopo/políticas/gates: `docs/qa/finance-final-activation-scope-preflight.sql`.
- Teste: `src/test/financeFinalActivation.test.ts`.

O rollout contém `__FINAL_REVIEWED_CATALOG_REQUIRED__` e falha antes de qualquer alteração. Nenhum valor de JWT, GUC ou payload permite autorizar a ativação. Somente o coordenador, após revisão do checkpoint final, poderá preencher esse literal com o hash aprovado e revisar novamente o artefato resultante. Não substituir pelo hash de uma fixture ou por leitura automática seguida de aplicação sem revisão.

## Critérios obrigatórios antes de armar

1. Toda a cadeia financeira restante aplicada e catálogo efetivo revisado, incluindo compatibilidades de 192908, guards de composição/fechamento, boundaries25149/25214/25737/30051 e correção220847 após211800. Ausência de RPCs/guards não é resolvida por um hash: o hash detecta deriva após a revisão, não comprova completude ou qualidade.
2. Conferir o corpo staged exato ` select false; `, SQL/STABLE/SECURITY DEFINER, retorno boolean, argumento `_tenant`, search_path vazio e grants somente owner/authenticated/service_role. O rollout rejeita outra variante mesmo se alguém lhe fornecer um hash de catálogo correspondente.
3. Conferir a cadeia de autenticação efetiva: `request_tenant_id` exige claim ativo assinado para authenticated e igualdade com header; `is_request_tenant_member` une seleção e vínculo atual. O corpo a ativar deriva de224136: exige claim não vazio, vínculo interno atual, nenhuma identidade motorista ativa. Workspace não substitui tenant da EMPRESA.
4. Revisar todos os targets/exclusões do SELECT de escopo. Tabelas novas financeiras precisam `tenant_id uuid`; objetos sem essa coluna ficam listados como exclusões a justificar. As políticas restritivas não concedem permissões novas nem substituem guards dos RPCs SECURITY DEFINER.
5. Confirmar cron/queues fiscais e de conciliação ainda pausados conforme rollout. Este artefato não agenda nem habilita jobs. Eventual retomada requer decisão separada após ativação e smoke checks.
6. Capturar o hash do catálogo somente após os passos acima, sem DDL concorrente; qualquer mudança de funções/ACLs, triggers, policies, tabelas/colunas/defaults, constraints, índices, views ou schemas cobertos altera o fingerprint e impede usar o checkpoint antigo.
7. Aplicar futuramente como uma única transação. Falha de contrato/lock/DDL desfaz políticas e mantém gate fechado. `lock_timeout=3s`; não insistir em execução parcial.

## Escopo de alteração

Uma nova política restrictive ALL authenticated por tabela financeira selecionada chama `finance_private.can_access(tenant_id)` em USING e WITH CHECK. Preserva policies/grants existentes. Abrange finance_*, bank_*, financial_*, payables/payable_*, receivables/receivable_*, despesas/acertos, folha, criação/revisão/ajustes de despesas, faturas e fechamentos, employee_advances, load_payments e load_unloading_charges.

Não modifica tabelas SSX, memberships, drivers, empresas, clientes, estoque operacional ou ACLs de workers. A inspeção do catálogo inclui schemas compartilhados para detectar alterações concorrentes, mas não os reescreve. Não instala políticas em tabelas privadas. Service-role/owner continuam sujeitos às suas políticas próprias; não se exige JWT de usuário em workers por esta política autenticada.

A troca do gate preserva OID e ACL. Nenhum valor, saldo, registro, snapshot, comando ou pagamento é inserido/alterado pelo rollout.

## Evidência

5 testes PGlite passaram em00:11:43, duração6,92s; ESLint passou. O teste substitui o sentinel apenas numa cópia em memória usando catálogo da fixture conhecida, não edita o artefato desarmado.

- Artefato original rejeitado; catálogo mudado rejeitado antes de políticas/gate.
- Mesmo usuário nas duas empresas: SET ROLE authenticated vê somente contas da empresa selecionada; trocar claim/header troca conjunto; INSERT em outra empresa negado por WITH CHECK.
- Claim ausente retorna zero linhas; claim/header divergentes negados; membership inativa e motorista misto por role ou drivers negados.
- Movimento real registrado na empresa correta; replay sob empresa diferente negado, um registro preservado.
- Tabela SSX sentinela preserva RLS/ACL sem mudanças; gate com corpo diferente é rejeitado mesmo com hash da fixture recalculado.

Limites: fixture financeira mínima, não prova cadeia inteira MAINDB, token criptográfico hospedado, browser, nem concorrência PostgreSQL nativa. Nenhuma autorização de produção inferida dos cinco testes.
