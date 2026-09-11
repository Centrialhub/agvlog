# Conferência de componentes da manutenção — 10/09/2026

Migration60441 implementa `get_finance_maintenance_cost_context`: cabeçalho da OS, peças e movimentos físicos de estoque separados. A consulta inclui movimentos explicitamente referenciados por peça e aqueles ligados à OS, sempre no mesmo tenant. Não reconhece novo custo (`recognized_cost_cents=null`) e não cria obrigação/pagamento.

Paginação30 por lista, contagens completas e revisão baseada em todas as fontes, independente da página. Cabeçalho e soma das peças podem divergir: a consulta evidencia a diferença sem escolher silenciosamente qual valor é financeiro. Quantidades/valores/datas inválidos permanecem indeterminados. Referências ausentes, incompatibilidade peça/movimento, repetição do mesmo movimento e estoque sem peça ficam identificados.

Quatro testes PGlite com schema real de UI passaram em `maintenanceCostContextDatabase.test.ts`: fontes coerentes sem dinheiro criado,1005peças, revisão alterada por componente fora da primeira página, repetição/incompatibilidade, NaN/infinity, isolamento de referência externa e rejeição de motorista/contexto inválido. A fixture usa tabelas de baseline e grafo financeiro restrito; não valida comandos de estoque, ensaio integral das migrations ou produção. ESLint passou.

Limites: fornecedor textual não é resolvido automaticamente para cadastro; centavos declarados exigem precisão inteira e não definem política de arredondamento de custo unitário. Revisão atual captura OS/peças/movimentos, não representa autorização de adoção financeira. Reconhecimento de mão de obra, aquisição e consumo do estoque continuam como operações distintas a implementar.

Auditoria60822 também acrescenta associação/reversão de custos antigos ao filtro global de intervenções manuais. Teste integrado usa associação e reversão reais, verifica duas linhas com autoria e `manual_intervention=true`. Labels de ações incluídos na interface. Teste `legacyCostReaders` passou novamente (3casos). Nenhuma aplicação remota nesta etapa.
