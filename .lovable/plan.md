## Objetivo

Permitir que um mesmo tenant emita NFS-e, CT-e, NF-e/NFC-e e MDF-e a partir de **múltiplos CNPJs**, cada um com sua própria integração no Hub Fiscal (1 conta Hub por CNPJ). A seleção do CNPJ emitente é **manual por documento**, com um padrão sugerido.

## Estado atual (verificado)

- `nfse_provider_configs` é indexado por `(tenant_id, branch_code)` — já suporta múltiplas filiais, mas **não guarda o CNPJ emitente** nem credenciais do Hub Fiscal.
- `hub_fiscal_emissions` já tem `emitter_cnpj`, porém o `hub-fiscal-proxy` usa **um único token** (`HUB_FISCAL_TOKEN`) global — não há roteamento por CNPJ.
- `emit-nfse` só consulta `nfse_provider_configs` por `branch_code`; nunca resolve credencial por CNPJ.
- `cte_documents`, `nfse_documents`, `fiscal_documents` não têm coluna do CNPJ emitente selecionado (apenas texto livre em `remitter` / `company_branch`).
- `nfse_sequences` já é escopado por `(tenant_id, branch_code, series)`.

## O que será construído

### 1. Cadastro de emitentes (nova tabela `tenant_emitters`)

Uma linha por CNPJ emitente do tenant. Substitui `branch_code` como texto solto, mantendo compatibilidade.

Campos: `id`, `tenant_id`, `branch_code` (rótulo curto: MATRIZ, FILIAL01…), `cnpj` (14 dígitos, único por tenant), `razao_social`, `nome_fantasia`, `ie`, `im`, `regime_tributario`, `endereco` (jsonb), `logo_url`, `is_default` (bool), `active`, timestamps.

RLS: leitura para membros do tenant; escrita só para owner/admin.

### 2. Credenciais Hub Fiscal por emitente (nova tabela `hub_fiscal_credentials`)

Uma linha por documento suportado por emitente (permite Hub separado por tipo se preciso, mas normalmente uma linha "all").

Campos: `id`, `tenant_id`, `emitter_id` (FK), `doc_scope` (`all` | `nfse` | `cte` | `nfe` | `mdfe`), `environment` (`sandbox`|`production`), `secret_name` (nome do secret que guarda o token — ex.: `HUB_FISCAL_TOKEN__<slug>`), `enabled`, `metadata` (jsonb — client_id/URL/quirks do Hub), timestamps.

Os **tokens ficam em Supabase secrets** (nunca no banco). O nome do secret é gerado a partir do CNPJ (`HUB_FISCAL_TOKEN_<cnpj>`) e cadastrado por `add_secret` na UI.

RLS: owner/admin do tenant.

### 3. Vínculo dos documentos ao emitente

Adicionar `emitter_id uuid` (FK → `tenant_emitters`) e índice em:
- `nfse_documents`
- `cte_documents`
- `fiscal_documents` (para NF-e/NFC-e emitidas pelo próprio tenant — mantendo compat com notas recebidas)
- `hub_fiscal_emissions`

Backfill: linhas existentes ganham `emitter_id` do emitter marcado `is_default=true` (criado a partir do `tenants.settings.company` atual — 1 emitter inicial).

Sequences: adicionar `emitter_id` a `nfse_sequences` (opcional, mantendo `branch_code`) — a alocação passa a considerar `(tenant_id, emitter_id, series)`.

### 4. Edge Function `hub-fiscal-proxy` — roteamento por emitente

- Payload passa a aceitar `emitterId` (uuid) OU `emitterCnpj` (14 dígitos).
- Resolve o emitter no banco, lê `hub_fiscal_credentials` para o `doc_scope` pedido, obtém o `secret_name` e injeta `Deno.env.get(secret_name)` como Bearer para o Hub.
- Se secret ausente → 424 com mensagem clara "Credencial não configurada para o CNPJ X".
- `hub_fiscal_emissions.emitter_id` populado em toda inserção.

### 5. Edge Function `emit-nfse` — usa emitter

- Payload aceita `emitter_id`. Se ausente, usa o `emitter_id` do documento.
- Config resolvida por `(tenant_id, emitter_id)` em vez de `branch_code`.
- Numeração via `next_nfse_number(_emitter_id, _series)`.

### 6. UI

**`Settings` → nova aba "Emitentes fiscais"**
- Lista de CNPJs cadastrados (razão, CNPJ, IE, ambiente, status Hub).
- Botão "Novo CNPJ emitente" (form: dados fiscais + logo + endereço).
- Por linha: "Configurar Hub Fiscal" abre modal que chama `add_secret` para o token, salva `hub_fiscal_credentials`, permite escolher `sandbox/production`.
- Botão "Definir como padrão".

**`NFSeFormDialog`, `CteHub` (geração), MDF-e/NF-e forms**
- Substituir campo texto "Filial" por `<Select>` de emitentes ativos, defaultando ao `is_default`.
- Mostra badge do CNPJ selecionado ao lado do número/série.

**`companyHeader.ts` (PDFs)**
- Passa a receber `emitterId` opcional; quando fornecido, usa dados daquele emitter (logo, razão, CNPJ, endereço) em vez do `tenants.settings.company` global. Fallback preservado.

### 7. Sinalização e validações

- Trigger em `tenant_emitters`: garante um único `is_default=true` por tenant e CNPJ único por tenant.
- Validação: emissão bloqueada se `hub_fiscal_credentials` do emitter estiver `enabled=false` ou secret ausente — mensagem "Configure a integração do CNPJ X antes de emitir".
- `hub_fiscal_emissions.emitter_id` obrigatório em novas inserções.

## Detalhes técnicos (para revisão)

- **Migração** em passos:
  1. Cria `tenant_emitters` + grants + RLS + trigger de default único.
  2. Cria `hub_fiscal_credentials` + grants + RLS.
  3. Adiciona `emitter_id` (nullable) nas 4 tabelas fiscais + índices.
  4. Seed: cria 1 emitter por tenant a partir de `tenants.settings.company` e marca `is_default`. Backfill de `emitter_id` nas linhas existentes.
  5. Altera `next_nfse_number` para aceitar `_emitter_id` (mantém overload antigo por `_branch_code` durante transição).
- **Nomes de secret**: `HUB_FISCAL_TOKEN_<cnpj>` (14 dígitos, sem máscara). O nome fica em `hub_fiscal_credentials.secret_name` — o valor nunca é armazenado.
- **Compat**: `branch_code` continua nas tabelas (para exibição/rótulo), mas o vínculo autoritativo passa a ser `emitter_id`.
- **Testes**: adicionar `src/test/multiCnpjEmission.test.ts` validando (a) seleção de credencial correta por CNPJ, (b) bloqueio quando secret ausente, (c) isolamento entre emitters de um mesmo tenant.

## Fora do escopo desta rodada

- Migrar tokens já existentes automaticamente (será feito manualmente por CNPJ no primeiro cadastro).
- Regras automáticas de escolha de emitente (fica para uma rodada futura — hoje é manual com default sugerido).
- Multi-tenant → multi-emitente cross-tenant (não faz sentido: emitter é sempre dentro do tenant).
