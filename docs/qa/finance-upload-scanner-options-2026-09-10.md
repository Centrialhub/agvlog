# Scanner de uploads — proveniência e opções executáveis — 2026-09-10

Revisão apenas. Nenhuma alteração de segurança, serviço contratado, arquivo de cliente enviado, secret configurado, deploy ou teste remoto.

## De onde veio a exigência

A função scannerAccepts e as variáveis MALWARE_SCANNER_URL/TOKEN já constam no commit9bc0ce86 (“consolidate production readiness hardening”,2026-08-28), em secure-upload/index.ts. Portanto antecedem o briefing financeiro atual.

O plano versionado production-readiness-development-plan-2026-08-28.md,PR032, pede “Integrar varredura antimalware ou quarentena se documentos externos forem aceitos”. O runbook de produção:item8 e a release-readiness-matrix:PR032 concretizaram isso como scanner HTTPS obrigatório/fail-closed. A matriz de release marca scanner/EICAR real como pendente.

Não localizei instrução explícita do usuário exigindo contratação de scanner externo nem skill impondo esse desenho específico. É decisão/contrato da implementação e documentação de release, não requisito nativo Supabase. Também não é o “scanner” de câmera/corte do canhoto: são recursos diferentes. O histórico Git prova quando o código apareceu, não permite atribuir sua decisão a uma pessoa ou a instrução externa não registrada.

O requisito pode ser redesenhado com quarentena/validação real, coerente com PR032, mas não removido fingindo resultado antimalware. Não usar “o cliente precisa ter scanner” como única saída: é uma dependência de implantação que o produto assumiu sem disponibilizar o serviço.

## Contrato atual e alcance

secure-upload/index.ts:85–104 exige endpointHTTPS+Bearer, POSTmultipart “file”, redirecionamento proibido, timeout20s e resposta JSON clean===true. Sem configuração/HTTPOK retorna indisponível; caso clean ausente/false, arquivo não é armazenado. Não existe engine real dentro do gateway.

Há limite10MiB e10uploads/min/ator. Antes do envio são verificados tenant/papel/path/assinatura; financeiro tem can_access adicional. ExpenseReceipt possui prova persistida scanned:true e reutiliza objeto confirmado por hash; não se pode preencher esse campo sem varredura. Originais de extrato são preservados byte a byte por hash, não reescritos.

Tipos reais mais amplos que jpg/png/pdf/ofx/csv/xlsx: JPEG,PNG,WebP,HEIC/HEIF,PDF,XML (contextofinancial),OFX,CSV,XLS eXLSX (extratos). Cabeçalhos MIME/magic são classificação inicial, NÃO prova de segurança: PDF sóprefixo, XLSX sóZIPmagic, XLS sóOLEmagic; OFX tem prefixo; CSVUTF8controle/delimitador. O parser financeiro subsequente não equivale a antimalware. Reduzir formatos mudaria contrato e precisa UI clara.

uploadPolicy.test.ts tem checks de conteúdo e presença textual da exigência; expenseReceiptGateway.test.ts simula indisponível/malware/proveniência. Esses testes verificam fail-closed, não detecção real. Não há scanner implementado, imagem/container/infra ou ensaio EICAR hospedado comprovado nesta revisão.

## Opção A — menor mudança para TODOS os formatos: serviço ClamAV controlado pela implantação

Recomendação para preservar o comportamento completo já construído: fornecer o serviço que falta, em vez de exigir que o cliente o tivesse previamente.

Implementação concreta a preparar em diretório próprio:
- Container com ClamAV/clamd e atualização freshclam; wrapper HTTP pequeno aceitando exatamente o multipart atual.
- EndpointHTTPS autenticado por Bearer próprio, limite10MiB aplicado em streaming, concorrência limitada; repassar bytes a clamd INSTREAM (socket privado), não executar o arquivo nem montar diretório público.
- Retornar clean:true SOMENTE após resultadoOK da engine; infecção=>clean:false; timeout/erro/limite de expansão/formato criptografado não inspecionável=>indisponível/rejeição explícita, nunca “limpo”.
- Limites de arquivo/arquivo expandido/recursão e timeout da engine alinhados ao gateway20s; health/readiness exige assinaturas carregadas e atualizadas; refresh e falta de assinatura não podem liberar upload.
- Sem log de conteúdo/nomePII; registrar hash, tamanho, versãoengine/assinaturas, status/correlação; apagar temporários.
- Pacote de implantação com imagem pinada e testes de integração; não existe ainda no repo.

Hospedagem necessária: container/VM com aproximadamente4GiBRAM, CPU, armazenamento de assinaturas e HTTPS. ClamAV é livre, mas compute/disco/egress/observabilidade têm custo. Não há cobrança externa já autorizada/infra detectada por esta revisão; destino e responsável por faturamento são lacunas reais. Cloud Run é uma opção técnica de container com memória configurável, mas requer projeto/billing e estratégia de warm instance/atualizações; não foi criado. VM/container persistente simplifica assinaturas e latência. Supabase/Vercel atuais não fornecem automaticamente esse daemon.

