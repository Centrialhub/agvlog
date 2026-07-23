
## Diagnóstico da comunicação por emitente

Auditei o caminho fiscal ponta-a-ponta. Resultado:

### ✅ O que já está correto

- `supabase/functions/hub-fiscal-proxy/index.ts` implementa `resolveToken(scope, emitterId)`:
  1. Usa `payload.emitterId` (ou o `emitter_id` da `hub_fiscal_emissions` via `emissionId`) para buscar em `hub_fiscal_credentials`.
  2. Prefere `doc_scope` específico (`nfse`, `cte`, …) e cai para `all`.
  3. Decripta `secret_ciphertext` com `AGVLOG_ENCRYPTION_KEY` ou lê o secret pelo `secret_name`.
  4. Só cai no `HUB_FISCAL_API_KEY` padrão se nada casar.
- `hub_fiscal_emissions` grava `emitter_id`, então `get/sync/cancel` posteriores resolvem o token do emitente certo.
- `useNFSe` já persiste `emitter_id` no documento e aloca RPS por emitente.

### ❌ O que está quebrado (não usa o roteamento por emitente)

1. **NFS-e não passa pelo `hub-fiscal-proxy`.** `useIssueNFSe`/`useCancelNFSe` chamam `emit-nfse`, que é um path legado baseado em `nfse_provider_configs` + `branch_code`. Ele **não lê `emitter_id`** do documento, **não usa `hub_fiscal_credentials`** e **não chama o Hub Fiscal** — apenas simula (`manual`) ou marca `queued`. Portanto, hoje, mesmo escolhendo o emitente na tela, a emissão real não acontece com o token correto.
2. **`hubFiscal.emit/get/sync/cancel/file` (client) está sem uso.** Nenhum caller no `src/` chama esses métodos, então CT-e / NF-e / NFC-e / MDF-e também não estão de fato consumindo o proxy por emitente.
3. **Payload do Hub sem `emitterCnpj` correto.** Como não há caller montando o `body` de emissão, não há garantia de que `emitterCnpj` enviado ao Hub bate com o CNPJ do `tenant_emitters` selecionado.
4. **Fallback silencioso perigoso no proxy.** Em `resolveToken`, se `secret_ciphertext` existir mas `AGVLOG_ENCRYPTION_KEY` estiver vazio ou a decriptação falhar, ele cai no token global sem sinalizar. Isso mascara credenciais quebradas por emitente.

## Correções propostas

### 1. Rotear NFS-e pelo `hub-fiscal-proxy` com o emitente do documento

Substituir `useIssueNFSe`/`useCancelNFSe` para:

- Carregar o `nfse_documents` (inclui `emitter_id`, `rps_number`, `series`, `tenant_id`).
- Carregar `tenant_emitters` (CNPJ, IE, endereço, razão social) do emitente vinculado — falhar cedo se ausente.
- Chamar `hubFiscal.emit({ type: 'nfse', emitterId, nfseDocumentId, body: { emitterCnpj, environment, externalId, payload } })`.
- Persistir `hub_document_id`, `provider = 'hub_fiscal'`, `status` retornado no `nfse_documents` + `nfse_events`.
- Cancelamento: `hubFiscal.cancel(hub_document_id, reason, emissionId)`.

O `emit-nfse` legado é mantido apenas para o modo simulado quando o emitente **não** tem credencial Hub Fiscal (fallback compatível com o comportamento atual).

### 2. Endurecer `resolveToken` no proxy

- Se `secret_ciphertext` existir e a decriptação **falhar**, retornar erro `HUB_CREDENTIAL_DECRYPT_FAILED` em vez de cair no token global.
- Se `secret_name` estiver setado mas o env estiver vazio, retornar `HUB_CREDENTIAL_SECRET_MISSING`.
- Só usar `DEFAULT_HUB_KEY` quando **nenhuma** credencial estiver vinculada ao emitente (ou nenhum emitente foi enviado).
- Logar (sem vazar segredos) o `emitter_id`, `scope` e origem (`ciphertext` / `secret_name` / `default`) para diagnóstico.

### 3. Teste de fumaça de roteamento (novo edge callable curto)

Adicionar `action: 'ping'` no `hub-fiscal-proxy` que:
- Recebe `emitterId` + `type`.
- Resolve o token e devolve `{ source: 'ciphertext'|'secret_name'|'default', scope_matched, has_token: boolean }` — nunca o token.
- Usado por um botão "Testar credencial" no `EmitterFormDialog` para o operador confirmar visualmente que aquele emitente tem token válido antes de emitir.

### 4. Verificação manual pós-deploy

- Cadastrar 2 emitentes com CNPJs distintos, cada um com token de sandbox diferente.
- Emitir uma NFS-e por emitente e checar em `hub_fiscal_emissions` que `emitter_id` e `emitter_cnpj` batem com o emitente escolhido, e que o `Authorization` enviado ao Hub veio da credencial correta (via log).

## Detalhes técnicos

- Arquivos a alterar:
  - `src/hooks/useNFSe.tsx` — reescrever `useIssueNFSe`/`useCancelNFSe` usando `hubFiscal`.
  - `supabase/functions/hub-fiscal-proxy/index.ts` — `resolveToken` estrito + `action: 'ping'`.
  - `src/components/settings/EmitterFormDialog.tsx` — botão "Testar credencial".
  - `src/lib/fiscal/hubFiscalClient.ts` — expor `ping(emitterId, scope)`.
- Sem migrações de schema; `hub_fiscal_emissions` e `hub_fiscal_credentials` já suportam o caso.
- `emit-nfse` continua deployado para fallback simulado; pode ser aposentado depois.

## Fora de escopo

- Emissão real de CT-e/NF-e/NFC-e/MDF-e (nenhum caller hoje). Fica só o roteamento pronto no client (`hubFiscal.*`) para uso quando as telas de emissão desses documentos forem implementadas.
