# Associação de custos antigos — UI (2026-09-10)

Inventário independente em /financial/recorded-expenses e ação por despesa em /expense-approval. Fonte driver_expenses permite revisar associação integral a finance_expense_items existente; manutenção permanece diagnóstico por componentes, sem soma ou promessa de cobertura completa. Dados sem data/valor válido permanecem explícitos. Inventário e histórico paginados (30), associação ativa independente da página.

Comando exige escolha de ID, revisão combinada source/target do servidor, declaração de mesmo gasto e motivo. Sem associação automática por valor/data. Históricos mostram autoria, motivo e reversão permanentemente. Correção desfaz associação, não gera nem apaga custo, obrigação ou dinheiro. Motoristas/mistos passam pelo gate FinanceAccessBoundary antes de consultas financeiras.

Pedido preservado por empresa/ator/despesa antes do envio. Resposta incerta mantém comando original para retomada; rejeição transacional conhecida na primeira tentativa libera revisão. Storage corrompido bloqueia envio. Consulta em atualização/falha oculta opções antigas; revisão depende do snapshot/revision da candidata.

Validação: 10 testes próprios (5 fluxo UI, 3 cliente/contrato, 2 inventário) passaram. Lint do escopo sem erros. Root validou três testes SQL reais contra os schemas, incluindo 1005 fontes e 31 custos paginados, associação/reversão/histórico. TSC integrado 78323 encerrou com 10 erros fora do financeiro, nos arquivos concorrentes de motorista/offline/recibos; validação global não aprovada. Nenhum erro financeiro foi reportado nessa execução. Sem SQL alterado nesta frente e sem implantação remota.

Invalidações explícitas cobrem criação/revisão de despesa, lote na página de gastos e associações. Root coordena helper global e callback de Movimentações.
