# Log de release — entrega sem assinatura desenhada

Pedido explícito do usuário em 14/11: retirar a assinatura feita riscando a tela.
Base f8d383e80d0dab5699081786c3eaf5630c7b627c, checkout isolado em C:.
Produção AGVLog qcvnsdrbcchaxvawcngk; ledger anterior 951, último 20261113173526.
Frontend anterior e8d50302429e68f1. Sem emissão fiscal nem entrega real de teste.

## Contrato

Entrega e devolução parcial deixam de mostrar/exigir SignaturePad. Permanecem
recebedor, canhoto legível original/processado, hashes, GPS, revisão de qualidade,
isolamento por empresa/motorista, idempotência e validação fiscal já existente.
Assinaturas antigas e drafts assinados continuam válidos; não são apagados.
Nenhuma foto é renomeada ou inventada como assinatura. O comprovante usa o scan
como storage_path quando a assinatura não existe, e signature_path permanece NULL.
A leitura de presença de assinatura no papel pelo OCR não muda.

Forward novo e estreito altera três funções por substituições com guarda de
MD5/ACL/configuração. Fonte anterior, contrato resultante e manifesto aditivo
versionados; os 46 forwards e manifestos anteriores ficam intactos. Sem db push.
Publicar somente após Quality gate completo e aplicar apenas o SQL revisado,
conferindo hash e ACLs antes do frontend. Não publicar Edge Functions neste delta.

## Validação e limites

PGlite executa entrega total/parcial sem desenho, comprovante/metadata, replay,
rejeição de GPS/scan ausentes, assinatura forjada e outro ator; compara os três
hashes e ACLs reais. Fixture parcial de reentrega, sem Auth/Storage de rede.
Contrato PostgreSQL nativo adicional usa exclusivamente os sete usuários .invalid,
inicia a viagem/checklist/custódia oficiais, registra chegada e entrega pela RPC
pública com snapshot fiscal, verifica recibo sem assinatura falsa e faz rollback.
Não substitui arquivos reais: storage.objects da fixture não contém uma foto real.
Testes do cliente verificam envio e replay offline sem assinatura, e preservam
as regressões dos uploads assinados antigos. CI/SHA/alias finais no PR e recibo.

## Retorno compatível

Manter backend e leitor/client de fila novos, que aceitam registros assinados e
não assinados. Não restaurar SQL anterior sobre recibos novos nem bundle antigo
que exige desenho ao reabrir um draft sem assinatura. Caso necessário, reativar
apenas requiresSignature nos dois EventDef, mantendo driverDeliverySubmission
novo e o backend opcional: a tela volta a pedir desenho, mas o replay continua
entendendo os drafts já salvos. O teste de replay sem assinatura valida o leitor
que deve permanecer nesse retorno. Nenhum dado/histórico precisa ser apagado.

## Orientação da operação

Após atualizar o app, informar o recebedor, fotografar o canhoto e confirmar a
entrega. Não há etapa de desenhar assinatura. Se o app mostrar o desenho antigo,
fechar e reabrir para carregar a versão publicada, preservando envios pendentes.
