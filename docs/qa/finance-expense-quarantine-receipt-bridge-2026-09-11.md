# Comprovantes por artefato — vínculo, habilitação e pendências

Entrega local revisável de 11/09/2026. O responsável pela produção controla aplicação/deploy; este agente não aplicou estas migrações.

| Migração CLI | SHA256 |
|---|---|
|20260911042754_finance_expense_quarantine_receipt_links|99455bdef68f867c3712b0c5a5b4c8a70abc0b920c345ef94ba3a7f7642b7071|
|20260911044437_finance_enable_reviewed_image_derivatives|42ebd89e46c5dab9bfa9a07264f15e3ac7857b4b85eceace1a5b5bc65a938c29|
|20260911044823_finance_expense_receipt_artifact_status|9a387d68419fb46798ffe1864cac78a57b6b8907e41ae3f34fc1e099b3bbf01d|

## Escopo

Reserva v2 aceita source_type expense_item com source_id de finance_expense_items existente na mesma empresa. Cobre gastos office/personnel/trip já registrados; não inventa folha ou título. Trip/settlement/bank_account anteriores continuam válidos. Não cobre anexo diretamente a folha sem gasto canônico.

42754 exige corpo/ACL/search_path exatos do resolvedor40123; vínculos são privados append-only. Nenhum receipt_path ou no_receipt_reason é reescrito. Nenhum payable, custo, descarga, movimento ou snapshot de acerto fechado é alterado.

## Contratos

Authenticated `attach_finance_expense_receipt_artifact(_payload)` recebe `{version:2,tenant_id,request_id,expense_id,artifact_id,reason}` e retorna `{version:2,tenant_id,expense_id,link_id,artifact_id,request_id,confirmed:true}`.

Exige acesso financeiro/empresa ativa, trava finance/membership/driver, reautoriza antes de replay, trava gasto/artefato NOWAIT. Mesmo pedido exige ator/gasto/artefato/motivo iguais; conflitos de locks40001. Insere vínculo e evento atomicamente.

Authenticated `get_finance_expense_receipt_artifacts(_tenant_id,_expense_id)` retorna `{version:2,tenant_id,expense_id,receipts:[{link_id,artifact_id,actor_id,request_id,reason,created_at,evidence:UploadArtifactDTO}]}`. Evidence é o DTO seguro congelado, sem ticket/original_path/URL. Edge renova get_finance_upload_artifact para autorizar URL somente do derivado.

## Sanitizador habilitado por44437

Precondição: finalize40123 prosrcMD5 `9301b31ff6420953d3e535a79670e065`, definer/search_path vazio e grant somente service/owner. Patch substitui apenas a rejeição anterior de sanitized_derivative por método jpeg-png-reencode-v1, formatos JPEG/PNG e original/derivado <=5MiB. Demais controles de ticket, gate revision, membership, objetos, hashes, replay e auditoria permanecem.

Derivados: tenant/request/validated.jpg ou .png, MIME correspondente, financial_mapping_requiredfalse. Não há scanned:true nem atestado antivírus. Sanitização defeituosa/fora de recursos permanece em quarentena sem derivado liberado.

Autorização para preparar este enable veio após os14 ensaios hospedados registrados em `finance-image-hosted-benchmark-2026-09-11.json`: PNG/JPEG pequenos e JPEG1,92MP passaram; PNG1,92MP e ambos2MP foram recusados por recursos, e negativos de formato/CRC/trailer/APNG/dimensões foram recusados. Limite2MP é teto de entrada, não garantia de sucesso. Nenhum limite de CPU/memória foi afrouxado.

## Consumidores de comprovação

44823 guarda list_expenses175733 por prosrcMD5 `b25cd595584cab6b6ff8b4441157abd2`, ACL/path, e adapta somente filtro missing_receipt e missing_receipt_count. Campo adicional por linha receipt_artifact_count conta vínculos cuja evidência ainda coincide com artefato e objeto preservados. Artefato meramente finalizado, sem anexação ao gasto, não remove pendência.

Busca concreta dos consumidores SQL encontrou o predicate de ausência de recibo canônico em list_expenses. canonical_trip_costs134948 inclui receipt_path/no_receipt_reason apenas como metadata congelada; não há gate de fechamento por ausência desse recibo canônico. Não alteramos metadata histórica para parecer que o comprovante já existia antes. accountPeriodEvidenceIndex consulta recibos de movimentos/origens monetárias: anexo de gasto não serve automaticamente como recibo do movimento. Esses snapshots conservam sua semântica e a nova evidência é consultável separadamente.

UI/cliente precisam incorporar reader e receipt_artifact_count (agente Edge/UI informado). Não há promessa de conclusão de todas as telas, anexação direta de folha, manual_expense ou recibo de movimento nesta ponte.

## Provas locais

`expenseReceiptArtifactDatabase.test.ts`:6 PGlite passaram01:50:44, lint0. Writers reais record_finance_expense_batch e finalize, attach e list_finance_expenses; DDL real cost_centers foi adicionado à fixture reduzida para o reader. Casos:
- gasto office/personnel existente, fonte inexistente, crosscompany/mixed, ACL, recusa de anexo ainda em quarentena;
- predecessor modificado rejeita instalação atomicamente;
- PNG/JPEG finalize→attach→replay com eventos/IDs exatos, originais invisíveis e custo/caminhos preservados;
- método/hash/tamanho inválidos e revogação impedem promoção;
- missing_receipt_count1→0 e filtro deixa de listar o gasto somente depois de anexar; total1000 e justificativa original permanecem;
- runtime190516 inalterado; nenhum rebaseline de proteção monetária.

Callbacks usam SHA/tamanho dos originais `infra/upload-validation-bench/fixtures/1x1.png` e `.jpg` e hash/tamanho/MIME derivados observados no ensaio hospedado. Fixtures inserem metadata em storage.objects; **não são upload Storage real ou PostgreSQL nativo**. Estado sanitized é produzido pelo finalize real, nunca por UPDATE de fixture. O decode hospedado é evidência separada do root.

`uploadQuarantineDatabase.test.ts`:10 passaram01:50:15; inclui nova asserção de que inspect.revision não muda ao gravar verificação e replay com mesmo payload funciona. Nenhum TSC/PGnativo/DDLremoto/deploy executado por este agente.
