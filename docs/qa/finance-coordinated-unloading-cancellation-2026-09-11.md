# Cancelamento coordenado da mesma descarga — prova local

Migração CLI20260911053349_finance_coordinated_unloading_cancellation.sql. SHA256 fb5092783ca917b2adf4605bc754f59455630b248f813987a94a4cebb2308f36. Sem aplicação remota por este agente.

## Efeitos e identidades

Cancela explicitamente três efeitos distintos em uma transação: custo canônico via finance_expense_cancellations; obrigação aberta exata via statuscancelled do payable; direito de cobrança via amendment cancel_origin da mesma charge. Não cria nova descarga, novo gasto, movimento, pagamento ou devolução. Linha original do custo e charge ficam imutáveis. Nominal do título é preservado; statuscancelled e versão econômica zero representam cancelamento, não recebimento.

Pode cancelar custo150/payable150 e cobrança120 previamente alterada por comando auditado: os valores são confirmados separadamente. Fornecedor da cobrança e beneficiário do gasto não são presumidos iguais. Contexto do payable reutiliza prova payee_type do batch original e checks de origem/valor/status.

## Contratos públicos

preview_finance_unloading_cancellation(_tenant_id,_charge_id,_effective_on) retorna DTO v1: tenant/actor/charge/expense/payable IDs, dia, resolver original/efetivo, custo e beneficiário, blockersIDs, eligible/can_cancel/can_execute, revisão do grafo inteiro, três efeitos prospectivos e histórico do evento coordenador. _evidence nunca sai do wrapper.

cancel_finance_unloading(_payload) recebe version1,tenant_id,request_id,charge_id,effective_on,revision,reason. Resultado contém todos IDs permanentes, expense_cancellation_id/origin_amendment_id, três valores removidos e cash_changedfalse. Cada filho usa requestID determinístico distinto derivado do pedido pai; replay do pai exige ator e payload exatos depois de reautorização.

## Proteção e atomicidade

Não modifica cancel_expense nem seu bloqueio público para unloading. Cria cópias privadas dos corpos revisados, guardadas por hash, ACL e search_path do predecessor. O contexto privado específico troca exclusivamente a rejeição genérica de unloading pela exigência dessa origem; preserva todos outros blockers. O writer privado de custo exige ticket exato txid/tenant/ator/request/charge/expense/payload e consumo único. Não existe grant da tabela/ticket/helper bruto/costwriter a authenticated ou service_role; não usa GUC como bypass.

Coordenador exige can_repair_unloading (admin/owner e acesso financeiro ativo), serializa fiscal→finance, trava vínculo atual e perfilmotorista, reautoriza antes do replay. Trava grafo do título, folha, viagem, acertos, custo e payable; child writers revalidam revisões e OLD/NEW de fechamento. Falha de qualquer filho ou evento pai reverte ambos os efeitos e ticket. Estado histórico monetário, alocações, associações, obrigações, folha e materialização de custo no acerto bloqueiam, com IDs no contexto. Períodos protegidos seguem guardas existentes.

Evento unloading_cancelled_coordinated entra no filtro manual de auditoria, além dos eventos filhos expense_cancelled/unloading_origin_corrected. Custo ativo usa a visão e projeção de cancelamento75641 já existente, portanto não exige redefinir baseline monetário nem receita antiga de KPI.

## Provas

coordinatedUnloadingCancellation.test.ts: **7 PGlite passaram02:51:46; lint0**. Public RPCs validadas com unloadingCancellationPreviewSchema e ResultSchema reais. Batch/descarga e recebimento canônico reais. Positivo150/150/150, linhas originais preservadas, KPIreal15000→0, active_expense_items0, movimento0, ticket0 e constraints diferidas. Sequência cobrança150→120 e cancelamento conjunto150/150/120. Replay idêntico. Falha de auditoria pai restaura cobrança/custo/payable e permite nova prévia válida. Nenhum ticket residual. Tentativa de chamar filho sem ticket55000, genericcancel continua bloqueado, stale40001, empresa/perfilmisto42501. Paidstatus inconsistente e materialização do custo bloqueiam. Recebimento real1000 impede cancelamento e conserva dinheiro/custo.

Fixture combina cadeia real de banco/recebíveis com DDL real das associações consultadas e funções reais de cancelamento/KPI. FK de pais operacionais não carregados foi omitida somente das tabelas vazias de inventário; nenhum writer/guard/builder de sucesso foi simulado. Materialização negativa é registro explícito de dependência, não alegação de execução do builder nessa suíte; o builder real com snapshot150 preservado após cobrança120 foi exercitado separadamente em unloadingOriginAmendments7casos. Sem ensaio de concorrência nativa, browser/AuthSupabase completo ou emissões fiscais.

## Próximos casos ainda não resolvidos

Alteração positiva do custo e da dívida exige cadeia efetiva e consumidores compartilhados, não se resolve por este cancelamento. Cobrança já cancelada isoladamente permanece bloqueada neste coordenador (histórico e valores continuam visíveis), pois exige vincular explicitamente evento anterior sem produzir nova perna de retirada. Histórias com dinheiro já pago/recebido não são liberadas por net0: precisam procedimento auditado próprio de regularização. Esses casos continuam no objetivo integral.

## Revalidação de guardas finais

Fixture ampliada após revisão: inclui os triggers finais de payroll/settlement/obligation/advance75641 e o patch real de pg_try_advisory_xact_lock81257. Prefixo anterior já instalava guardas de payable/payment/allocation/legacy/claims e imutabilidade do evento. Ensaio adicional verifica catálogo de triggers ativos e corpo trylock, rejeita INSERT de novo pagamento55000, alocação contra movimento real55000 e exclusão do evento55000. Nenhum pagamento/alocação residual. Preview público é verificado sem _evidence antes do parser, sem remover o campo no teste. SQL53349 e SHA congelado permanecem inalterados.

## Cancelamento coordenado aplicado em produção — 11/09

Migração local20260911053349 SHAfb5092783ca917b2adf4605bc754f59455630b248f813987a94a4cebb2308f36 aplicada sob versão remota20260911055234. Verificação posterior: comando authenticated=true, anon=false, writer privado authenticated=false, tickets0, movementready=true e periodready=true. Nenhum cancelamento de dado do cliente foi executado nesta implantação. 7 testes SQL reais com guardas finais e trylock; 33 testes UI/contrato/entrada; lint, TypeScript e buildcheck aprovados. Cancelamento com dinheiro ou materialização permanece bloqueado; extensão para cobrança já cancelada é trabalho local separado54915, fora desta entrega. QA autenticada ponta a ponta ainda pendente; nenhum documento fiscal emitido.
