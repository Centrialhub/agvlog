# Aplicação/liberação de crédito de cliente — candidato privado

Sem aplicação remota, sem novo pagamento ou movimento financeiro. A liberação compensa uso do crédito; não representa devolução de dinheiro ao cliente.

## Evidência local

Vitest 07:45:18, saída 0: seis testes próprios. ESLint dos dois arquivos TypeScript: saída 0. O ensaio integrado anterior também executou o teste independente de cash10/crédito40/estorno somente cash10 e o parser real de contexto: oito testes totais naquela execução. Nenhum PostgreSQL nativo deste agente nesta rodada.

- Origem: documento fiscal existente na fixture, recebimento real de100 e cancelamento confirmado produzem um crédito de100. Nenhuma API de emissão chamada.
- Aplicação40 em título50, replay, liberação40: dinheiro0/crédito40/liquidado40/aberto10, depois aberto50. Banco e recebimento originais preservados.
- Nova observação fiscal cancelada mantém crédito válido: binding usa linha imutável do crédito; revisão dinâmica continua invalidando prévias antigas. Snapshot de evento não recursa todo histórico.
- Destino fiscal cancelado: worker real com auth.uidNULL libera crédito por observação verificável, não inventa ator. Nenhum segundo crédito nem novo banco.
- Fatura real criada e cancelada por comando: liberação automática mantém grafo e replay coerentes, sem caixa adicional.
- Pagador divergente, revisão antiga, capacidade excedida, replay alterado e revogação negados. Uso em dois títulos respeita capacidade global. Identidade do título permanece imutável após uso.
- Predecessor adulterado impede instalação e transação desfaz inclusive tabela nova. Constraints diferidas executadas nos positivos.
- Auditoria central manual retorna aplicação e liberação com classificação correta.

## Contrato e integração

finance_private.customer_credit_application_context e record_customer_credit_application permanecem privados. Catálogo/publicboundary pertence ao agente native. Root detém overlay de forecast02519; leitores de página/carteira terão integração separada. received_amount/cents legado significa liquidado; contexto separa cash_received_cents,credit_applied_cents,settled_cents. payment_count continua quantidade de pagamentos reais. credit_application_count conta eventos históricos apply/release.

Worker e fatura usam liberação compensatória antes de recalcular/cancelar. Journal privado imutável, BEFORE INSERT fiscal/finance try-lock e identidade/auditoria; constraint diferida prova posição e título. Manual requer acesso atual e preserva auditoria; sistema exige observação de cancelamento confirmada. Fonte original não muda.

## Limites explícitos

Refund do crédito disponível ainda não implementado neste bloco. Não chamar release de devolução. Ainda não há prova nativa de concorrência deste novo núcleo; revisão/native antes promoção. Fixture utiliza definições reais capturadas atuais e DDL real fiscal/fatura/extrato, não representa reset da cadeia inteira. Fonte de descarga na fixture básica usa contrato210433; integração forecast/current-cost é ensaio separado do root. Nenhuma conclusão de implantação decorre deste relatório.
