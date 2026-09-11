# Guardas de referências financeiras a movimentos ativos — 10/09/2026

Migration CLI `20260910183506_finance_active_movement_financial_guards.sql`, SHA256 `130bc344d89633f918fefb977dd4d7d2a3a1769e3eaa4bf0bd6ff0079480dfaf`. Implementação local; sem comando público de void e sem aplicação remota.

## Contrato

- `movement_is_active(tenant,id)`: existência na empresa e ausência de finance_movement_voids.
- `assert_active_movement_reference(tenant,id)`: acesso financeiro, tentativa de advisory finance sem espera após row lock, reautorização e validação exata do ID. Erros finance_access_denied, finance_movement_use_busy (40001), finance_movement_reference_invalid e finance_movement_voided (23514).
- `available_movement_cents(tenant,id,direction)`: zero para movimento ausente/void/incompatível/transferência; usa o contador vigente de reservas para a direção correta; capacidade inconsistente exige revisão. Não altera `movement_used_cents` nem `receipt_movement_used_cents`.

Todos os helpers privados ficam sem grant de aplicação. Triggers BEFORE INSERT/UPDATE cobrem finance_expense_allocations, finance_payable_movement_links, finance_settlement_movement_links, finance_receivable_movement_links e finance_legacy_receipt_movement_links. UPDATE valida OLD e NEW. Pagamentos payables_payments, driver_settlement_payments e receivables_payments têm guarda imediata e diferida: o pagamento pode preceder o link em comandos legítimos, mas o grafo final também é verificado. Aliases por bank_transaction_id são resolvidos pelos vínculos exatos, inclusive quando apontam ao movimento de outro pagamento.

A ordem efetiva de pg_trigger foi consultada e testada: os guards a_finance_active_* precedem os guards BEFORE INSERT existentes nas oito tabelas da fixture de saída. A prova nativa de disputa row-first ainda é necessária; prefixo por si só não substitui essa prova no schema completo.

## Versões e histórico

Leitura e instalação das versões finais pertinentes: movement_used_cents132411; check_movement_use43833; check_settlement_movement_link30540 com patch32411; receipt_movement_used_cents e check_receipt_movement_capacity45616; apply_payable_movement03529/43833; project_receivable_command024438 com correção025658/refund030634/integração45616. Os catálogos efetivos `finance-active-movement-outgoing-effective-2026-09-10.json` e `finance-active-movement-incoming-effective-2026-09-10.json` exportam pg_get_functiondef, SHA256 e triggers instalados.

Reservas históricas e active_payable_payments não mudam. Void não transforma pagamento real em dívida aberta, não libera reserva histórica e não remove recebimento. A capacidade disponível é zero, mas o contador usado conserva a composição original. Nenhum leitor histórico foi substituído por active_movements.

## Validação

11 testes PGlite passaram (financeActiveMovementFinancialGuards7, financeActiveReceiptMovementGuards4); ESLint passou. Escritores reais de lote, pagamento de título, associação de acerto e recebimento/fiscal foram executados. Recebimento ativo permanece autorizado; void causa rollback de projeção, pagamento e bank_transaction. Testes também cobrem associação de recebimento legado, alias bancário de outro pagamento, atualização do grafo ao final da transação, perfil misto, identidade inexistente, e histórico pago que permanece pago.

Factory própria `createActiveMovementFinancialDatabase(domain)` usa duas cadeias reais: outgoing de legacyPayableAssociationDatabase e incoming de legacyReceivableAssociationDatabase. O stand-in permissivo is_tenant_admin herdado da antiga fixture outgoing foi substituído pela definição real do baseline. Não foram introduzidos stubs de função que devolvem sucesso. Algumas tabelas de famílias não exercitadas usam DDL real sem FKs externas; isto não é instalação global de produção.

Voids são estado histórico semeado diretamente para testar referências; ainda não existe comando público autorizado de invalidação. O teste que semeia void depois de pagamento previamente confirmado é teste de preservação histórica, não afirma que esse void deva ser permitido pelo comando futuro. Injeção de void após link no mesmo transaction é detectada pelo guard diferido de pagamento.

## Pendências explícitas

O helper available ainda não é consumido por todas as opções atuais; root está migrando candidatos em etapa própria. Reconciliação/automação, abertura/períodos/snapshots, transferências, aliases operacionais adicionais, void INSERT e prova de origem/ciclos/dependências pertencem às outras frentes. Esta migration isolada não declara readiness do comando de correção. A cadeia mais recente do comando de novo pagamento de acerto/cutoff não está integralmente instalada nesta fixture; associação histórica de pagamento de acerto foi executada. Regressão nativa e aplicação integral continuam necessárias antes de habilitar correção.
