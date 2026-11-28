# Release — confirmação de chegada e canhoto

Responsável: Codex. Alvo: AGVLog / qcvnsdrbcchaxvawcngk.
Base publicada verificada: 7183cb51c50b5a6054e26b81f06f9425b69e38b0.
Estado: candidato em validação; promoção somente após Quality gate completo.

## Defeito e contrato

As fotos do teste chegaram ao Storage em aproximadamente dois segundos, mas nenhuma entrega ou leitura OCR foi criada. As três paradas estavam sem coordenadas. A chegada recebia erro, enquanto sua projeção local habilitava uma entrega com estado esperado `arrived`; o servidor ainda estava em `pending` e recusava com 40001. Não se trata de espera pela IA.

O forward permite registrar chegada com GPS válido quando o destino despachado não tem coordenadas, marcando a evidência como não verificada. Não inventa coordenadas do destino. Mantém Auth, associação, titularidade, início da viagem, qualidade GPS, geofence de destinos mapeados, terminalidade, locks e ACLs. O teste nativo no staging cobre replay, GPS inválido, geofence e ator sem permissão.

O app conserva a chegada como predecessora obrigatória da entrega, limita a espera de transporte e mantém o mesmo pedido/fotos para recuperação. Recuperação manual sincroniza operações antes das entregas e permite reenviar o mesmo conflito de estado 40001; conflitos fiscais e limites persistidos continuam protegidos. Não há confirmação visual de entrega sem ACK remoto. A leitura OCR continua assíncrona, sem alteração de Edge Functions.

A listagem e os detalhes administrativos consultam mudanças de carga e têm atualização periódica visível a cada dez segundos. A carga só termina quando todas as paradas obrigatórias têm resultado terminal; não se força status de uma viagem real.

## Evidências e gates

- Typecheck local passou; testes focados de submissão, recuperação, fila e deadline passaram (80 casos antes da fixture adicional).
- Fixture PGlite reproduz a recusa original e executa o forward; geometria aproximada e associações simuladas são complementadas pela fixture nativa PostGIS/RLS no CI.
- Quality gate exige validate, oito shards unitários e database-and-e2e; resultados serão registrados em evidência externa vinculada ao SHA.
- Staging descartável de sete usuários sintéticos, fixtures com rollback. Nenhuma emissão fiscal nem mensagem real.
- Paridade histórica divergente: não usar db push. Aplicar somente o forward específico com preflight de hash do corpo ativo.

## Retorno e promoção

Ordem: gate completo, preflight fresco, forward específico, contrato, merge e conferência do alias/release.json. Não há Edge Function a publicar. ACLs preservadas por CREATE OR REPLACE. Fonte anterior está em driver-arrival-unmapped-rollback.sql; restaurá-la requer conferir o corpo ativo e preservar eventos já gravados. O leitor anterior aceita campos adicionais no JSON, mas voltaria a bloquear novos destinos sem coordenadas. Retorno do frontend não elimina fotos nem pedidos persistidos.

Smoke produtivo depende da recuperação no aparelho original: atualizar o app sem apagar dados, abrir Pendências e Sincronizar agora. Conferir ACK da chegada, entrega, vínculo do canhoto e status administrativo; não marcar sucesso produtivo antes disso.
