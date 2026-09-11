# Corte legado: integração dos acertos de motorista

Migration CLI local `20260910170213_finance_legacy_cut_settlement_mapping.sql`, SHA256 **2641e645cc06ec82195173094c88e7a67402bb9cc18a6b6de4f112a37388cd63**. Preserva B163116 e seu hash já ensaiado nativamente; amplia classificador para versão2.

**9 testes PGlite reais passaram** em `financeLegacyCutSettlementMapping.test.ts`. Rodada integrada anterior passou27 casos entre acerto/corte, fechamento completo, guards e composição tardia. ESLint dos arquivos editados sem avisos. Nenhuma operação remota ou servidor nativo iniciado nesta ampliação.

A cadeia exige payment→um único link ativo→settlement exato no tenant→driver real do tenant→movimento de saída, sem transferência, com o mesmo driver e dia SP. Valor integral em centavos deve corresponder ao pagamento. Capacidade soma alocações de despesas e vínculos ativos de pagáveis/acertos. Quando qualquer parte é inválida, não atribui conta baseada em vínculo duvidoso: a origem continua desconhecida e bloqueia os cortes potencialmente afetados.

Link revertido não representa novo dinheiro: pagamento permanece no manifesto como pendência até associação válida posterior. Reassociação exata permite nova revisão durável e conserva decisões anteriores. O manifesto inclui agora driver_settlements e finance_expense_allocations; mudanças nessas evidências alteram o hash.

Testes cobrem aprovação positiva sem novo dinheiro/pagamento, reversão e reassociação, divergência de driver/data/valor/settlement, concorrência de capacidade representada por reserva pagável, múltiplos vínculos ativos e ID de driver movido para outro tenant. O dinheiro é registrado pelo comando real; links históricos e corrupções são seeds em DDL real com grafo restrito. Não há alegação de execução do builder completo ou do comando de associação neste arquivo.

Integração ao helper accountPeriodCloseDatabase(true) instala a nova migration e allocations real. Factory closedPeriodLateCompositionDatabase foi ajustada, com autorização do autor, para não recriar allocations já existente. Os positivos de fechamento continuam passando com classificador2.

Limites restantes: adiantamentos pagos e payroll already_paid ainda exigem classificação específica; sua ausência de conta não foi automaticamente interpretada como pagamento integrado. O nativo de fechamento de nove casos pertence ao hash anterior B163116; esta ampliação tem prova PGlite e requer nova rodada nativa se for incluída na liberação.

## Validação nativa posterior

Executada em PostgreSQL17.11, selector `finance-legacy-cut-settlement`, script `scripts/test-finance-legacy-cut-settlement-native-cases.mjs`. **5 casos passaram**, handle86400 exit0, servidor descartável parado. Log em `node_modules/.cache/qa-postgres/finance-legacy-cut-settlement-native-2026-09-10.log`. Hash170213 igual ao documentado acima.

Foram instalados corpos reais dos comandos e guards130540, opções130921, auditoria131149 e reversão132411. Vínculo e reversão foram executados por suas RPCs, não inseridos como seeds. Pagamento histórico é fixture explícita; movimento é comando real. Casos: vínculo/replay positivo e revisão do corte; reversão concorrente com revisão obsoleta rejeitada sem resíduos; dois pagamentos disputando a mesma capacidade com apenas um vencedor; reversão concorrente com reassociação de outro pagamento; revogação durante espera. Cada disputa preservou dinheiro e pagamentos integralmente. O leitor real passou pelo legacyCutReviewSchema.

Esta rodada fecha a limitação anterior de ausência de teste nativo para170213. Não repete o fechamento completo nem amplia a evidência para o histórico remoto/plataforma completa.
