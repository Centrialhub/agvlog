# Revisão humana de cobertura — interface

Implementada em `StatementCoverageReview`, integrada como painel independente de `AccountPeriodReview`. Consulta pelo contexto de empresa, responsável, conta e período; dados anteriores ficam ocultos durante atualização ou falha. `LegacyAdoptionInventory` também integrado a pedido do coordenador.

Aprovação exige duas declarações separadas: obtenção dos originais diretamente do banco e conferência da cobertura integral do período. Há revisão antes do envio, vinculada à revisão das evidências. Evidência alterada impede envio novo; aprovação anterior alterada precisa ser desfeita antes de renovar.

Pedidos persistem por empresa/responsável/conta antes do envio. Resposta incerta mantém comando e identificador originais inclusive após mudança de período. Troca de conta não reaproveita pedido de outra conta. Armazenamento corrompido bloqueia novos comandos; falha de gravação impede envio. Rejeição transacional conhecida na primeira tentativa libera revisão, mas não descarta pedido previamente incerto.

Histórico mantém identificação manual, autor, data, motivo, declarações, evidências preservadas e autoria/motivo da reversão. O cliente valida o contexto inclusive dos snapshots e reversões. Aprovação humana permanece `not_attested`; nenhuma ação fecha período, executa pagamento ou modifica dinheiro.

Validação: 13 testes passaram em statementCoverageReview (6), statementCoverageClient (3), accountPeriodReview (2), financeAuditScreen (2). ESLint dos arquivos desta entrega e financeAuditContract passou. TypeScript global `tsc --noEmit -p tsconfig.app.json` passou (sessão 79631). SQL não foi alterado nesta entrega; contrato comparado à migration 20260910142143, validação de banco realizada pela frente native_finance_links.

Limite: declarações humanas não substituem autenticação do banco. O fechamento continua indisponível enquanto as demais condições de adoção e conferência não estiverem resolvidas.
