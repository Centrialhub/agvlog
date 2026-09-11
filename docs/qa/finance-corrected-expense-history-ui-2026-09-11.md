# Apresentação do custo retificado — 11/09/2026

Implementação local vinculada à futura cadeia de correção positiva de custo. Não publicada isoladamente. Banco e outros leitores estão em integração por agentes distintos; esta nota não comprova funcionamento integral remoto.

FinanceExpenses apresenta custo vigente e identifica o original quando há retificação. Totais/categorias/centros/complementos não comprovados mostram A conferir; dinheiro alocado permanece separado. Histórico original e totais de registros cancelados preservam contrato original no DTO. Durante refetch não reutiliza linha selecionada desatualizada para mostrar conferência corrente.

ExpenseHistoryDetail preserva valor original e acrescenta ExpenseCostHistory: antes/depois, autor/ID, motivo, evento/pedido e retirada de aprovação. Obrigação exibida utiliza custo vigente menos alocação real e recusa diferença negativa. Entrada do modal de correção existe somente para administrador/owner em gasto vinculado a descarga; autorização real continua no servidor e boundary. A origem de cobrança informa custo ORIGINAL para não confundir com valor retificado.

expenseCostPresentation exige correspondência de empresa, despesa, descarga, pagável e valor original entre linha/resolver, além de verified e igualdade do valor efetivo. Origem ausente/inválida ou versão incompatível com campos novos nunca retorna valor original como corrente. Resposta antiga sem ambos campos novos conserva semântica anterior à implantação da cadeia; escritor novo só pode ser promovido com os leitores novos integrados.

Provas locais:21 testes aprovados03:14:06 (8 tela,6 reembolso,7 apresentação). Custo150→120 gera obrigação120, preserva original150/autor/motivo/reaprovação; falta de evidência torna totais indisponíveis. Identidades trocadas e alocação maior que custo não produzem valores confirmados. Operador não recebe entrada de correção; admin recebe. Lint dos9arquivos aprovado. Sem TSC global/build nesta frente enquanto arquivos de outros agentes mudam. Primeira rodada teve2 expectativas de rótulo antigo que foram ajustadas para Custo original registrado, preservando os cenários.

## Atualização durante a conferência

Mantido o modal aberto durante a atualização da lista: o detalhe preserva a identidade selecionada, mas oculta valor vigente, obrigação e cobrança enquanto a consulta corrente não está disponível. O comando aberto mantém sua própria prévia/pedido. Nova abertura de correção fica desabilitada durante essa indisponibilidade. Não existe fallback de consulta desatualizada apresentado como valor vigente. Teste de tela verifica pelo nome o mesmo diálogo de correção antes e durante refetch pendente;9 testes de tela passaram03:18:43 e lint direcionado aprovado. Conjunto desta frente totaliza22casos (9tela+6reembolso+7apresentação), sem alegar TSC/build global nesta fase.
