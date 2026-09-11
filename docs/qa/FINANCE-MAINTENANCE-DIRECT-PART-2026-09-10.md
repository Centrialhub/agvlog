# Compra direta de peça: associação auditada por OS

Migration local `20260910161702_finance_maintenance_direct_part_associations.sql`. SHA256 `a9c7a78cd4a0a3434332b4aa4b23f7f4a79d24c76209d10361c130c92e2a1adf`. Nenhuma aplicação remota. A migration 60950 de mão de obra permaneceu intacta; seus helpers/triggers são estendidos somente nesta migration posterior.

## Escopo

Associa integralmente `maintenance_parts` a `finance_expense_items` já registrado, mediante classificação explícita `direct_purchase`. Não cria custo adicional, obrigação, pagamento ou dinheiro. Cabeçalho da OS, mão de obra, compra de peça e consumo de estoque não são somados como representações independentes do mesmo gasto.

A OS deve estar concluída. Quantidade positiva finita, custo unitário positivo e total inteiro em centavos devem fechar exatamente `quantidade × unitário = total`. O alvo pertence à mesma empresa, lote de manutenção, categoria maintenance/service, tem fornecedor cadastrado por ID e documento preenchido, e corresponde ao total integral. Título existente precisa manter valor/fornecedor e não estar cancelado. Outro título derivado da peça, da OS ou de sua obrigação exige revisão.

`stock_item_id` isolado é catálogo: permitido se válido na empresa. `stock_movement_id` indica fluxo de estoque e impede compra direta. Movimento da mesma OS/item sem vínculo exato exige revisão, sem inferir identidade por item. Consumo de estoque continua etapa distinta; esta associação não o resolve.

## Contrato

`associate_finance_maintenance_direct_part(_payload)` recebe `version:1`, `tenant_id`, `request_id`, `part_id`, `cost_id`, `revision`, `reason`, `classification:'direct_purchase'`, `quantity` como texto decimal, `document_number` exatamente igual ao documento do alvo, `same_part_confirmed:true`.

Quantidade e documento são declarações do usuário conferidas contra os campos disponíveis, não comprovação documental automática: a peça antiga não tem documento/fornecedor estruturados e o custo não tem quantidade. O snapshot preserva essa distinção. Nenhuma identidade é deduzida pelo nome do fornecedor.

Resultado: IDs de empresa/request/OS/peça/custo/vínculo, centavos string, `cash_created:false`, `obligation_created:false`, `confirmed:true`.

`reverse_finance_maintenance_direct_part_association(_payload)` recebe versão/empresa/request/link IDs e motivo; retorna os IDs e centavos, `reversal_id`, `cash_changed:false`, `obligation_changed:false`, `confirmed:true`. Reversão altera somente o vínculo e libera a reserva do alvo.

Revisão inclui peça, OS, catálogo, movimentações de estoque relevantes, custo/lote/fornecedor/títulos, obrigações, alocações e reservas/histórico. O snapshot integral inclui declaração de classificação, quantidade e documento. Replay exige ator/ação/payload idênticos. Eventos `maintenance_direct_part_associated` e `maintenance_direct_part_association_reversed` possuem autor, horário, motivo e marca manual; leitor 61828 integra auditoria manual.

## Invariante compartilhada e correções

`finance_maintenance_cost_claims` reserva `(tenant_id,cost_id)` e `(tenant_id,source_kind,source_id)` por constraint única. Triggers de inserção/reversão de peça e mão de obra mantêm essa reserva atomicamente. Backfill dos vínculos ativos de mão de obra falha diante de conflitos. Escrita privilegiada de um segundo vínculo também é rejeitada pela constraint, além dos guards dos comandos.

Consulta de elegibilidade e revisão de mão de obra passam a considerar reservas de peças. A reserva ativa não apenas impede o INSERT: também deixa de oferecer o alvo como elegível. Locks: financeiro da empresa → OS → peça; autorização repetida após espera. Triggers usam tentativa da mesma trava para não esperar em ordem inversa.

Peça associada aceita somente edição de notas; identidade/valores são protegidos. OS protege identidade/empresa/status/veículo/ativo quando tem peça associada, consultando empresa de OLD antes de qualquer tentativa de transferência. Movimento posterior de estoque da mesma OS/item exige reversão/revisão prévia. Depois de desfazer, a fonte pode ser corrigida e revista; snapshots anteriores permanecem.

## Verificação

`financeMaintenanceDirectPart.test.ts`: **9 testes SQL passaram**. ESLint passou para os arquivos de teste/helper antes da última adição de teste. Regressão de mão de obra: 7 testes passaram junto dos seis primeiros testes de peça.

Casos: comando real de lote, nenhum dinheiro/título novo, replay, declarações incompatíveis, motorista rejeitado, disputa lógica de alvo labor/peça, liberação na reversão, constraint contra INSERT privilegiado duplicado, snapshot após correção, estoque excluído, catálogo válido, proteção da OS/movimento posterior, mudança da revisão de labor por reserva de peça e tentativa de trocar empresa da OS.

Validação PostgreSQL nativa concorrente atribuída ao agente responsável pelo runtime. Não incluída nos nove testes acima.

## Limites

Somente compra direta integral e um item de custo por peça. Rateios de um documento entre várias peças, alvo manual direto, consumo de estoque e política de valorização permanecem fora deste comando. Quantidade/documento conferidos manualmente ficam permanentemente evidenciados. Não declara estoque ou manutenção totalmente incorporados nem conciliação bancária concluída.
