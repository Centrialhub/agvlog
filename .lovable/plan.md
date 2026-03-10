
# Plano: Corrigir Polling de PositionHistory

## Diagnóstico (dados reais da produção)

O polling não retorna posições por causa de uma combinação de problemas:

1. **Propriedade de filtro errada na frente da fila**: `TrackedUnitIntegrationCode` é tentado primeiro, mas retorna 204 (vazio) no v3. A propriedade que FUNCIONA é `IntegrationCode` — mas ela está no final da lista e o rate limit (429) chega antes.

2. **Ordem de URL errada**: A URL sem versão (`/Tracking/PositionHistory/List`) é a que funciona para consultas per-unit, mas é tentada por último (depois de v3 e v2).

3. **Discovery muito agressivo**: Com 3 URLs × 4 propriedades, são 12+ requisições de descoberta. O SSX devolve 429 depois de ~3-4 chamadas.

4. **Cursores travados**: Todos os 11 cursores estão com `last_error: "HTTP 429"` e `last_success_at: null`. Nenhum polling vai funcionar enquanto estiverem em backoff.

5. **Evidência concreta**: O log mostra que a unidade "GVJ 3095" retornou 500 pontos com `IntegrationCode` na URL sem versão. Isso confirma a combinação funcional.

## Patches

### 1. `ssx-poll-positions/index.ts` — Mudanças cirúrgicas

**a) Inverter ordem de URL candidates para PositionHistory**
Mudar para: unversioned PRIMEIRO, depois v3, depois v2.
Justificativa: dados reais mostram que a URL sem versão funciona; v3 retorna 204.

**b) Inverter ordem de property candidates**
Mudar para: `IntegrationCode` PRIMEIRO, depois `TrackedUnitIntegrationCode`, etc.
Justificativa: dados reais confirmam que `IntegrationCode` é a propriedade funcional nesta instalação SSX.

**c) Implementar "scout" approach**
Em vez de fazer discovery para cada uma das 11 unidades:
- Usar a PRIMEIRA unidade como "scout"
- Se descobrir a combo funcional, aplicar a todas as outras
- Se o scout falhar com 429, parar o batch inteiro
- Isso reduz de ~66 requisições para ~5-6 no total

**d) Aumentar request_spacing_ms padrão**
De 200ms para 500ms para reduzir pressão no SSX.

**e) Incrementar POLL_MEMO_VERSION para 6**
Para forçar limpeza do memo antigo que estava envenenado (TrackedUnitIntegrationCode + v3).

### 2. `ssx-utils.ts` — Mudança mínima

**a) Alterar `buildPositionHistoryUrlCandidates`**
Inverter a ordem: unversioned primeiro, depois apiVersion, depois v2.

### 3. Migration SQL — Limpar estado travado

Resetar os cursores e cooldowns para permitir novo polling imediato:
- Limpar `backoff_until` e `last_error` de todos os ingestion_cursors da conta
- Limpar `poll_cooldown_until` da integration_account
- Resetar `poll_working_*` fields (o POLL_MEMO_VERSION=6 faz isso automaticamente)

## Resultado esperado

Após o patch:
1. Polling tenta URL sem versão + IntegrationCode primeiro
2. Scout descobre combo funcional com ~2-3 requisições
3. Aplica a combo para as 11 unidades sem discovery adicional
4. Posições reais aparecem em `positions_raw` e `positions_last`
5. Mapa mostra veículos com posição

## Arquivos alterados
- `supabase/functions/ssx-poll-positions/index.ts`
- `supabase/functions/_shared/ssx-utils.ts`
- Nova migration SQL para limpar estado travado
