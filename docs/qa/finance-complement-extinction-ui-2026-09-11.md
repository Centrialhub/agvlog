# Extinção do complemento — UI local

Export `OpenComplementExtinctionDialog({tenant,actor,chargeId,open,onOpenChange})` e `ExpenseComplementExtinctionHistory({value})`. Root possui integração no detalhe/histórico do gasto. Somente `unloadingCostCorrectionContract.ts` existente foi alterado para aceitar `complement_extinction` opcional; snapshots antigos continuam válidos. Novos contratos puros separados, sem ciclo.

APIs coordenadas com native: preview_finance_open_complement_extinction(_tenant_id,_charge_id,_proposal) e extinguish_finance_open_complement(_payload). Previa descoberta dispositions[] aceita somente para buscar fontes sem elegibilidade. Operador informa custo positivo e valor aplicado em cada fonte. Identidade do motorista vem da fonte conferida pelo servidor; não existe input UUID livre. Editar custo ou aplicação oculta confirmação anterior. Owner/admin + can_execute + razão10..2000 + reconhecimento explícito exigidos para confirmar.

Apresentação separa custo original/vigente/proposto, reserva inalterada, título nominal histórico preservado como cancelado e devido zero. Igualdade100/100 não cria excedente ou dívida; redução80/reserva100 mostra responsabilidade20 e nenhum dinheiro devolvido. Prévia inelegível não declara responsabilidade confirmada. Paid/materializado/período fechado permanecem bloqueados conforme servidor. Cobrança e dinheiro inalterados. Histórico amber manual mantém autorID/motivo/data/pedido e residual histórico; devoluções posteriores são outra camada.

Outbox por empresa/ator com WebLocks, pedido persistido antes de enviar, exact replay, comparação de registro entre abas e validação IDs/efeitos/statuscancelled no resultado. Primeira rejeição definitiva pode liberar; retry após incerteza preserva pedido. Falha de atualização não desfaz confirmação terminal. Sem fallback raw ou RPC alternativo.

## Devolução posterior alcançável

A entrada já existente fica em Financial.tsx → CostDispositionsPanel → ExpenseCostCoverage → Conferir devolução de [responsável] → CostDispositionReturnDialog. Exige coverage verificada e open_cents positivo. Não depende da elegibilidade de nova regularização, que pode estar bloqueada após extinção. UnloadingCostRegularizationDialog não fornece essa ação. Nenhuma nova API de retorno foi criada.

Novo teste comportamental com nominal histórico50 cancelado, reserva100/custo80/residual20, returned10/open10 abre o diálogo de retorno existente e consulta o catálogo para o dispositionID correto, sem enviar comando. Evidência monetária completa permanece nos testes SQL do native.

## QA local

- Novos contratos2 + outbox3 passaram06:47:39.
- UI4 + client1 passaram06:48:49.
- Regressões contrato complemento3 + apresentação custo9 passaram06:49:09.
- Entrada de devolução1 passou06:50:36.
- Total23 testes em7 arquivos (11 novos +12 regressões). Lint15 arquivos exit0, sem avisos.
- Native reportou5 testes públicos94310 com os parsers reais, incluindo descoberta, proposta, confirmação/replay e projeção que retira título cancelled das saídas futuras preservando seu nominal no banco.

Nenhuma alteração SQL, rota, stage, commit, produção ou Sites nesta subtarefa. TSC global fica com root. Allowlist15 arquivos eSHA256: finance-complement-extinction-ui-allowlist-2026-09-11.json. Root possui ExpenseHistoryDetail/ExpenseCostHistory e esses arquivos não foram alterados aqui.
