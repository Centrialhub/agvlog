# Agenda auditada da previsão — UI local

Entrada em fontes da previsão ATUAL: Revisar data esperada desta origem. Fontes preservadas continuam somente leitura, com histórico da agenda correspondente à captura. O diálogo identifica origem/valores e separa vencimento na origem de expectativa atual. Vencimento inexistente aparece Não informado; nunca é inventado a partir da data revisada. Agenda stale mostra alerta de que a origem mudou e a data manual não é usada até nova conferência.

APIs coordenadas com native: preview_finance_cash_forecast_agenda(_tenant_id,_cutoff,_period_end,_economic_key) e record_finance_cash_forecast_agenda(_payload). Preview/result usam os DTOs reais94505. Resultado não recebeu flags confirmed/cash_changed inexistentes. Cliente verifica tenant/ator/período/chave econômica e resultado verifica tenant/ator/pedido/chave/action/data.

Set exige data real; clear exige null e explica que remove só a data manual, voltando à origem quando disponível. Razão5..2000 e confirmação explícita. Não altera vencimento contratual, valor ou dinheiro. Capacidade de escrita vem da prévia autorizada; não é limitada indevidamente a admin se o backend permite operador financeiro. FinanceAccessBoundary protege a entrada e o servidor reautoriza a operação.

Outbox por empresa/ator, WebLocks e persistência pré-envio; corpo original/revisão/data/motivo preservados após incerteza. Pedido de outra origem é explicitamente identificado e recuperado nessa origem, sem aplicar valores da tela atual. Rejeição definitiva inicial pode liberar; rejeição de retry antes incerto preserva. Resposta com data/action/ator/identidade incompatível não limpa. Sucesso terminal permanece quando refetch falha.

Histórico manual amber mantém autor/nome/data/motivo, data esperada e vencimento consultado na revisão, páginas20 sem truncar eventos. Auditoria central inclui cash_forecast_agenda_set/cleared. Campos opcionais do coletor94505 são reutilizados, sem alterar o contrato do root.

Refresh após operação: finance-cash-forecast-agenda e finance-cash-forecast-preview por tenant; finance-cash-forecast-sources apenas quando queryKey[3]===null (consulta atual). Histórico, snapshots e fontes preservadas não são invalidados nem reinterpretados. Mudança de filtro fecha agenda contextual; tenant/ator remontam escopo. Erro/refetch oculta elegibilidade anterior.

## Evidência

07:10:31:18 testes em4 arquivos PASS (UIagenda6, client2, outbox5, regressãoUIprevisão5). ESLint14 arquivos saída0. Casos: clear preserva due_date, nova data, stale manual, origem semdue, histórico ator/motivo, fontes atuais versus preservadas, replay após perda de resposta/escopo diferente, resposta incompatível, falha de cache após sucesso e cache histórico intacto.

Native responsável pela boundary pública e testes SQL reais com parsers puros exportados cashForecastAgendaPreviewSchema/cashForecastAgendaResultSchema. Esta rodada não altera SQL, rotas, produção, Sites, stage ou commit. TSC global fica com root. Publicação depende da promoção conjunta do backend; RPC ausente falha fechado, sem fallback raw.

Allowlist14 arquivos comSHA256 em finance-cash-forecast-agenda-ui-allowlist-2026-09-11.json.
