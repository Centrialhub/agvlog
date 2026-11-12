# Log de release — recuperação de locais no despacho

Base publicada df4202d58779adc6c66363ba97af755713b73be2, backend AGVLog qcvnsdrbcchaxvawcngk. Checkout isolado C:/Users/Budinha Yamaguti/Downloads/AGV DESPACHO RECUPERACAO. Pedido via três prints e áudio de 12/11: após validar um único local, botão habilita, mas despacho falha em outra parada.

Logs confirmam geocode-address v22: timeout HTTP504 em 11/11 19:38:03 UTC, após onze respostas200. Teste privado Geoapify com praça pública fixa em 12/11 retornou200/passed/5candidatos, sem gravação operacional. Não é evidência de que todos os endereços rurais sejam resolvidos.

Contrato: preservar localização por parada, distribuição exata das notas, exceções explícitas >=20 caracteres, motorista/veículo, isolamento por usuário/empresa/carga e cancelamento. A busca mantém execução sequencial/quota/cache e interrompe em erro do provedor. Nova retomada explícita consulta somente locais não confirmados e preserva edição atual. O botão de criação permanece desabilitado enquanto há pendências, com contagem/instrução. Não alterar limites de confiança nem fabricar coordenadas/exceções.

Escopo somente frontend. Nenhuma migration, Edge, Secret ou contrato SQL alterado. Nenhuma viagem, baixa, mensagem ou emissão fiscal real executada. Retorno: frontend da base; mesmo formato persistido. Testes de tela usam transporte isolado e reproduzem confirmar apenas uma de duas paradas, retomar e manter ponto/notas. Gates e identidade de publicação serão registrados no PR.
