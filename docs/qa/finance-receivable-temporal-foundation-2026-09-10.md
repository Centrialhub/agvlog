# Foundation temporal dos recebíveis

Migration local `20260910195941_finance_receivable_temporal_foundation.sql`. Implementa captura, não posição histórica nem endpoint de leitura.

## Modelo e cobertura

`finance_private.receivable_temporal_coverage` registra por tenant o início explícito da cobertura, tipo existing_tenant/new_tenant e transaction_id. A baseline de tenants existentes usa um único clock_timestamp em CTE materializada, depois de obter as travas. Todos os títulos existentes recebem BASELINE completa com o mesmo instante da cobertura. Uma fonte com tenant órfão aborta a instalação, em vez de desaparecer.

`finance_private.receivable_temporal_versions` conserva event_order, tenant_id, receivable_id, operação BASELINE/INSERT/UPDATE/DELETE, OLD/NEW integrais, actor_id e actor_name, actor_kind, captured_at e transaction_id. Não tem FK ao título nem cascata de tenant; preserva tombstones e identidade da empresa caso a origem desapareça. A FK para cobertura privada mantém a cadeia interna.

actor_id é exclusivamente auth.uid da execução. Se ausente, actor_kind=system e actor_name=null: created_by do título nunca substitui o ator. authenticated não significa decisão manual; um worker pode propagar a identidade originadora. O nome é snapshot de full_name/email disponível na captura, não autoridade nem prova de autenticação.

old_payer_snapshot/new_payer_snapshot contêm somente id, tenant_id e company_name encontrado no mesmo tenant. Preservam o nome observado durante a captura, não alegam que ele vigorou em todas as datas anteriores; mudança isolada no cadastro do cliente não gera versão do título.

## Atomicidade e instalação

AFTER INSERT/UPDATE/DELETE captura todos os escritores bem-sucedidos da tabela dentro da mesma transação. Identidade tenant/id alterada é recusada. Um erro ou rollback desfaz estado e versões juntos. A sequência pode ter lacunas. TRUNCATE da origem é bloqueado para impedir exclusão sem tombstones.

A instalação trava tenants em SHARE ROW EXCLUSIVE e depois receivables em SHARE ROW EXCLUSIVE NOWAIT. SELECT permanece permitido. Se a segunda trava está ocupada, 55P03 exige retry integral: não mantém uma espera de tenants→receivables que poderia formar ciclo com escritor em ordem inversa. O teste PGlite não comprova concorrência; o ensaio nativo independente foi solicitado.

Tenant novo recebe cobertura em BEFORE INSERT e retorna NEW, antes de qualquer bootstrap AFTER que crie título. ON CONFLICT na cobertura preserva o registro original em retries/upserts de tenant existente. Falha/rollback da criação desfaz a cobertura. Não depende da ordem alfabética dos triggers AFTER existentes. A busca nas migrations encontrou seed_tracking_tenant_defaults AFTER; teste adicional instala seed AFTER adversarial e verifica a captura do título criado.

Compatibilidade a validar em mudanças futuras: a baseline de tenants possui apenas PK(id), e não foi encontrado outro BEFORE que suprima INSERT. Se for introduzido trigger que retorne NULL ou conflito ignorado por outra chave única, a cobertura BEFORE exigirá revisão para não conservar registro de um tenant que não foi inserido. Não foi acrescentado mecanismo especulativo para esse writer atualmente inexistente.

## Segurança e tempo

Tabelas privadas, funções de trigger e sequência não têm grants para anon, authenticated ou service_role. RLS de SELECT exige can_access como defesa adicional, incluindo exclusão de motorista misto; nenhum reader é concedido nesta etapa. UPDATE/DELETE/TRUNCATE da cobertura e versões são bloqueados por triggers. Inserção legítima ocorre somente pelo mecanismo de captura com privilégios internos. Como nos demais mecanismos SQL, o proprietário do banco conserva poder administrativo; não se alega proteção contra alteração maliciosa por superuser.

captured_at é horário de captura na transação, transaction_id é identidade da transação, e event_order é ordem de alocação de sequência. **Nenhum deles representa ordem de commit ou prova de visibilidade histórica.** Filtrar captured_at por um knowledge_at arbitrário não reconstrói sozinho o que outro usuário podia ver naquele instante. Baseline não certifica estados anteriores.

## Testes realizados

`npx vitest run src/test/receivableTemporalFoundation.test.ts`: **12 passaram**. ESLint passou no teste e helper.

- Baseline existente preserva valor/vencimento e não cria movimento.
- Renegociação de valor/vencimento e DELETE preservam OLD/NEW, ordem, transaction_id e nome do autor antes da alteração cadastral.
- Tenant novo e título com created_by antigo, executados sem auth.uid, permanecem atribuídos a system.
- Rollback por savepoint remove a captura; storage append-only e TRUNCATE são protegidos.
- ACL nega exposição direta e execução dos triggers aos três papéis de API; grant temporário somente na fixture permite testar RLS, inclusive motorista misto.
- Recebimento e devolução usam apply_receivable_financial_command real; snapshots refletem 10 recebidos e depois zero, preservando um pagamento original.
- Worker fiscal real cria e cancela título com actor_id null e snapshot do pagador correto.
- Alteração de tenant é recusada; bootstrap AFTER gera título já coberto.
- record_finance_unloading real preserva fornecedor e vencimento originais; replay não cria uma segunda versão/título.
- Retry de tenant INSERT ON CONFLICT preserva a cobertura original. INSERT privilegiado com snapshot sem/null id ou tenant, JSON null ou array é recusado por CHECK fail-closed.

Factory `createReceivableTemporalDatabase` em `src/test/helpers/receivableTemporalDatabase.ts` usa a cadeia de integração existente de recebíveis/fiscal. A descarga acrescenta à fixture a coluna supplier_id e instala o writer real. Não foram usados writers que apenas retornam sucesso. Ainda não é teste de toda a cadeia de migrations de produção; concorrência e espera serão verificadas pelo agente nativo.

Hashes congelados:

- SQL: `8246ff32ae6d1e95ed9b4dda8495315c08328e002266253dd2258b04a86269c3`.
- Factory: `3ae356f3adf6647305a8b179c6781c64e15415ebfc0985f6ffd484b040ce05dc`.

Nenhuma aplicação remota ou TSC nesta subtarefa. Próximas etapas: política de corte econômico/conhecimento, continuidade verificável da captura e reader histórico que respeite a cobertura; nenhuma API de posição atual foi reutilizada como as_of passado.

Verificação posterior do coordenador: npm run typecheck, sessão49960, concluiu com saída0 e nenhum diagnóstico. Não houve aplicação remota.
