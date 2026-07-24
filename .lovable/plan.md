## Auditoria — o que está OK e o que quebra

### API Hub Fiscal — proxy vs contrato v1 (2026-07-24)
- `supabase/functions/hub-fiscal-proxy/index.ts` cobre todos os endpoints MVP do CSV (`/hub_documents_emit|get|sync|cancel|cce|email|file|preview|query`), com Bearer por emitente, resolução por scope (`cte`/`nfse`/`all`) e ambiente `sandbox|production`. ✅
- `resolveToken` **não filtra por `environment`**. Se um emitente tiver credenciais sandbox e produção no mesmo scope, o proxy escolhe aleatoriamente (ordem do result set). Precisa ordenar/filtrar por `environment` explicitamente.
- `hubFiscal.emit()` monta body sem `callbackUrl` — o Hub cai para `default_callback_url` do api_client. Isso é aceitável, mas o webhook de retorno precisa estar apontando para uma das nossas funções (`hub-fiscal-webhook-in`). Só surfar aviso.

### Botões "Gerar CT-e" — hoje o emitente é ignorado em 3 de 4 caminhos
| Origem | Hook | Passa `emitter_id`? | Chama Hub Fiscal? |
|---|---|---|---|
| `/loads/:id` "Confirmar e Gerar CT-e" | `useGenerateCTe` | ❌ Usa `currentTenant.name` como remetente | ❌ Só grava em `fiscal_documents` |
| `CTeWorkbench` "Gerar CT-e" | `useGenerateCTe` | ❌ | ❌ |
| `/cte-hub` "Gerar N CT-e(s)" | `useCreateCteBatch` | ❌ Não tem `emitter_id` no batch | ❌ Só cria rascunho interno |
| `/cte-hub` "Prévia editável & transmitir" | `useIssueCTe` (novo) | ✅ | ✅ |

Ou seja: **hoje só a prévia editável usa o emitente escolhido e transmite ao Hub**. Todos os outros botões continuam gerando rascunho interno, ignorando o cadastro de emitentes.

### Bugs concretos identificados
1. **`cte_defaults_for_group` filtra por coluna inexistente `is_active`** — a tabela `tenant_emitters` tem `active`, não `is_active`. Efeito: o RPC devolve `emitter: null` sempre, então a prévia editável não pré-preenche o emitente automaticamente.
2. **`resolveToken` não considera `environment`** — se houver mais de uma credencial no mesmo scope, o token escolhido pode ser do ambiente errado.
3. **`cte-sefaz-callback` grava em `cte_documents` (tabela legada)**. CT-es transmitidos pelo novo fluxo vivem em `fiscal_documents` com `hub_document_id`/`emission_id` — não recebem sync automático via callback do Hub. `hub-fiscal-webhook-in` já atualiza `fiscal_documents`, mas o Hub precisa estar configurado para chamar essa função, não a legada.
4. **`useGenerateCTe` e `useCreateCteBatch`** não aceitam nem persistem `emitter_id` — os operadores não conseguem escolher CNPJ emitente no fluxo tradicional.
5. **Dialog `CteEmissionPreviewDialog`** trava `environment: 'sandbox'` no builder (linha 133). Precisa ler do `hub_fiscal_credentials.environment` do emitente/scope selecionado (ou expor toggle na UI).

## Correções propostas

### 1. Corrigir `cte_defaults_for_group` (migration)
Trocar `e.is_active = true` por `e.active = true` para o RPC voltar a pré-preencher o emitente na prévia editável.

### 2. Endurecer resolução de token no proxy
Em `supabase/functions/hub-fiscal-proxy/index.ts` `resolveToken()`:
- Aceitar `environment` opcional no payload; filtrar `hub_fiscal_credentials` por `environment` quando informado.
- Ordenar match por `environment` primeiro, depois `doc_scope` específico > `all`.
- Log estruturado indicando `environment` escolhido.

