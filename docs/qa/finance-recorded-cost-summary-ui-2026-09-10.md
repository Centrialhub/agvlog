# Resumo integral dos custos incorporados

Financial substituiu consultas limitadas a 500 despesas antigas e ordens de manutenção pelo resumo servidor de lotes de despesas, gastos avulsos e remuneração da folha. Foram removidos o cálculo misturado de receita menos custo, o rótulo de saída para custos, a comparação receita/despesa com bases diferentes e a lista parcial de despesas antigas. O acesso à lista de despesas registradas usa a rota existente `/financial/recorded-expenses`.

Custos são apresentados com cobertura explícita, por categoria, centro de custo e mês. Despesas antigas, manutenção, composição de acertos e reembolsos/adiantamentos da folha não são somados sem prova de incorporação e deduplicação. Valor inválido torna todos os totais indisponíveis; ausência de registros na cobertura não significa ausência de custos na empresa. Data de registro é identificada e não presumida como data bancária.

Contrato exige totais e grupos coerentes, preserva centavos inteiros e categoria/mês nulos quando inválidos. Filtros são datas, categoria e ID do centro de custo; o seletor usa catálogo completo com IDs e inclui inativos. O filtro fiscal legado por nome foi preservado separadamente durante esta etapa. Cliente e tipo fiscal não afetam o resumo de custos.

Sete testes próprios e três de carteira passaram. Lint passou. TypeScript global 69605 passou. Nenhum SQL alterado; consulta `get_finance_recorded_cost_summary` e banco são responsabilidade da frente native_finance_links.
