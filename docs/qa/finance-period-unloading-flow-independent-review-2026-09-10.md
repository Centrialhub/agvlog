# Descargas no período — revisão independente e cenários nativos

2026-09-10. Revisão da proposta, writers reais e pacote193723; sem alteração de SQL e sem iniciar PostgreSQL. O novo leitor ainda não estava congelado, portanto estes são requisitos de revisão, não defeitos já reproduzidos no novo corpo.

## Riscos concretos do grafo existente

1. **Cardinalidade de vínculos.** 024438 define PK tenant/command_id, não payment_id, e action receive/reverse. JOIN somente por payment multiplica recebimento pela devolução. Entrada exige action receive; saída exige o command_id e bank_transaction_id da reversal, além do payment/tenant exatos.
2. **Capacidade compartilhada.** receipt_movement_used_cents de145616 soma todos os recebimentos canônicos não corrigidos e associações legadas ativas. Não exclui pagamento apenas porque houve devolução: dinheiro entrou e depois saiu. Correção025658 libera composição; devolução monetária não libera entrada. Filtrar fornecedor/descarga antes de verificar capacidade pode aceitar o mesmo Pix utilizado pelo frete. O helper retorna trunc(sum); sozinho não é diagnóstico suficiente para linhas históricas inválidas/fração/valor desconhecido. O leitor deve conferir também fontes integrais.
3. **Legado e reversão de associação.** finance_legacy_receipt_link_reversals remove vínculo ativo, não apaga recebimento real. Não gerar nova saída nem remover origem econômica por reversão dessa associação. Se evidência legada não entrar no primeiro total comprovado, manter diagnóstico e dados originais visíveis.
4. **Perna de devolução.** Usar reversal.effective_at e sua bank_transaction/conta/direção, não received_at ou conta do payment pai. O escritor atual de refund normalmente usa conta do pai, mas a validação de prova deve verificar a perna real e não assumir isso para histórico. received_at/effective_at são timestamptz; converter dia America/Sao_Paulo. occurred_on da charge/movement já é date.
5. **Pacote com diagnóstico.** period_money_account193723 retorna movement_ids distintos mesmo quando detecta manifesto duplicado ou saldo inválido. Fazer somente ID = ANY(movement_ids) não prova cobertura. Exigir integridade/cobertura do fechamento pertinente e validar conta, direção, dia e centavos contra fatos congelados. Metadados de transferência inválidos podem deixar bruto monetário válido; não invalidar todo bruto por classificação desconhecida.
6. **Revisão fora do filtro.** Claim de frete/legado no mesmo movement, correção, crédito, reabertura do closure ou mudança de evidência pode mudar classificação de uma descarga sem alterar IDs dos seus payments. Revisão precisa incluir essas dependências globais pertinentes, além das linhas paginadas. Composição conhecida após fechamento não deve reescrever snapshot ou ser apresentada como conhecida na época.
7. **Escopo da origem.** Charge antiga com pagamento no corte deve ser encontrada mesmo se occurred_on estiver fora do filtro. Somar origem por charge_id uma vez, não por documentos do snapshot. supplier_id e nome original vêm da charge/source_snapshot; current receivable.client_id é verificação de consistência, não fonte para redistribuir fornecedor.
8. **Estorno parcial não existe neste writer.** apply_receivable_financial_command reverse usa integralmente v_payment.amount (183929 linhas284–287); payload não permite escolher quantia menor. Para provar devolução20, é necessário pagamento original20. Não fabricar parcial de60/90 em fixture e chamá-lo comando real.

## Matriz nativa viável após freeze

- Charge real150 em janeiro e recebimentos reais60+90 em fevereiro; closures reais do pacote. Janeiro origem150/entrada0, fevereiro origem0/entrada150, sem saldo devedor inferido.
- Movimento real300 compartilhado: descarga100+frete200, ambos recebimentos via movement_id. Checar bruto300 uma vez e alocação descarga100. Correção real/reuso altera revisão e não cria caixa extra.
- Pagamento original20 em fevereiro, refund real20 em março: original preservado, março saída20, replay sem nova devolução. Não reaplicar devolução no mês original.
- Closure real com composição tardia: pacote/revisão congelados preservados, leitor assume evidência conhecida atualmente. Reabrir invalida cobertura.
- Movimento com composição global externa à descarga e associação legada revertida: diagnóstico por IDs sem inventar saída. Dados inválidos apenas como fixture negativa explícita, sem desabilitar guard para provar sucesso.
- Limites de dia SP, fonte sem data/órfã, fornecedor homônimo por IDs, tenant e motorista misto; página posterior com revisão obsoleta deve rejeitar.

Harness pode reutilizar fixture de fechamento real do pacote e funções operacionais necessárias ao record_unloading, mas precisa incorporar essas dependências reais antes de alegar criação automática da charge. Não executar antes do hash final, nem criar charge falsa para substituir o teste principal do writer.
