

## Auditoria Completa do Pipeline SSX → AGVLog

### Resumo da Arquitetura

```text
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌─────────────┐
│  SSX API     │───>│ ssx-login    │───>│ ssx-poll-pos.    │───>│ positions_  │
│  (Swagger)   │    │ (token cache)│    │ (posições raw)   │    │ raw + last  │
└──────────────┘    └──────────────┘    └──────────────────┘    └─────────────┘
                                              │                       │
                                              │                 ┌─────────────┐
                                        ┌─────────────┐        │ process-    │
                                        │ sync-       │        │ vehicle     │
                                        │ telemetry   │        │ (trips,etc) │
                                        └─────────────┘        └─────────────┘
```

### Status Atual

**ssx-login** — OK, funcionando (retornou 200, token cacheado com sucesso)

### Problemas Encontrados

#### 1. Token parsing incorreto no `ssx-login` (CRÍTICO)

O Swagger define que o `/Login` retorna `ResultToken` com propriedade **`AccessToken`** (e `ExpiresIn`). No código (linha 189), a extração tenta `parsed.token || parsed.Token || parsed.access_token || parsed.AccessToken`. Embora `AccessToken` esteja na lista, é o **último** fallback. Se a resposta real for `{"AccessToken": "xxx", "ExpiresIn": 86400}`, o código vai extrair corretamente, mas se vier como string crua (o que não deveria segundo o Swagger), pode pegar lixo. Também, o `ExpiresIn` (em segundos) é **ignorado** — o código assume fixo 24h ao invés de usar o valor real.

**Correção:** Priorizar `parsed.AccessToken`, usar `ExpiresIn` para calcular expiração real.

#### 2. URL do PositionHistory incorreta no `ssx-poll-positions` (CRÍTICO)

Linha 129: `const positionUrl = ${baseUrl}/Tracking/PositionHistory/List`

O Swagger mostra **três versões** desse endpoint:
- `/Tracking/PositionHistory/List` (v1 — schema `PositionResult`)
- `/v2/Tracking/PositionHistory/List` (v2 — com trailers)
- `/v3/Tracking/PositionHistory/List` (v3 — com placa, motorista, trailers)

O `settings.api_version` é `"v3"` mas **não está sendo usado** para construir a URL. Deveria ser `/v3/Tracking/PositionHistory/List`.

**Correção:** Respeitar `settings.api_version` ao construir a URL.

#### 3. Filtro com `Condition: "Equal"` em vez de `"="` (POTENCIAL)

Linha 170: `Condition: "Equal"`. O Swagger documenta os dois formatos (`Equal` e `=`) — ambos devem funcionar segundo a documentação. No entanto, o filter usa `PropertyName: "TrackedUnit"` enquanto o exemplo do Swagger usa `"TrackedUnitIntegrationCode"`. Depende de como o `external_code` foi cadastrado — pode ser a placa ou o código de integração.

**Correção:** Usar `TrackedUnitIntegrationCode` como `PropertyName` (conforme exemplos do Swagger), ou tornar isso configurável.

#### 4. `ssx-sync-telemetry` envia body `{}` para endpoint sem body (MÉDIO)

Linha 94: `body: JSON.stringify({})`. O Swagger mostra que `/Tracking/Telemetry/List` **não tem requestBody** — aceita só autenticação por Bearer token. Enviar um body vazio pode causar 415 em algumas configurações.

**Correção:** Remover o body, enviar POST sem content-type e sem body.

#### 5. Senha armazenada em texto plano (SEGURANÇA)

A resposta da API mostra `password_encrypted: "AGV102030"` — a senha NÃO está criptografada. Isso acontece porque o secret `AGVLOG_ENCRYPTION_KEY` **não existe** na lista de secrets do Supabase. A function `agvlog-integration-upsert` só criptografa se a key estiver disponível.

**Correção:** Adicionar o secret `AGVLOG_ENCRYPTION_KEY` ao Supabase.

#### 6. `positions_last` upsert com `onConflict: "tenant_id,vehicle_id"` (VERIFICAR)

Precisa confirmar que existe um unique constraint `(tenant_id, vehicle_id)` na tabela `positions_last`. Se não existir, o upsert silenciosamente insere duplicatas.

#### 7. `ingestion_cursors` upsert com `onConflict: "tenant_id,provider_unit_id"` (VERIFICAR)

Mesma situação — precisa de unique constraint.

#### 8. Duplicate tenant criado automaticamente

A rede mostra 2 tenants para o mesmo usuário: `6e874e6e-...` e `db36dc9b-...`. O fallback de criação automática no `useTenant.tsx` pode estar disparando mais de uma vez.

### Plano de Correção

#### Arquivo: `supabase/functions/ssx-login/index.ts`
1. Priorizar `parsed.AccessToken` no parsing do token (mover para primeiro na cadeia)
2. Usar `parsed.ExpiresIn` (segundos) para calcular expiração real ao invés de 24h fixo

#### Arquivo: `supabase/functions/ssx-poll-positions/index.ts`
1. Construir URL usando `settings.api_version`: `/v3/Tracking/PositionHistory/List` quando api_version=v3
2. Mudar `PropertyName` de `"TrackedUnit"` para `"TrackedUnitIntegrationCode"` (conforme Swagger)

#### Arquivo: `supabase/functions/ssx-sync-telemetry/index.ts`
1. Remover body `{}` e content-type do fetch (endpoint não espera body)

#### Migração SQL
1. Adicionar unique constraint em `positions_last(tenant_id, vehicle_id)` se não existir
2. Adicionar unique constraint em `ingestion_cursors(tenant_id, provider_unit_id)` se não existir
3. Adicionar unique constraint em `positions_raw(provider_payload_hash)` se não existir (para dedup funcionar)

#### Secret
1. Solicitar ao usuário a criação do secret `AGVLOG_ENCRYPTION_KEY`

#### Arquivo: `src/hooks/useTenant.tsx`
1. Adicionar guard contra criação dupla de tenant (verificar se já criou antes de chamar RPC novamente)

