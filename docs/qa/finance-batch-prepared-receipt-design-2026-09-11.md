# Comprovante preparado antes do lote — desenho para implementação

Estado: proposta; nenhuma migração, writer ou alteração de frontend implementados nesta rodada. A próxima entrega deve integrar SQL, Edge, modal e testes antes de liberar o caminho.

## Objetivo e identidade

O modal atual precisa obter um comprovante utilizável antes de registrar a descarga. O upload legado depende do scanner ausente. Não preencher receipt_path com caminho inventado nem no_receipt_reason com justificativa automática. Reutilizar a quarentena e sanitização v2 já existentes.

Criar intenção privada de comprovante vinculada a tenant, ator autenticado, pedido do lote e UUID antecipado da linha/despesa. Ela não é uma despesa provisória nem cria custo, cobrança ou dívida. Usar source_type=expense_draft e source_id=intent_id no upload v2. source_type=trip sozinho não prova pedido/linha e não atende sede; exigiria o mesmo vínculo adicional.

## Contrato proposto

RPC prepare_finance_expense_receipt_intent(_payload): version1, tenant_id, request_id próprio recuperável, batch_request_id, expense_id antecipado, context e referências aplicáveis trip_id/stop_id. Ator vem somente de auth.uid(). Retorno mínimo version, tenant_id, actor_id, request_id, batch_request_id, expense_id, intent_id, context e referências validadas. Nenhum caminho de original ou ticket de serviço é público.

A intenção guarda identidade imutável e prova da origem autorizada. Replay exige igualdade do pedido completo e ator. Cada artefato fica ligado a uma intenção exata e cada consumo identifica um único batch/expense. Troca de arquivo pode preparar outra intenção antes do envio definitivo; não pode alterar identidade de artefato validado ou reutilizar consumo confirmado em outro pedido.

Upload mantém reserve_finance_upload_artifact e prepare/finalize atuais, com source_type expense_draft. Hash, tamanho, request do upload, método e derivado permanecem na identidade v2. Apenas JPEG/PNG com sanitized_derivative e método jpeg-png-reencode-v1 atendem o comprovante nesta entrega. PDF/XLSX, falha ou quarentena não satisfazem a exigência. Não afirmar antivírus/scanned=true.

Item do comando record_finance_expense_batch acrescenta receipt_intent_id e receipt_artifact_id, compatíveis com itens legados. Para o ramo v2 receipt_path e no_receipt_reason são null reais. O pedido completo, UUIDs das linhas, intenções e artefatos permanecem persistidos na recuperação; perder a resposta não autoriza novo lote.

## Viagem e sede

Trip: validar empresa da viagem, entrega quando descarga, composição e elegibilidade existentes. Preparar intenção não congela autorização de registrar descarga: batch revalida viagem/entrega, revisão e unicidade no consumo. Não usar o upload para contornar custódia ou composição fiscal.

Sede/office: intenção vinculada ao pedido e linha, sem exigir viagem fictícia ou despesa existente. Reutilizar acesso financeiro e contexto administrativo do batch. Personnel, quando aceito pelo batch, conserva suas referências e autorização reais; não inventar vínculo com folha apenas para autorizar upload.

## Consumo atômico

1. Exigir empresa ativa, vínculo financeiro e ausência de perfil motorista/misto na entrada e depois das esperas. Intenção deve pertencer ao mesmo ator que registra o lote.
2. Sob a ordem de locks financeira existente, travar intenções e artefatos em ordem estável e revalidar identidade completa, estado sanitizado, evento de validação, método, hash/tamanho, objeto derivado e metadata.
3. Criar descarga/recebível/custo/payable/alocações pelos writers canônicos. A prova v2 é transportada explicitamente, sem path legado falso.
4. Após INSERT da despesa, gravar vínculo expense_receipts e evento de consumo da intenção na mesma transação. Cada vínculo confere tenant, batch_request_id, expense_id, actor e artifact_id.
5. Constraints diferidas verificam que toda linha v2 inserida tem consumo e comprovante exatos ao commit. Falha de qualquer item, auditoria ou consumo desfaz também custos/cobranças/obrigações; não deixa lote parcialmente confirmado.
6. Reautorizar antes do replay; replay do mesmo comando retorna o resultado original. Pedido divergente ou consumo por outra identidade falha.

