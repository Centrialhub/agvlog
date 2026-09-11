# Associação de recebimentos legados a entradas existentes

Core local: `20260910145616_finance_legacy_receipt_associations.sql`, criada pela CLI. Nenhuma aplicação remota ou execução bancária. Consulta `45659` e complemento da trilha do movimento `50338` pertencem ao root; UI e ensaio nativo são frentes independentes.

## Decisão estrutural

O vínculo canônico `finance_receivable_movement_links` exige command_id e bank_transaction_id com FKs para o comando financeiro. Um recebimento antigo pode não ter esses IDs. Criar comando fictício ou modificar o recebimento apagaria essa diferença; por isso a associação usa `finance_legacy_receipt_movement_links` e `finance_legacy_receipt_link_reversals`, ambas append-only, com RLS e sem DML direto de browser/service-role.

Link: id, tenant_id, payment_id, receivable_id, movement_id, amount_cents, created_by, actor_name, reason, source_snapshot, created_at. Reversal: id, tenant_id, link_id, created_by, actor_name, reason, created_at. Uma associação ativa por payment é imposta sob finance lock; reversão permite nova associação e mantém todo histórico. Histórico canônico receive nunca é convertido em associação legada.

## Contrato dos comandos

`associate_finance_legacy_receivable_payment({_payload:{version:1,tenant_id,request_id,payment_id,movement_id,revision,reason,existing_receipt_confirmed:true}})`.

Revision obrigatória de 32 hex vem de `legacy_receivable_source_revision(tenant,payment)` e da consulta dedicada. Motivo 10–2000 caracteres, versão numérica e declaração boolean JSON exatamente true. Não aceitar campos extras ou total informado pelo cliente. Declaração significa que o usuário conferiu o recebimento existente integral contra a entrada escolhida; não atesta banco, autenticidade de arquivo ou conciliação.

Retorno: version, tenant_id, request_id, payment_id, receivable_id, movement_id, link_id, amount_cents string, bank_transaction_id UUID|null, origin legacy_adoption, cash_created false, payment_created false, confirmed true.

`reverse_finance_legacy_receivable_association({_payload:{version:1,tenant_id,request_id,link_id,reason}})` retorna version, tenant_id, request_id, link_id, payment_id, receivable_id, movement_id, reversal_id, released_cents string, origin legacy_adoption, cash_changed false, payment_changed false, confirmed true.

Helpers privados revogados para browser: `legacy_receivable_payment_issue` (text|null), `legacy_receivable_source_revision` (text) e `receipt_movement_used_cents` (numeric inteiro). A consulta de UI é `get_finance_legacy_receivable_association`, migration separada do root.

Ator é derivado da sessão. Ordem fiscal → finance → grafo do recebível → payment → banco legado; autorização é revalidada após esperas. Replay pelo mesmo ator/ação/payload retorna resultado original sem criar segundo vínculo/evento. Revisão divergente após locks retorna `finance_legacy_receipt_changed` 40001 antes de escrever.

## Elegibilidade e fonte preservada

Recebimento/título/conta pertencem ao tenant. Valor positivo, finito, em centavos integrais até 99999999999999; data finita. Entrada existente tem direction in e natureza receipt/customer_advance/other, mesma conta e dia de São Paulo. Reserva integral do recebimento; uma entrada maior pode comportar outros recebimentos até sua capacidade.

Se bank_transaction_id existe, exige fonte credit com mesmo tenant/conta/valor/dia. Null é preservado e não preenchido artificialmente. Outro recebimento, pagamento de pagável, devolução ou vínculo canônico usando o mesmo banco legado é ambíguo e bloqueado. Projeção de carga pode ser alias da mesma origem somente quando receivable_payment_id aponta exatamente para este payment e conta/valor/dia coincidem; não deduzir alias por valor/data. Projeções de carga entram na revision e no snapshot. Aliases divergentes precisam revisão.

