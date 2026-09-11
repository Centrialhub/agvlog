# Integração do coletor com a projeção — 2026-09-11

Novo projectCollectedCashForecast valida o envelope completo do servidor, incluindo tenant, ator, período e revisão esperada. Mantém a coleta original e sua proveniência junto da projeção v2. Não realiza coleta por conta própria, autorização de RPC ou persistência.

Origens inválidas são preservadas na coleta e ganham diagnóstico impeditivo do cenário correspondente mesmo se o servidor omitir o diagnóstico. Elas não entram no cálculo como zero. Crédito desconhecido permanece null e impede conclusão; não há reserva inferida. Empresa sem conta retorna projection:null com indisponibilidade explícita, sem origem de saldo fabricada.

Seis testes do adaptador cobrem parcela recebida6000/restante4000 sem duplicação, problema exclusivo de frete, obrigação inválida, crédito desconhecido, empresa sem conta, escopo/ator/revisão e contagens incompletas. Rodada combinada35 testes passou05:41:53 (17 projeção,6 componentes,6 comparação,6 adapter), após normalização dos arquivos próprios que tinham mistura UTF8/Windows1252. O coletor SQL permanece em teste com seu autor; prova SQL do adapter será registrada separadamente.

Ainda faltam captura durável, APIs e interface da previsão, agenda auditada e aplicação de créditos. Não interpretar este adaptador como conclusão do recurso inteiro.
