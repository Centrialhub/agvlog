# Associação de mão de obra de manutenção — UI (2026-09-10)

MaintenanceLaborAssociation integrado em seção isolada no cabeçalho do painel da OS. Sem incluir peças ou total da ordem na associação. A consulta diferencia texto de fornecedor declarado na OS e fornecedor cadastrado do custo (nome/UUID). Ausência de supplier_id bloqueia escolha. Busca literal/paginação de candidatos e histórico; associação ativa independente da página.

Revisão exige identificação explícita do custo, declaração same_labor_confirmed, motivo e revisão combinada do servidor. Mudança de fornecedor ou revision após revisão bloqueia confirmação. Pedido durável por empresa/ator/OS; resposta incerta retoma exatamente o pedido original; armazenamento corrompido bloqueia envio. Primeiro rollback conhecido libera edição. Dados antigos ocultos durante refetch/falha.

Autoria, fornecedor, motivo e reversão permanecem visíveis. Reversão preserva dinheiro/obrigações e permite corrigir os valores da OS depois de desfazer a associação ativa; não foi copiada a imutabilidade permanente da despesa antiga. Nenhuma associação cria custo ou pagamento.

Validação: 12 testes passaram (7 fluxo, 3 cliente, 2 painel da OS), lint sem erros. Root confirmou três testes SQL reais da consulta61129 com schema; core confirmou sete testes60950. TSC integrado81790 encerrou com oito erros fora do financeiro: Ingestion.tsx:170 (variável sem uso), driverDeliverySubmission.test.ts:24/167 (ReceiptScanQuality incompleto) e DriverStopsComponent.test.tsx:73/78/84/85 (arrival ausente). Nenhum erro financeiro reportado, mas validação global não aprovada. Invalidações explícitas adicionadas em manutenção e lote; helper global coordenado pelo root. Nenhum SQL ou banco remoto alterado nesta frente.