Revision inclui payment, título, banco, projeções de carga, devoluções, créditos fiscais e correções. Alterar uma dessas fontes entre preview e comando exige nova revisão. Source snapshot guarda payment/título/banco/projeções, revision e existing_receipt_confirmed true, além da autoria permanente do vínculo. Movimentos, recebimento, título, recibos e histórico bancário não são atualizados. Novos guards preservam pagamento/banco adotados contra UPDATE/DELETE, inclusive depois de reverter associação.

## Capacidade e correções

O novo contador soma alocações canônicas receive ainda não corrigidas mais associações legadas ativas. `project_receivable_command` e `receipt_movement_options` foram alterados de forma restrita para consumir esse contador. Guards de INSERT nas duas tabelas impõem a mesma capacidade e exclusividade por payment. Counter retorna inteiro sem escala decimal para o contrato de centavos.

Devolução real não libera a capacidade da entrada original: dinheiro saiu por outro movimento. A reversão da associação libera apenas sua reserva, sem zerar recebido ou apagar o pagamento. Correção canônica de alocação continua retirando a baixa do título e liberando sua reserva canônica; é ação diferente e recusa explicitamente um recebimento com associação legada (`finance_legacy_receipt_requires_association_reversal`). Nunca usa correção canônica para desfazer só a adoção.

Inventário deixa de mostrar o payment ID com associação ativa e o mostra novamente depois de sua reversão. Não marca adoção global concluída. A trilha canônica de movimento não foi adulterada para inventar command IDs; o root implementou apresentação adicional das associações em migration própria.

Eventos manuais: `legacy_receivable_associated` e `legacy_receivable_association_reversed`, incluídos no filtro de auditoria manual.

## Erros específicos

`finance_legacy_receipt_not_found`, `finance_legacy_receivable_not_found`, `finance_legacy_receipt_amount_invalid`, `finance_legacy_receipt_date_invalid`, `finance_legacy_receipt_account_invalid`, `finance_legacy_receipt_not_eligible`, `finance_legacy_receipt_already_associated`, `finance_legacy_receipt_bank_mismatch`, `finance_legacy_receipt_bank_ambiguous`, `finance_legacy_receipt_changed` (40001), `finance_receipt_movement_incompatible`, `finance_receipt_movement_capacity_exceeded`, `finance_receipt_already_linked`, `finance_legacy_receipt_link_mismatch`, `finance_legacy_receipt_association_not_found`, `finance_legacy_receipt_association_already_reversed`, `finance_invalid_receipt_declaration`, `finance_legacy_receipt_requires_association_reversal`, `finance_receipt_source_concurrent_change` (40001), `finance_adopted_receipt_immutable`, `finance_adopted_receipt_bank_immutable`. Autorização/payload/replay seguem os erros do núcleo financeiro.

## Verificação e limitações

- `src/test/financeLegacyReceivableAssociations.test.ts`: 9 testes SQL passaram: fonte intacta, replay, reversão/reassociação, declaração/revisão, capacidade/compatibilidade, imutabilidade, alias exato/divergente de carga, perfil misto/tenant, bank mismatch, rollback de auditoria e separação da correção canônica.
- Helper compartilhado `legacyReceivableAssociationDatabase.ts` usa cadeia operacional/fiscal/recebíveis real e acrescenta dependências de inventário. Para inserir exclusivamente dados históricos de teste, `withLegacyReceiptSeed` desativa só guard_receivable_payment_history, executa constraints diferidas e restaura o guard antes dos comandos. Nenhum guard fica desligado durante associação; não é capacidade de produto.
- Ensaio independente do agente de validação: 10 testes PG17 reais passaram, incluindo disputa em ambas as ordens com receive real, duas origens por capacidade, replay, revisão alterada/revogação durante espera, refund real preservando reserva e correção canônica real liberando reserva. Cluster descartável encerrado.
- Hash SQL nativo final: `c0f2ba253350a39f0c8ec117df2f4883ad655fff1e0c65eeddac486fe6fa8848`.
- ESLint dos testes/helper: exit0. TypeScript e bateria integrada são executados pelo root para a integração de UI/consulta/trilha.

Sem declaração de fechamento, saldo certificado, adoção total, regularização de todas as fontes fiscais ou teste remoto. A origem continua identificada como associação manual de dado antigo.
