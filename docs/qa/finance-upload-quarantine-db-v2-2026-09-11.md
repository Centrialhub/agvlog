# Quarentena financeira Supabase — contrato DBv2

2026-09-11. Migração local40123, não aplicada. Novos schemas/buckets; não redefine funções de autorização/storage anteriores. Nenhum atestado antivírus.

## RPCs e autorização

- `reserve_finance_upload_artifact(_payload jsonb)`: authenticated. Payload exato `{version:2,tenant_id,request_id,source_type,source_id,original_sha256,size_bytes,declared_mime,format}`. source_type=trip|settlement|bank_account; fonte deve existir na mesma empresa (conta ativa). format=ofx|csv|jpeg|png|pdf|xls|xlsx|unknown. SHA256 minúsculo64hex, original1..10MiB. Ator auth.uid e workspace reais; can_access e exclusão motorista/misto. Mesmo tenant/request exige toda identidade igual. Não autoriza despesa/importação em si.
- `prepare_finance_upload_artifact(_artifact_id uuid,_tenant_id uuid,_actor_id uuid,_sha256 text,_size_bytes bigint)`: somente service_role. Exige correspondência integral com reserva. Retorna `{version:2,artifact_id,ticket,original_bucket,original_path,derived_bucket,derived_prefix,expires_at,result:DTO}`.
- `finalize_finance_upload_artifact(_payload jsonb)`: somente service_role. Payload exato `{version:2,artifact_id,ticket,state,method,derivative,issues}`. Não aceita ator/tenant/pathoriginal/flagscanned trocados. Confere objeto e user_metadata do Storage, tamanho/MIME e identidade original/derivada. RetornaDTO.
- `get_finance_upload_artifact(_tenant_id uuid,_artifact_id uuid)`: authenticated, somente DTO seguro da empresa ativa autorizada.

Reserva authenticated vale120s. Prepare/finalize não renovam. Captura hashes de definição/ACL/proprietário de can_access,not_driver,request_tenant_id,is_request_tenant_member; drift/pausa do gate invalida autorização. Service revalida membership atual, ausência motorista/misto, ator existente e fonte; trava membership/drivers compartilhadoNOWAIT sob travafinance. Não usa GUC de impersonation. Expiração/revogação exige nova reserva authenticated, nunca renovação service autônoma.

## DTO público

`{version:2,tenant_id,actor_id,request_id,artifact_id,source_type,source_id,state,original:{sha256,size_bytes,format,received},usable,derivative,issues}`.

Nunca inclui ticket, caminho original ou URL original. `received=false` na reserva ainda sem finalização; `quarantined` não significa upload já confirmado. Derivative null ou `{bucket,path,sha256,size_bytes,mime,method,financial_mapping_required}`. Caminho não é URL pública.

## Bytes e finalização

Original `upload-quarantine/{tenant}/{request}/original`; imutável. Derivado `upload-validated/{tenant}/{request}/validated.json`. Ambos privados. Metadata Storage de original:
`{version:2,artifact_id,sha256,size_bytes,kind:'quarantine_original'}` em user_metadata; metadatadosistema size deve coincidir. Derivado acrescenta original_sha256 e kind validated_derivative, além de hash/tamanho próprios; metadatadosistema size/mimetype conferidos.

Métodos liberados na primeira fatia:
- OFX→JSON, validated_data, native-ofx-v1, financial_mapping_requiredfalse.
- CSV→matrizJSON, validated_data, strict-csv-matrix-v1, financial_mapping_requiredtrue.

Parser não comprova autenticidade bancária. Usable indica derivado de dados estruturalmente validado, não importação/reconciliação aprovada. A verificação de bytes ocorre no Edge confiável; SQL confere identidade/metadata, não lê o conteúdoS3 e não atesta que metadata equivale a uma varredura.

Sanitized_derivative rejeita55000 até habilitar sanitizador de imagem revisado em ensaio Edge. PDF/XLS/XLSX/formatosdesconhecidos permanecem sem derivado. Estados finais rejeitado/validado não podem ser sobrescritos. Quarantined/validation_failed podem ser tentados novamente após reserve authenticated igual, rotacionando ticket e preservando os eventos de falha anteriores. Mesmo finalize retorna replay exato. Erro/perda de resposta não autoriza overwrite; Edge deve comparar a identidade do objeto existente.

## Storage e leitores

Novas policies negam todo acesso browser ao original, independentemente de permissivas anteriores. Não há função pública que retorne signedURL original. Derivado só admiteSELECT quando registrofinal usable e empresa ativa/can_access; writesbrowser negados. Trigger novo impede UPDATE/DELETE dos dois buckets, inclusive overwriteviaowner/serviceSQL. Artifacts/events são privados sem grants diretos; eventos append-only.

Service_role é fronteira confiável do Storage: SQL não impede o backend privilegiado de criar uma signedURL por conta própria. O handler/qualquer rota service de download deve negar bucketupload-quarantine; o contrato exige isso e os testesDB não alegam provar um endpointEdge. Bucketprivado/RLS não revoga URLs já emitidas por serviço. Não existe endpoint de URL nesta migração; Edge só poderá assinar derivado após getRPC autenticado e igualdade de path/hash. Quotas existentes devem ser verificadas antes reserve/PUT; este schema não substitui o rate-limit do uploader.

## Compatibilidade e próximas integrações

Nenhum scannedtrue. Não reutilizar path upload-validated em writers v1. A ponte de extratos 20260911041340 já implementa intake por artifact_id, identidade original preservada e verificação do derivado JSON; contrato e limites em finance-quarantine-statement-artifact-bridge-2026-09-11.md. OFX e CSV percorrem writers reais nos testes locais. PDF e imagens permanecem pendentes; anexação de comprovantes a despesas ainda requer vínculo explícito e leitores conscientes do bucket v2, além da liberação revisada do sanitizador hospedado.

## Evidência local

`src/test/uploadQuarantineDatabase.test.ts`:10 PGlite passaram 01:20:37 local, lint0 (incluindo ponte de extratos). Fixture deriva de createPublicManualMovementVoidDatabase e instala helpers reais de contexto ausentes, mais user_metadata/grantsStorage para exercitarRLS. Provas: baseline190516runtime exatamenteigualantes/depois e191905validtrue; reserva/prepare/finalize reais; replay; originais invisíveis/imutáveis; derivado condicionado; service/authACL; crosscompany/mixed/revogação; expiração+renovação; driftACL; originalSHA diferenteconflito; falso scannedtrue rejeitado; falha→renovação→sucesso com2eventos preservados; PDFnão liberado; restrictive vence permissiva.

Objetos de teste são linhasstorage.objects com metadados declarados, não bytes enviados ao serviço remoto. Nenhuma prova decodec/CPUEdge/assinaturaURL/nativa concorrente nesta suíte. NenhumPostgreSQLnativo/TSC/DDLremoto/deploy executado.
