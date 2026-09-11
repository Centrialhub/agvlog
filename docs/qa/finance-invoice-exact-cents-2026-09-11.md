# Parser de faturas: centavos exatos

Contraprova confirmada: total1.005 e parcelas0.29+0.714 produziam o mesmo inteiro após Math.round, apesar de valores inválidos. O parser agora usa legacyReceivableCents (decimal textual, no máximo2casas, teto99999999999999centavos) para gross/discount/interest/total/received/open e compara as parcelas com BigInt. Não arredonda, não usa tolerância e não converte null em0.

Três testes focais passaram:0.29 válido e teto máximo exato; frações adicionais/NaN/infinito/negativo/fora de teto e saldo divergente rejeitados; null de reconciliação e nominal cancelado preservados. Duas regressõesSQLreais adicionais passaram em clientInvoiceLifecycleDatabase (baixa parcial→devolução→cancelamento; fatura órfã null),15outros casos pulados. Lint dos2arquivos passou. Sem backend/migração/TSC/publicação.

ConsumerClientInvoices foi inspecionado: exige erroausente/listapresente/nãotruncada/nenhuma requires_reconciliation para mostrarKPI e mantém Total liquidado. Nenhuma página alterada nesta etapa. Observação enviada ao root: agregação local ainda usaNumber e pode perder centavos com muitas linhas no teto; não foi tratada silenciosamente como resolvida pelo parser.


## Agregação exata concluída

Por orientação posterior do root, invoiceListTotals agora converte cada parcela validada em centavos BigInt, soma sem Number e entrega strings. ClientInvoices formata esses inteiros diretamente. A regra de cancelados excluídos, categorias/status/vencimento e KPI Total liquidado permanece. Qualquer linha não cancelada com parcela desconhecida/inválida, ou qualquer requires_reconciliation, retorna todos os totaisnull. Lista vazia válida retorna0, mantendo a proteção externa de carregamento/erro/truncamento.

Três novos testes de soma passaram:500linhas no teto e centavo adicional sem perda; categorias/cancelados/liquidação; null/fração/NaN/reconciliação. Três testes de parser passaram novamente. Integração UI+SQL real passou no caso de baixa parcial, comprovando230emaberto/10liquidado (12outros casos pulados). O teste existente foi atualizado apenas no nome e no rótulo esperado Total liquidado. Lint dos5arquivos passou. A observação anterior sobre Number foi resolvida nesta etapa; nenhum checkoutSites, backend, TSC ou publicação alterado.