A autorização de serviço de até120s continua restrita ao upload/validação. Consumo do artefato já sanitizado exige autorização atual do usuário; não depende de ticket de serviço ainda vigente nem aceita esse ticket como autorização de negócio. Originais permanecem em quarentena sem URL pública.

## Guardas e consumidores obrigatórios

- secure_upload_private.assert_source: reconhecer intenção existente. reserve também compara ator real com dono da intenção; verificar apenas existência por tenant é insuficiente.
- Política de source_type de artifacts: adicionar expense_draft, preservando a identidade de todos os artefatos anteriores. Não converter o artefato posteriormente para expense_item.
- finance_private.record_expense_batch: allowlist dos campos, validação do comprovante preparado e consumo transacional.
- finance_private.record_unloading: alternativa v2 explícita à validação receipt_path, mantendo regra obrigatória de comprovante da descarga e todos os demais guards.
- Constraints de finance_expense_items e finance_unloading_charges: permitir ausência do caminho legado somente com prova v2 íntegra/consumida, por guard imediato e validação diferida. A justificativa de falta de recibo continua opção real onde já permitida; não vale automaticamente para descarga.
- secure_upload_private.expense_receipt_source e expense_receipt_count: aceitar identidade preparada somente quando consumida pela mesma despesa. Preservar validação do objeto derivado, hash, método e evento. Não contar a intenção sozinha como comprovante.
- expense_receipt_history, leitor de derivado e list_expenses: conservar envelope/histórico e reconhecer os vínculos v2. A resolução da pendência deve ser demonstrada no leitor de gasto e nos consumidores de fechamento, não somente numa tabela lateral.
- finance_private.unloading_origin_base e unloading_projection_repair_context: substituir a suposição exclusiva de igualdade de receipt_path por alternativa de prova v2. NULL não pode virar prova verdadeira; comando original, snapshot da descarga e consumo devem concordar por IDs/hash.
- Resolver/correção/cancelamento da cobrança, custo e dívida: testar que novas origens v2 continuam verificadas e as antigas conservam a mesma revisão. Não reclassificar pagamentos ou reescrever fornecedor histórico.

## Preservação de hashes e provas anteriores

Não adicionar colunas em finance_expense_items nesta integração. expense_cost_effective usa to_jsonb(e) na revisão inicial; mesmo coluna nullable acrescentaria uma chave e poderia invalidar cadeias existentes. Manter o código de geração do snapshot do expense e o formato JSON dos registros anteriores inalterados. A prova nova da descarga pode ocupar source_snapshot já existente somente nas novas origens v2; não atualizar snapshots antigos.

Antes/depois da instalação, capturar hashes do catálogo de colunas/constraints relevantes e hashes de to_jsonb de expenses/charges reais anteriores, incluindo custo retificado. Assert explícito: colunas de expense inalteradas, snapshot original byte-equivalente em representação jsonb, revision e verified anteriores preservados. Constraints alteradas devem ter diferença esperada documentada; não declarar schema inteiro idêntico quando houver essa alteração necessária.

Toda substituição de função exige predecessor completo por hash/ACL/search_path conforme estado efetivo da produção, sem regex global nem rebaseline silencioso. As funções/storage policies capturadas em readiness monetária não devem ser modificadas incidentalmente; executar readiness e catálogo depois da cadeia integrada. Esta proposta não fornece hashes calculados: eles pertencem ao preflight da implementação, sobre os corpos efetivos então instalados.

## Aceite da entrega integrada

- Modal único em trip e sede: arquivo→validação real v2→batch→comprovante visível/contado, sem caminhos ou justificativas fabricados.
- Descarga preserva uma identidade por entrega e sua origem fica verificada nos leitores/correções.
- Artefato quarantined, método indevido, objeto/hash divergente ou intenção de outra linha/pedido/ator/empresa são rejeitados sem resíduos financeiros.
- Consumo duplicado por outro pedido falha; replay após perda de resposta confirma o mesmo lote e vínculos.
- Falha no último item/evento desfaz todo o lote e seus consumos; intenção anterior não consumida continua identificável para recuperação autorizada.
- Revogação/empresa trocada/misto após espera falham antes replay e escrita; testa concorrência real apenas se ambiente nativo estiver disponível.
- Recebimentos, cancelamentos, custo versionado, acerto e fechamento mantêm provas antigas. Comparar snapshots/revisões anteriores e readiness antes/depois.
- Nenhuma alteração monetária decorrente apenas de upload; nenhuma exposição de original; falha de imagem permanece quarentena.
