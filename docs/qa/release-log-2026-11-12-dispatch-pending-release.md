# Log de release — despacho com localização pendente

## Identidade e estado
Base f9e863fdef0380e8c4c282ac7fc71645a6cc6788, AGVLog qcvnsdrbcchaxvawcngk. Checkout isolado C:/Users/Budinha Yamaguti/Downloads/AGV DESPACHO LIBERACAO. Usuário solicitou liberar operação sem ajustar dezenas de pontos manualmente. Preparação; publicação/evidências finais no PR.

## Contrato e retorno
O contrato existente aceita localização ausente com location_exception_reason explícito >=20 caracteres. Não reinterpretar coordenadas aproximadas como endereço verificado: o trigger canônico promove address_geocoded para verified. Esta mudança reutiliza a exceção operacional existente com autorização única visível por carga; não cria coordenadas, não muda precisão/confiança ou status canônico e não marca entrega concluída. O operador pode editar a justificativa mostrada, comum às paradas pendentes. A confirmação aplica somente às paradas sem ponto e sem exceção anterior; mantém pontos, exceções individuais, motorista, veículo e notas. O endereço documental de planned.location_address é preservado no payload de paradas sem coordenadas em vez de substituído pelo rótulo do destinatário.

A busca pode ser interrompida depois de carregar e validar documentos/rascunho; AbortController e escopo de usuário/tenant/carga impedem resultado antigo de sobrescrever a liberação. Criar Viagem ainda exige motorista/veículo, documentos distribuídos exatamente uma vez e rascunho atual. Liberação não envia viagem automaticamente: operador confirma Criar Viagem. Sem alteração em banco, RPC, ACL, Edge, geofence, baixa de entrega, Secrets ou emissão fiscal. Retorno: frontend anterior, mesmo formato persistido.

## Validação
42 testes locais aprovados em quatro arquivos: tela real com transporte isolado, cinquenta pendências com justificativa única, mínimo20, estados desabilitados, preservação de ponto preciso, cancelamento da busca lenta/resultado obsoleto e payload com endereço documental/null coordenadas. Não houve envio operacional real, mensagem ou emissão fiscal. Typecheck/lint/baselines e Quality completo exigidos antes de promoção. Fluxo autenticado com carga real não executado.
