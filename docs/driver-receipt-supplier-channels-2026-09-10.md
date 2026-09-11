# Canais de canhoto por fornecedor — fundação P2

## Estado desta entrega

Esta implementação é somente local. Nenhuma migração ou Edge Function foi implantada e nenhuma chamada foi feita a um portal de fornecedor.

O envio por e-mail existente continua independente e operacional. Os templates de e-mail agora recebem versão e o lote preserva um snapshot imutável do template, indicando quando destinatários, assunto, corpo ou capa foram personalizados antes do envio.

Antes de criar lotes, o backend lê o tamanho real de cada PDF no metadata do Storage. O plano é determinístico pela identidade do canhoto e respeita simultaneamente cinco PDFs por mensagem, 5 MiB por PDF e 25 MiB no payload de anexos. O cálculo do payload inclui a expansão Base64 e uma reserva de 512 KiB por capa configurável. O mesmo limite é revalidado no gatilho de criação do lote e, após gerar a capa, a Edge Function mede o Base64 efetivo antes de chamar o provedor. Tamanho desconhecido ou acima do limite falha fechado; um PDF continua correspondendo a exatamente uma entrega.

O canal de portal genérico é cadastrado como `is_implemented = false` e `is_enabled = false`. Ele nunca pode ser verificado nem enfileirar canhotos automaticamente. A Edge Function também fica bloqueada por `DELIVERY_RECEIPT_PORTAL_WORKER_ENABLED`, cujo padrão seguro é ausente/desligado, e não contém transporte HTTP para fornecedores.

## Modelo

- `delivery_receipt_channel_adapters`: catálogo controlado por migração. Um adaptador só pode ser habilitado se estiver marcado como implementado.
- `delivery_receipt_supplier_channels`: configuração não secreta por tenant e fornecedor. E-mail, NF-e, NFS-e e CT-e não têm relação hierárquica; o fornecedor é resolvido por CNPJ, ID ou nome normalizado.
- `delivery_receipt_channel_jobs`: fila durável por canhoto, fornecedor e fingerprint da evidência. A chave de idempotência é imutável.
- `delivery_receipt_channel_job_events`: trilha append-only dos estados da fila.
- `process-delivery-receipt-portals`: worker fechado por segredo de cron, flag global e allowlist de adaptadores. A versão atual somente registra `unavailable`; ela não pode registrar sucesso.

Quando um canhoto ativo passa a `validated` e possui PDF, os gatilhos verificam canais `verified` com `auto_enqueue = true`. O job contém um PDF individual e somente os documentos daquele fornecedor. NF-e, NFS-e, CT-e, outros fiscais e referências operacionais são tratados como pares. Um canhoto com documentos de dois fornecedores pode produzir dois jobs, mantendo um único canhoto por entrega.

## Dependências externas antes de ativar um fornecedor

1. Briefing do portal: URL oficial, autenticação, MFA/captcha, formato aceito, metadados obrigatórios, limite de arquivo, política de retenção, SLA e ambiente de homologação.
2. Autorização contratual para transmissão de comprovantes e dados pessoais do recebedor.
3. Adaptador específico versionado e revisado. Automação por navegador só deve ser adotada quando o fornecedor não oferecer API e autorizar esse modo.
4. Credencial armazenada como secret de Edge Function ou vault externo. A tabela guarda apenas uma referência em maiúsculas; senha, token, cookie e cabeçalho de autorização são rejeitados nos metadados auditáveis.
5. Allowlist exata de origem HTTPS e proteção contra redirecionamento para rede privada no adaptador específico.
6. Suporte comprovado a chave de idempotência. Sem isso, o canal não passa pela verificação.
7. Teste de capacidades com um canhoto fictício sem PII no ambiente de homologação do fornecedor.
8. Migração posterior que registre o novo `adapter_key` como implementado e habilitado. O serviço de verificação, e não o navegador do operador, confirma capacidades e ativa o enfileiramento automático.
9. Segredos locais/remotos: `DELIVERY_RECEIPT_PORTAL_WORKER_ENABLED=true`, `DELIVERY_RECEIPT_PORTAL_ADAPTER_ALLOWLIST=<adapter específico>` e a credencial referenciada pelo perfil. Não inclua `supplier_portal_generic_v1` na allowlist.
10. Agendamento autenticado usando o segredo de cron já mantido no Vault; monitoramento de fila, retries e alertas para `failed`/`unavailable`.

## Contrato de sucesso

Somente um adaptador específico pode chamar `complete_delivery_receipt_channel_job_v1`, depois de receber uma confirmação inequívoca do portal. A referência externa deve ter entre 3 e 200 caracteres. Respostas auditadas têm limite de 32 KiB e não podem conter chaves relacionadas a segredo, senha, token, autorização, cookie ou credencial.

Timeout, autenticação inválida, captcha/MFA inesperado, resposta ambígua ou confirmação ausente devem resultar em `failed` ou `unavailable`; nunca em sucesso presumido.

## Homologação obrigatória

- Repetir o mesmo evento não cria outro job para o mesmo fingerprint.
- O planejador divide cinco PDFs em mais de um lote quando o tamanho Base64 projetado ultrapassa 25 MiB, mesmo que a contagem isolada ainda coubesse.
- O worker mede o anexo final, depois da capa, e não envia quando o payload Base64 real ultrapassa o limite.
- Lease concorrente usa `FOR UPDATE SKIP LOCKED`; apenas um worker recebe o job durante a janela.
- Lease errado não conclui nem falha o job.
- Repetição da confirmação com a mesma referência externa retorna replay idempotente.
- Alterar o perfil pelo operacional remove a verificação e desliga `auto_enqueue`.
- Adaptador ausente, desabilitado ou sem idempotência não pode ser verificado.
- Um canhoto apenas com NFS-e é elegível; CT-e nunca é obrigatório.
- Entrega mista gera um job único por fornecedor, com todos os documentos daquele fornecedor no snapshot.
- Nenhum segredo aparece na API operacional, no payload, em logs ou eventos.

## Limite consciente

A integração automática completa depende de pelo menos um portal real escolhido pelo cliente, documentação/API, credenciais de homologação e autorização para transmitir. Até essas dependências existirem, o sistema oferece configuração em rascunho e observabilidade, mas mantém o canal tecnicamente incapaz de enviar.
