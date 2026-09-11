# Contrato proposto — uploads somente Supabase

2026-09-11. PR032 original (`docs/production-readiness-development-plan-2026-08-28.md:240`) permite antimalware OU quarentena. Usuário escolheu infraestrutura Supabase; não haverá serviço externo. Proposta para coordenação antes de editar fluxo Edge/DB.

## Identidade, objetos e estados

Pedido autenticado: version2,tenant_id,request_id,source_type/source_id,bucket lógico,file. Actor obtido do JWT verificado+workspaceativo, nunca confiado em payload. Limite máximo original10MiB e quota existente. HashSHA256 calculado no servidor sobre bytes recebidos.

Bucket físico NOVO sugerido `upload-quarantine`, privado, sem SELECT/UPDATE/DELETE/INSERT de browser. Somente Edge autenticado com service backend autorizado pelo RPC pode gravar. Original em `{tenant_id}/{request_id}/original` (extensão/tipo somente metadados), nunca overwrite. Sem URL assinada/download de original nem uso de path em envio/email/OCR/browser. Controle se aplica a TODOS leitores de evidência, não apenas secure-upload.

Registro DB auditável, sugestão `secure_upload_artifacts`: tenant/actor/request/source, original_path/hash/size/declaredmime/detectedformat, state, validation_method/version, derived_path/hash/mime/size, issues, created_at/validated_at. Payloadhash permite replay exato e rejeita outro arquivo no mesmo request. Persistência objeto/DB não é atômica: reservar identidade antesPUT, finalizar com hash, compensação/retry registradas. Bank define nomesSQL finais; não criar migração sem acordo.

Estados fechados: `quarantined` (original recebido; uso bloqueado), `validated_data` (OFX/CSV normalizados aceitos), `sanitized_derivative` (JPEG/PNG gerado pelo servidor), `rejected` (inválido/limite), `validation_failed` (falha técnica; original continua inacessível). Não usar clean/scanned:true, nem mapear todoHTTP200 para arquivo utilizável.

Resposta v2: request/tenant/actor/artifact_id,state,original:{sha256,size_bytes,format} SEMpathdownload,usable:boolean,derivative:null|{path,sha256,size_bytes,mime,method},issues. Derivado em bucket privado de destino `{tenant}/{request}/validated.<csv|json|jpg|png>`; RPC de autorização de leitura deve exigir estado final+hash+tenant. Original preservado é evidência imutável restrita, derivado é outra identidade e nunca substitui silenciosamente hash original.

## Processamento e UX por formato

- OFX/CSV: parser de texto estrito no Edge, limitesbytes/linhas/célula/profundidade/tempo, charset admitido explícito, datas/valores/conta normalizados; nada executa código, entidadesDTD/externas/XMLprolog perigoso não permitido. CSV pode conter texto de fórmula como dado; exportação posterior precisa neutralização e não copiar original para Excel. Saída JSON canônica para pipeline de extratos existente, ligada ao hash original; parse não comprova autenticidade bancária. Não injetar conteúdo em HTML/URL.
- JPEG/PNG: conferir assinatura, dimensões/pixels/frames antesdecode; apenas codecs necessários, primeira imagem estática, orientação explícita, remover EXIF/perfis/comentários, gerar JPEG/PNG novo noWASM. Começar conservador<=5MiB e limitepixels a determinar em benchmark. Timeout/erro/bomba mantémquarentena. Não aceitarSVG/HTML/HEIC/WebP pelo fallback de MIME. Derivado pode ser visto/usado como comprovante com método de sanitização declarado; não chamar antivírus.
- PDF/XLS/XLSX: guardarquarentena, não retornar signedURL nem original em anexos/email. PDF não fica seguro por remover stringsJS comregex. RasterizaçãoPDF/expansãoZIPsó após pipeline isolado validado dentroCPU/memória; indisponível nesta primeirafatia. UI permite registrar gasto com comprovante pendente conforme regras do domínio, sem marcar comprovante validado nem fechar pendência. Para extrato oferecer OFX/CSV; para comprovante oferecerJPEG/PNG.

## Contratos existentes a migrar conscientemente

secure-upload scannerAccepts atualmente exigeHTTPS externo e clean=true. expense-receipt.ts gera scanned:true e writer de evidência exige isso. Não trocar essa flag por uma mentira: novo método/versão precisa ser aceito no DTO/SQL de evidência e nos leitores de retenção. statement-original, financial-upload-policy, secureUpload.ts, importador de extratos, driver/POD/email/OCR têm consumidores: fasefinanceira deve ser explicitamente roteada; outrosuploads preservam políticaanterior até teremquarentena/derivado equivalente. Bank/root coordenam transiçãoSQL/Edge/client. Paths existentes originais não tornam-se liberados por retrofit semverificação.

## Restrições oficiais e aceite

[EdgeLimits](https://supabase.com/docs/guides/functions/limits):256MB/2sCPU,150sFree ou400spago de duração; mais plano não concede4GiB. ClamAVcontainer configurado4GiB não cabe. WASM é suportado, não remove esseslimites e não transforma parser emAV. [WASM](https://supabase.com/docs/guides/functions/wasm). [Exemplooficial magick-wasm](https://supabase.com/docs/guides/functions/examples/image-manipulation) avisa processamento/imagens>5MB podeexcederrecursos. Validar latência/RSS/CPU comfixtures sintéticas e imagemlimite, não alegar produção combenchmarkNode.

[Storageprivado](https://supabase.com/docs/guides/storage/buckets/fundamentals):privado permite download viaRLS ouURLassinada; logo mero private=true não é quarentena suficiente. Precisamos negar original emtodosreaders, e revisar policies/Edgehelpers. Nenhuma documentação consultada apresenta AVnativo hospedado Supabase; Deno/WASM são runtime, não atestado de malware.

Aceite mínimo: isolamentoAGV/LIRA/driver/misto; replaymesmoSHA; tentativa sobreescreverrejeitada; originalnãolegívelJWT/signurl; parsermalformado/entidade/ZIP/bomba não libera; imagensreencode comhashdistinto/metadados removidos; erroCPUquarentena; perdaresposta recuperável; nenhumreceipt scanned:truefalso. EICAR/texto não deve ser usado como suposta provaAVneste pipeline. Storage/Edge quotas atuais continuam sendo consumidas, sem custo de hostexterno.