A documentação oficial ClamAV recomenda3GiB mínimo/4GiB preferido e descreve custos de memória da recarga de assinaturas. [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html). A conclusão de inadequação ao Edge é uma inferência desses requisitos versus os limites oficiais:256MBRAM e2sCPU por requisição. [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits).

Critério de conclusão: upload autorizado de cada tipo real, EICAR rejeitado, timeout/assinatura ausente bloqueados, ZIPbomb/criptografado não rotulado limpo, endpoint semtoken negado, malware nunca promove objeto, hashfinanceirooriginal preservado e retomada idempotente funcionando. AV reduz risco, não prova ausência absoluta de todo malware.

## Opção B — sem novo provedor agora: quarentena real no Supabase, com liberação limitada

É alternativa técnica prevista pelo planoPR032; NÃO é troca de scannerAccepts por validação superficial. Requer nova implementação coordenada:

1. Bucket privado separado de quarentena, sem SELECT/download/signedURL para usuários e sem políticas dos buckets atuais. Gateway mantém auth/quota/path/hash e grava pending; não usa receipt_path final nem scanned:true. Ledger de arquivo identifica tenant/ator/hash/tipo/status/método/política.
2. Nenhum e-mail/PDF/preview/OCR/parser arbitrário deve consumir automaticamente o original em quarentena. Clientes recebem “recebido, aguardando verificação”, não comprovante confirmado.
3. Para textoOFX/CSV, parser estrito com limites totais/linhas/campos/complexidade, semDOCTYPE/entidades externas nem fórmulas avaliadas. Produzir dados normalizados inertes para a conciliação; original fica preservado/inacessível até liberação própria. Células CSV perigosas precisam escaping ao EXPORTAR para planilha; não alterar o original probatório.
4. Para imagens JPEG/PNG/WebP, estudar decode/reencode controlado emWASM, dimensões/pixels/memória limitados, semmetadados; liberar apenas DERIVADO com hash distinto, preservar original comoquarentena. Isso é reconstrução de conteúdo, não “scanlimpo”; precisa ensaio com fotos reais e2sCPU. HEIC/HEIF amplia codecs e pode permanecer pendente.
5. PDF/XLS/XLSX/XML arbitrários não têm substituto local simples e já homologado. PDF pode conter conteúdoativo/anexos; XLS/XLSX envolvem containers, relações externas/embeddings/expansão; é preciso parser/CDR próprio validado ou scanner externo. Mantê-los pendentes é honesto, mas limita uso imediato. Não considerar remover JavaScript porregex ou sóZIPmagic como sanitização.
6. Atualizar os contratos de evidência de despesas/extratos/motorista: estadoquarentena não pode ser confundido com scanned:true ou verificationpassed. Downloadsoriginais/exporte-mail devem exigir promoção; revisão humana de saldo não substitui análise de arquivo.
7. Adicionar fila/retomada/auditoria/expiração controlada; promoção idempotente vincula exatamente hashresultado/método. Storagequarentena cobraarmazenamento e processamento dentro da contaSupabase existente, não é semcusto.

Supabase suportaWASM e exemplifica manipulação de imagem; isso habilita prova de conceito de derivados, não garante engine AV nem performance para10MiB. [Supabase WASM](https://supabase.com/docs/guides/functions/wasm). Sharp/libvips multithread não são suportados no Edge, conforme [limites](https://supabase.com/docs/guides/functions/limits). Buckets privados e downloads autorizados são mecanismos disponíveis; precisam policies realmente fechadas, pois signedURL concedida antes da aprovação contornaria a quarentena. [Storage downloads](https://supabase.com/docs/guides/storage/serving/downloads).

Esta opção permite RECEBER documentos sem serviço externo, mas sozinha não entrega uso imediato completo dos PDFs/planilhas nem consulta do original. É mais mudança de produto que fornecer endpointClamAV e não deve ser vendida como desbloqueio completo em uma configuração.

## Caminho de decisão concreto

Para o objetivo “financeiro completo usável” e preservação deoriginais, A é a menor mudança no produto: implementar wrapper/container e disponibilizarcomputeHTTPScomassinaturas. Lacuna não é Supabase secret emsi: falta um serviço real e seu host/billing. O código atual já possui contrato de integração.

Se não houver disponibilidade para infraestrutura adicional, B é o caminhoSupabase-only legítimo, começando por intakequarentena e dadosOFX/CSV validados, com PDF/XLSX claramentependentes. Não prometer equivalência imediata entreB eA. Uma terceira API comercial de scanning também exige contrato/billing/transmissão de documentos; não foi recomendada nominalmente nem contratada.

A [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) trata defesa em camadas, AV/sandbox eCDR conforme o tipo; não afirma que checkMIME basta. A obrigatoriedade de endpoint externo é do nosso desenho, não uma regra universal de Supabase ouOWASP.

## Billing de exemplo, sem contratação

Cloud Run permite memória configurável e modalidades de cobrança porrequisição/instância. Engine persistente/atualização de assinaturas requer planejamento de CPUfora de requisições, mínimoinstâncias/coldstart e limite deconcorrência; custo não foi cotado porque não há projeto/região/tráfego definidos. [Memória](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits), [billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings). Não basta implantar container com defaults e garantir20s no primeiro scan.
