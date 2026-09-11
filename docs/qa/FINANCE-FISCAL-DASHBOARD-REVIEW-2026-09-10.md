# Revisão independente do resumo fiscal52711

Somente leitura da query, testes fiscais reais e cadeia05509/10034/12152. Nenhum SQL de implementação alterado.

## Correções recomendadas

Atualização do responsável:52711 passou a comparar metadados atuais da emissão com observação (incluindo hash de request/doc_type), basis.ready e payer_id contra cliente do título. Teste de chave alterada mantendo authorized agora invalida antes do worker; após processamento, a fixture produz origin em review, fora da soma ativa. Estes achados documentam a revisão anterior, não afirmam ausência dessas correções na versão atual.

1. **Identidade fiscal atual não validada.** A query usa `receivable_fiscal_issue`, que verifica estado ativo da origem e status/environment/dispatch da emissão, mas não compara access_key/hub_document_id, tipo, source_id, protocolo ou observação vigente. Após mudar a identidade mantendo authorized, a base antiga continua somada como válida. O worker10034 reconhece `fiscal_origin_changed`, deixa job em review, mas nessa ramificação não desativa origin.state; o problema pode permanecer mesmo após processamento. A leitura deve comparar origem/basis/observação com emissão atual, usando os mesmos atributos relevantes do worker, e invalidar a soma ativa quando divergirem. Reprodução: project() do teste atual, trocar access_key por outra chave44dígitos, consultar antes/depois do novo job; atualmente o guard de status é insuficiente.

2. **Pagador/base não conferidos contra título.** `basis.payer_id` não é comparado com receivables.client_id. Uma troca do cliente do título pode mover os números para outro filtro de cliente sem prova de que a base fiscal foi atualizada. Verificar payer, source, doc_type, tenant e ready=true da base, além da equação monetária. Um cliente explicitamente filtrado deve ser validado na empresa (já feito); uma origem com referência divergente não deve sumir silenciosamente de todos os filtros relevantes.

## Aspectos adequados e limites

O escopo é claramente origens incorporadas, com created_at em São Paulo, não emissão total nem caixa. As condições monetárias evitam centavos inválidos e exigem bruto=líquido+retenções. A fila de trabalhos declara escopo tenant_all_dates. Cancelamento chega primeiro na emissão: o guard já bloqueia somas antes do worker, coberto por teste. Depois o contador cancelado fica separado da soma ativa. Nenhuma dessas leituras escreve dinheiro ou desfaz pagamentos.

Testes adicionais recomendados: origem/identidade divergente mantendo status autorizado; source/payer trocados; filtro cliente e tipo exatos com outro tenant; base ready=false; cancelamento após recebimento com crédito real preservando contagem de movimentos/pagamentos e valor bancário. O último é regressão de integração, não autorização para reinterpretar valor recebido como receita fiscal ativa.

## Próxima query de previsão de frete — proposta sem implementação

Criar consulta separada de expectativa elegível por origem do serviço, com from/to definidos como data de origem e cliente opcional. Reutilizar as regras de elegibilidade de `useBillingDocuments(...,'all')`, que já percorre todas as páginas500: NF inbound não cancelada/excluída; sem cobertura fiscal válida; reservas em envio incerto/em andamento separadas como impedimento temporário. Fazer a leitura no servidor em um snapshot consistente.

Somar exclusivamente frete do serviço em centavos (`freight_value` validado e sua parcela ainda descoberta), nunca totalValue/valor da mercadoria. Identidade por NF e tentativa/serviço quando existir reentrega/faturamento parcial; usar claims e alocações exatas, não multiplicar por joins a cargas/CTe. Se parcela não puder ser determinada com precisão, informar unknown_count e anular total daquele escopo, preservando known subtotal somente se nomeado explicitamente como parcial.

Retorno proposto: total_origins, eligible_count, reserved_count, already_covered_count, invalid_count, undated_count, forecast_cents|null, totals_valid, grupos por cliente/mês e date_basis; nenhuma data de recebimento inventada. Origem cancelada não volta automaticamente à previsão: verificar serviço ainda devido e ausência de outra autorização/substituição. Separar expectativa de títulos já autorizados e de descarga a receber. Inicialmente classificar emissão como all, evitando deduzir CTe/NFSe só por texto do município sem emitente/identidade municipal confiáveis.
