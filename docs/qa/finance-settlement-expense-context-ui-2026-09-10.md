# Gastos conferidos no acerto — interface de consulta

Painel `SettlementExpenseContext` integrado à aba Despesas de `DriverSettlementDrawer`. Implementação local candidata, sem alteração SQL por esta frente.

O painel usa `get_finance_settlement_expense_context` via contrato/adaptador próprios. Exibe os totais fornecidos pelo servidor para toda a viagem: custo, alocações em saídas, títulos complementares, pagamentos dos títulos e saldo pendente. Não soma somente as linhas da página nem modifica totais do acerto. Mostra favorecido explícito, status/ID do título e pendências de revisão. Pagina em 30 registros e dispõe de atualização manual.

A explicação diferencia custo do acerto e obrigação complementar já registrada em Contas a pagar, que não gera outro crédito no acerto/folha. Acerto sem trip_id mostra ausência de vínculo; não tenta inferir viagem pelas cargas. O link existente `/payables` abre a lista de contas a pagar; não há rota comprovada de detalhe por ID e nenhuma baixa é executada pelo painel.

FinanceAccessBoundary protege o painel; chave de consulta contém empresa, ator, acerto e página. Falha/refetch esconde valores anteriores. O adaptador valida contexto completo e dinheiro como string inteira; formatação usa BigInt para evitar perda de precisão dos agregados.

A tabela antiga exclui apenas source_table='finance_expense_items' para não repetir esses itens, e foi identificada como “Outras despesas do acerto”. A aba Despesas não apresenta contagem parcial da lista antiga. Nenhuma despesa é removida do banco ou dos totais.

Verificação: 4 testes de interface/adaptador passaram, cobrindo totais do servidor, favorecido/título, paginação, revisão, acerto manual sem viagem, falha com cache anterior e resposta de outro contexto. ESLint passou no escopo. Execução integrada final: 28 testes passaram (4 próprios e 24 de `operationCorrectionFinanceFrontendDatabase.test.tsx`), já incluindo o ajuste de apresentação da tabela antiga. TypeScript global terminou com código 0 na sessão 39115.

Limites: cálculos, autorização SQL, integração do custo no builder e invalidação após mutações são responsabilidades das frentes de banco/coordenação. Não houve publicação remota ou navegador real neste complemento.