### 3. Passar `emitter_id` nos botões legados
- **`useGenerateCTe`**: aceitar `emitterId?` opcional; se ausente usar `useDefaultEmitter`. Popular `fiscal_documents.emitter_id`, `remitter`/`remitter_cnpj` a partir do `tenant_emitters` selecionado (não `currentTenant.name`).
- **`useCreateCteBatch`**: aceitar `emitterId?` e propagar para cada rascunho.
- **`LoadDetail` + `CTeWorkbench` + `Billing.handleGenerate`**: adicionar `Select` de emitente antes do botão "Gerar" usando `useEmitters()`, default = `useDefaultEmitter()`. Manter comportamento atual (rascunho interno) — só passar a respeitar o emitente escolhido.

### 4. Prévia editável: environment dinâmico
- Adicionar hook `useHubCredentials(emitterId, 'cte')` no `CteEmissionPreviewDialog` para ler o `environment` da credencial CT-e ativa e passar ao builder em vez de fixar `sandbox`.
- Mostrar badge "SANDBOX" / "PRODUÇÃO" no cabeçalho de cada CT-e para o operador ter feedback.
- Repassar `environment` também para o `hubFiscal.emit()` (via `body.environment`) — já existe, só garantir consistência.

### 5. Callback SEFAZ: apontar novo fluxo para `fiscal_documents`
Duas opções (escolher no build):
- **A**: Estender `cte-sefaz-callback` para tentar update também em `fiscal_documents` quando o `id`/`accessKey` não bater em `cte_documents`.
- **B** *(recomendado)*: Deprecar `cte-sefaz-callback` e apontar a config do Hub Fiscal para `hub-fiscal-webhook-in` (que já mapeia para `fiscal_documents`). Deixar `cte-sefaz-callback` só como fallback dos rascunhos legados em `cte_documents`.

### 6. Diagnóstico visível ao operador
- Botão "Testar credencial" (`hubFiscal.ping(emitterId, 'cte')`) no card de emissão do `/cte-hub`, retornando `source` (`ciphertext`/`secret_name`/`default`), scope efetivamente casado e ambiente.
- Alerta no dialog quando o emitente escolhido não tem credencial CT-e ativa (fallback para token default = risco de emissão pelo CNPJ errado).

### 7. Testes de regressão
- Unit test em `cteBuilder` cobrindo: taker `terceiro` sem `takerParty`, ausência de motorista/veículo, NFs sem chave (warning), payload final tem `emitterCnpj` e `payload.emitente.cnpj`.
- Test do `resolveToken` (integration deno) com credencial dupla sandbox/produção garantindo escolha correta por ambiente.

## Arquivos afetados
```
supabase/migrations/<nova>.sql              # fix cte_defaults_for_group (active)
supabase/functions/hub-fiscal-proxy/index.ts # environment no resolveToken + logs
supabase/functions/cte-sefaz-callback/index.ts # fallback opcional p/ fiscal_documents (opção A)
src/hooks/useGenerateCTe.tsx                # aceitar emitterId + preencher remitter
src/hooks/useBilling.tsx                    # useCreateCteBatch aceitar emitterId
src/hooks/useEmitters.tsx                   # já expõe useHubCredentials — reusar
src/pages/LoadDetail.tsx                    # Select de emitente antes de Gerar
src/pages/Billing.tsx                       # Select de emitente + repasse ao batch
src/components/loads/CTeWorkbench.tsx       # Select de emitente
src/components/billing/CteEmissionPreviewDialog.tsx # environment dinâmico + badge + ping
src/test/cteBuilder.test.ts                 # cobertura de validação
```

## Fora de escopo
- Não altero schema além do fix `is_active`→`active`.
- Não removo `cte-sefaz-callback` nem `cte_documents` (mantém compat com rascunhos legados).
- Não implemento CC-e/inutilização/DFe pela UI — proxy já expõe, integração de UI fica para etapa posterior.

Confirma que sigo com esta lista ou quer priorizar só um subconjunto (ex.: só o fix do RPC + wiring do emitente nos botões legados)?
