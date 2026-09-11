# Devolução de crédito — interface local

Entrada: Contas a Receber → Créditos de clientes → crédito do pagador → Conferir devolução de dinheiro. Catálogo usa saídas existentes do servidor, documentadas para o mesmo pagador. Busca, páginas de30 e total integral; revisão mudou40001 reinicia com nova geração, inclusive sob cacheInfinity. Não há campo para UUID arbitrário nem execução bancária.

Prévia mostra nome/documento do pagador e destinatário, identificação verificada ou não comprovada, data/conta/valor/capacidade da saída, crédito antes/depois e capacidade antes/depois. Fonte com data inválida preserva diagnóstico e não permite confirmação. Confirmação exige can_execute/eligible, motivo e conferência explícita. Histórico permanente conserva ator, motivo, evento e saída original.

Outbox separado tenant/actor, WebLocks e gravação antes do envio. Replay conserva saída, crédito, pagador esperado, corpo/revisão/motivo e efeitos esperados. Resposta divergente conserva pendência; rejeição definitiva só limpa primeira tentativa; outra aba nunca tem registro removido por engano. Sucesso permanece terminal se atualização falhar. Caches de crédito, lista/carteira/contexto, movimentos/opções/correção, auditoria e previsão atual são invalidados. Nenhum snapshot histórico da previsão é alterado.

Posição aceita returned_cents opcional para compatibilidade; quando presente, original=applied+returned+available. Liberações continuam histórico de liberação de aplicações, sem inferir dinheiro devolvido. Nulo não vira zero e returned ausente é identificado como não detalhado na versão.

## Evidências

13 testes novos passaram:3 contrato,4 outbox,3 UI,2 cliente e1 rótulos auditáveis. Mais8 regressões de aplicação/contrato existentes passaram. Cliente tem binding do SDK e teste método com receiver obrigatório. Testes UI cobrem documento e saldos, edição/refetch ocultando autorização, recuperação da saída original, falha de cache após confirmação e paginação stale comcacheInfinity. Lint dos17 arquivos da allowlist passou.

Native informou2testes SQL públicos reais com3parsers destesarquivos,31saídas paginadas e exclusão pagador divergente. Essa prova foi executada pelo agente SQL, não por este agente. Não executado TSC global, build, commit, deploy ou escrita remota aqui. Código local aguarda integração conjunta do núcleo04822 e boundary10629 pelo root. Sem refund anterior publicado ou emissão fiscal.
