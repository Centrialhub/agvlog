# Ponte financeira de artefatos de extrato v2 —11/09/2026

Local, não aplicada. Depende40123. Migração41340 SHA256 `9224c3bc025b3cfa6340f530c0334cba3dd90158a54283da5e6b84b1e4587d7a`.

## Entradas e evidência

`intake_finance_statement_artifact(_payload jsonb)` authenticated recebe o contrato usual de intake, mas version2 e artifact_id obrigatório. file_hash é o SHA256 ORIGINAL; source_path é o caminho JSON DERIVADO. parser_version permanece native-ofx-v1 para OFX e mapped-csv-v1 para CSV. mapping/rows/período/razão continuam explícitos. Fonte deve ser bank_account com exatamente a conta escolhida, empresa ativa, estado validated_data e bytesStorageconfirmados por metadados imutáveis. Não existe upload original em finance-statements criado pela ponte.

Retorno financeiro preserva v1 usual `{version:1,tenant_id,request_id,import_id,counts,source_verification:'pending',confirmed:true}`. Nenhum saldo/movimento é criado pelo intake. Identidade bancária/dedup e todos os triggers de fechamento existentes continuam executados. Source verification continua pending até worker próprio.

`inspect_finance_statement_source` existente devolve source_snapshotStorageDERIVADO com campoartifact:
`{version:2,artifact_id,tenant_id,source_type:'bank_account',source_id,original:{sha256,size_bytes,format},derivative:{bucket,path,sha256,size_bytes,mime,method,financial_mapping_required},state,validated_at}`.
Não há caminho/URLoriginal no snapshot. O ator do upload permanece na tabela de artefatos e eventos; um colega autorizado pode conferir o extrato.

## Verificação

Caller autenticado usa `authorize_finance_statement_artifact_verification(_tenant_id,_import_id)` após checar acesso. Retorna `{version:2,authorization_id,expires_at,artifact_id}` com validade120s, ator atual, import/artifact vinculados e revisão de autoridade igual40123. Service não renova.

Worker service usa `record_finance_statement_artifact_verification(_payload,_authorization_id)`. Payload financeiro normal, reader_version `statement-artifact-v2`. Authorization_id é argumento separado para permitir replay de payloaddurável igual com nova autorização, sem adulterar o primeiro registro. Exige tenant/ator/import da autorização, mesmo artifact/hashoriginal/hashderivado/path, membership atual e gate não alterado.

Report adicional obrigatório:
`{artifact_id,original_sha256,derivative_sha256,derivative_hash_verified,original_reopened:false,validation_method}`.
Os SHA são as identidades esperadas; falha de bytes pode incluiractual_derivative_hash e outcomeunreadable. rows_match/rows_mismatch exigem derivative_hash_verifiedtrue. O worker baixa apenas upload-validatedJSON, verifica seu hash, interpreta a forma normalizada e compara as linhas, preservando native_evidence ou mapeamentoCSV. `hash_verified:true` emrows_match significa cadeia original→validação→derivado conferida, não original relido; original_reopenedfalse é exigido e texto de auditoria identifica o derivado.

SQL não executa parser e não compara bytesS3; essa responsabilidade é do worker service confiável. Não produzir um reportverdadeiro a partir de dados do browser sem o processamento. CSV pode importar linhas mapeadas, mas ainda exige comparação contra matrizvalidada e não comprova cobertura/exatidão de identidade bancária automaticamente.

## Preservação de contratos

A ponte copia corpos EFETIVOS revisados para novas funções, com guardapg_get_functiondefMD5+ACL+searchpath. Intake predecessor `c8756c63d59d2d5a533e344f9ebd50f9`; verifier `073ca108bfb00c0e82b7539864e14b79`. Este último inclui142923 reauth real. Os originaisv1 não são redefinidos. Corev2deverificação não recebe grantservice direto; sódispatcher com autorização de uso concede o caminho.

Novos metadados são privados e append-only. As baselines de correção monetária existentes não foram atualizadas para mascarar deriva:40123+41340 deixam runtime190516 exatamenteigual e191905baselinevalidtrue no teste integrado.

## Evidência e próximo bloqueio

10PGlite passaram01:20:37local, lint0, em uploadQuarantineDatabase.test.ts. Inclui todasasprovas40123 e intake+verificaçãoOFX, CSVmapeado ainda semverificação automática, parserinvertidonegado, contaerradanegada, original_reopenedtrue recusado, colega autorizado confere mantendo atororiginal,1entrada e0movimentos. Fixture tem writers/triggers financeiros reais e metadadosStorage de teste; não é envio de bytes ao Storage remoto nem ensaioEdgeCPU/URL.

Client/Edge deve escolher RPCv2 explicitamente e branch de verificação pelo source_snapshot.artifact.version. Não enviar pathJSON aos endpointsv1. AgenteEdge recebeu o contrato e implementa os respectivos branches. Não foi feita aplicação remota/deploy por este agente.

Comprovantes de imagem continuam dependendo do sanitizadorhosted e ponte de evidência da despesa.40123 rejeita estado sanitized_derivative55000 até habilitação revisada. Nenhum scannedtrue é produzido, e nenhum sucesso de recibo de imagem é alegado nesta entrega de extratos.
