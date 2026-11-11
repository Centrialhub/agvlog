# Log de release — preparação OpenAI para canhotos

## Autorização e estado anterior

Pedido do usuário: preparar tudo para receber a chave da API, sem ativar gasto
antes da configuração/teste. Checkout isolado C:/Users/Budinha Yamaguti/Downloads/
AGV CANHOTOS OPENAI, base ab1ebaf8889b938369ebadac16b6d7e993515082.
AGVLog qcvnsdrbcchaxvawcngk; ledger947/max20261111165518; fila OCR vazia;
worker_config.enabled=false/worker_url=NULL. Função Edge v15 verify_jwt=false,
bundle f8b24792ce58b9c1aa3210f3479ca01edb9a4d0e10b24bda788703bc4a3c3ec4.
Fontes completas recuperadas em edge-source-snapshots-2026-11-11-receipt-v15.
MD5 anterior complete_delivery_receipt_ocr_v2:1d540f863b6482af1e88f423d2bb7a78.

## Contrato

Novo adapter OpenAI com endpoint HTTPS fixo /v1/responses, redirects negados,
store=false, saída JSON Schema estrita e validação local adicional. Isso não
afirma zero retenção pelo provedor. Só envia bytes privados do canhoto já
validado por hash/lease, nunca URL pública, XML completo ou sessão do usuário.
Máximo3MiB/image jpeg/png/webp, timeout25s, saída2500tokens, nenhuma repetição
automática da chamada paga. Modo inicial gpt-6-luna, reasoning none; qualidade
real de escrita manual ainda requer amostra/teste após chave. Modelos antigos
4.1-mini/5-mini estavam marcados deprecated na documentação consultada.

OPENAI_API_KEY somente em Secrets; OPENAI_RECEIPT_OCR_MODEL opcional. Provedor
selecionado por DELIVERY_RECEIPT_OCR_ADAPTER=openai. Sem chave: zero claims,
downloads, chamadas pagas ou confirmações. Sem fallback inesperado ao Lovable.
Uso agregado de requests/input_tokens/output_tokens aparece em self_test e logs
do worker, sem texto/imagem/chave. Requests não equivalem a cobrança confirmada.

Forward incremental altera somente a allowlist de proveniência lovable/openai
em complete_delivery_receipt_ocr_v2. Assinatura/ACL service_role, tenant, lease,
hash, conflito/repetição, auditoria e revisão permanecem. Nenhuma substituição
de delivered_at, validação de comprovante ou autenticação de assinatura.
Assinatura é apenas presença visual; nomes/identidade não são reconhecidos.
Leitura incerta/ilegível exige revisão. Frontend/baixa offline inalterados.

## Validação e publicação

Fixtures de transporte para auth privada, ausência de chave, quota/rate limit,
timeouts, refusals/incomplete, JSON inválido, segredo em erro, imagem inválida,
proveniência, uso agregado e self_test com duas imagens sintéticas sem writes.
SQL nativo PGlite executa o forward e persiste resultados OpenAI/Lovable,
incluindo repetição, conflito, hash obsoleto, ACL e data original preservada.
Fixture parcial não simula Auth/Storage de rede; PG17 isolado valida providers
e ACL na função real antes do lint/pgTAP/E2E. Sem testes em entregas produtivas.
Quality completo exigido no SHA final antes de aplicar exclusivamente este SQL
revisado e publicar somente o bundle afetado, comparando todos os módulos.
Nenhum db push, reparo de ledger, migração histórica ou manifesto congelado.

Depois: preparar campo OPENAI_API_KEY vazio para entrada pelo usuário. A regra
do navegador exige usuário inserir/salvar credencial nova. Não pedir chave no
chat. Não criar assinatura paga, aceitar termos ou alterar cobrança. Scheduler
continua desativado; testar somente imagens sintéticas após chave+saldo. Envio
automático de canhotos reais fica para ativação posterior explicitamente autorizada.

## Retorno e limites

Desativar adapter antes de restaurar bundle anterior preservado. Manter o SQL
aditivo para resultados OpenAI já persistidos continuarem válidos; não restaurar
o validador lovable-only. Não apagar resultados/jobs/leases/cooldowns. O leitor
existente continua interpretando o mesmo formato. Lovable permanece opção
explícita; não usar fallback pago automático. Chave ausente é pendência esperada.

## Fontes e evidências

Documentação oficial consultada: https://developers.openai.com/api/docs/models/gpt-6-luna,
https://developers.openai.com/api/docs/guides/images-vision e
https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses .
SHAs, gate completo, ledger, bundle, alias e configuração finais serão registrados
no PR; não declarar leitura real funcionando enquanto chave/teste forem pendentes.
