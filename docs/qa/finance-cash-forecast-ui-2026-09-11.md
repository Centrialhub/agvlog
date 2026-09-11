# Previsão de caixa — interface local

## Integração

Export `CashForecastPanel({tenant,actor,onSelectSnapshot?:(snapshotId:string|null)=>void})` em `src/components/financial/CashForecastPanel.tsx`. O root possui rota/sidebar; bank possui comparação. O callback só indica captura com resumo original carregado, e recebe null ao trocar filtro, fechar, refazer leitura, falhar ou trocar contexto. A comparação pode ser renderizada abaixo pelo root.

Usa somente APIs reais90256: preview_finance_cash_forecast, record_finance_cash_forecast, get_finance_cash_forecast_history, get_finance_cash_forecast_snapshot e get_finance_cash_forecast_sources. Preservação envia versão/empresa/pedido/período/revisão/título/motivo, nunca valores calculados pelo navegador.

## Apresentação

Escopo empresa inteira; base por conta com evidência e natureza banco/caixa/provisória/indeterminada. Data-base padrão último dia do mês anterior em São Paulo; horizonte fim do mês seguinte, ambos editáveis. Cenário títulos confirmados separado do ampliado com fretes a faturar. Mostra entradas/saídas já registradas, expectativas, origens sem data e créditos não atribuídos. Null permanece Indeterminado. Nenhuma conta não representa saldo zero. Registro de movimento não afirma conciliação. Não apresenta DRE ou lucro.

Histórico paginado30 com título, período, autor/ID/data, razão e diagnóstico completo/incompleto. Seleção mostra a captura original e suas fontes, separadas da prévia atual. Fontes paginadas30 por títulos/fretes, movimentos, créditos e pendências. A contagem integral permanece visível; não há truncamento silencioso do agregado. Fontes conservam revisão e snapshotID; histórico recupera40001 com epoch, inclusive sob staleTime Infinity. Refetch/erro oculta dados anteriores.

`display` opcional é identificação ATUAL (nome/descrição/documento); o texto esclarece que valores, datas econômicas e revisões continuam originais nas capturas. SQL92902 correspondente é do root e não foi alterada por esta subtarefa.

## Recuperação

Outbox por empresa/ator, WebLocks e persistência antes de enviar; nunca troca pedido incerto por outro. Recuperação mostra período, título e motivo preservados e reenvia corpo idêntico. Resultado exige empresa, ator, pedido e revisão corretos. Somente rejeição definitiva da primeira tentativa pode liberar; retry previamente incerto preserva. Comparação do registro protege outro pedido de outra aba. Sucesso permanece terminal se atualização do cache falhar; nova preservação exige ação explícita.

## QA

Rodada06:31:29, sessão46772, saída0:15 testes em5 arquivos. UI5, client3, outbox4, contrato2, integraçãoPGlite1. ESLint15 arquivos saída0.

Prova SQL usa cadeia real82303→84618→84626→85621→90256, autorização authenticated, preservação no servidor e parses de prévia, resultado, histórico, resumo original e quatro tipos de fontes. Testes UI cobrem valores provisórios/indeterminados, captura original com identificação atual, página2/revisão, cacheInfinity+40001, recuperação após resposta perdida, falha de atualização após sucesso e limpeza da seleção usada pela comparação.

Sem TSC global nesta subtarefa, conforme coordenação. Sem deploy, SQL alterada, remote, stage ou commit. Limite: sem navegador hospedado e identificação92902 testada em transporte controlado enquanto o root finaliza o adaptador SQL. A regra monetária está no coletor/projetor do servidor, não na UI.

Allowlist15 arquivos comSHA256 em `finance-cash-forecast-ui-allowlist-2026-09-11.json`.
