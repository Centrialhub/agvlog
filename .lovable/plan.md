
## Objetivo

Substituir a geração cega de CT-e (que hoje só grava `fiscal_documents` como rascunho interno) por um fluxo com **prévia editável campo-a-campo** e **transmissão real ao SEFAZ** pelo Hub Fiscal, usando o emitente correto e capturando chave/protocolo/status de retorno.

## Estado atual (o que muda)

1. `useGenerateCTe` (LoadDetail) e `useCreateCteBatch` (`/cte-hub`) hoje só fazem INSERT em `fiscal_documents` com `remitter = tenant.name`, `recipient = load.destination`, sem consignatário/tomador/motorista/veículo/emitente/natureza/observações e sem prévia editável.
2. `hub-fiscal-proxy` já tem `action:'emit', type:'cte'` (com resolução por emitente e registro em `hub_fiscal_emissions`), mas **nenhum caller no app envia CT-e** — apenas NFSe hoje.

## Escopo desta rodada

### 1. Modelo de dados

Migration única para dar suporte ao payload completo e ao retorno da SEFAZ:

- `fiscal_documents`:
  - `cte_payload jsonb` — snapshot editável e transmitido (remetente, destinatário, consignatário, expedidor, recebedor, tomador, motorista, veículo, natureza, CFOP, observações, NFs referenciadas).
  - `cte_taker_role text CHECK IN ('remetente','destinatario','expedidor','recebedor','terceiro')`.
  - `cte_driver_id uuid`, `cte_vehicle_id uuid`, `cte_consignee_client_id uuid` (FK lógicas para auditoria; sem hard FK para não quebrar deleções).
  - `sefaz_protocol text`, `sefaz_status text`, `sefaz_status_code text`, `sefaz_message text`, `hub_document_id text`, `emission_id uuid` (FK para `hub_fiscal_emissions`).
  - `status` passa a aceitar `'draft' | 'transmitting' | 'authorized' | 'rejected' | 'cancelled'` para CT-e outbound; migração dos "confirmed" antigos permanece intocada.
- RPC `cte_defaults_for_group(load_ids uuid[], mode text)` retornando pré-preenchimento (emitente padrão do tenant, remetente = maior remetente das NFs agrupadas, destinatário = cliente final, motorista/veículo da viagem/carga, consignatário = cliente do pagador, natureza padrão "PRESTAÇÃO DE SERVIÇO DE TRANSPORTE").
- Índices auxiliares em `access_key` já existentes ficam; adicionar `idx_fd_hub_document_id`.

### 2. Builder de payload Hub Fiscal (`src/lib/fiscal/cteBuilder.ts`)

Função pura `buildCtePayload(input) → { payload, warnings, missing }`:

- Recebe grupo (NFs, load(s), emitente, motorista, veículo, consignatário, tomador, natureza, observações, frete + breakdown).
- Monta o corpo exato esperado pelo Hub (`/hub_documents_emit?type=cte`): emitente (CNPJ, IE, endereço), remetente/destinatário/expedidor/recebedor/consignatário (CNPJ/CPF + endereço), tomador com `toma3/toma4`, veículo (placa/UF/renavam), motorista (CPF/nome), CFOP (por UF), natureza, valores (base cálculo IBS/CBS já calculados), NFs referenciadas (chave + série + número).
- Validação Zod local antes de submeter — lista campos faltantes de forma amigável.
- Coberto por testes unitários (`src/test/cteBuilder.test.ts`).

### 3. UI — Prévia editável (`/cte-hub` e LoadDetail)

Refatorar o diálogo "Prévia dos CT-es a gerar" (Billing.tsx L847-887) em novo componente `CteEmissionPreviewDialog.tsx`:

- Lista à esquerda: um CT-e por linha (do `buildGroups`) com badge de status de validação (verde = pronto, amarelo = faltam campos, vermelho = bloqueado).
- Painel à direita com abas:
  1. **Partes** — Emitente (select `tenant_emitters`), Remetente, Destinatário, Consignatário (select `clients`), Expedidor, Recebedor.
  2. **Tomador** — radio `remetente|destinatario|expedidor|recebedor|terceiro`; se "terceiro", campos de CNPJ/endereço.
  3. **Transporte** — Motorista (select `drivers` do tenant), Veículo (select `vehicles`), placa, UF, RENAVAM.
  4. **Carga & valores** — resumo de NFs, pesos, pallets, frete (override permitido com motivo — já existe `freight_overridden`).
  5. **Fiscal** — natureza da operação, CFOP, observações livres, série/número previstos.
- Botão "Recalcular padrões" chama `cte_defaults_for_group`.
- Botão "Salvar rascunho" grava `cte_payload` sem transmitir (`status='draft'`).
- Botão "Transmitir X CT-es" só habilita quando todos passam na validação.

O botão de LoadDetail passa a abrir o mesmo diálogo com um único grupo.

### 4. Transmissão

Novo hook `useIssueCTe.tsx` (espelha `useIssueNFSe`):

- Para cada grupo confirmado: `supabase.functions.invoke('hub-fiscal-proxy', { body: { action:'emit', type:'cte', emitterId, body: payload, fiscalDocumentId }})`.
- Antes de invocar: cria/atualiza a linha em `fiscal_documents` com `status='transmitting'` e `cte_payload = payload` (para termos rastro se o edge falhar).
- Após retorno: grava `hub_document_id`, `emission_id`, `access_key`, `sefaz_protocol`, `sefaz_status`, `status` final. Reaproveita `hub_fiscal_emissions` já preenchido pelo proxy.
- Sync/cancel: novos hooks `useSyncCTe` e `useCancelCTe` (invocam `action:'get'|'sync'|'cancel'` no mesmo proxy).
- A edge `cte-sefaz-callback` já existente é ajustada para propagar mudanças de status assíncronas para `fiscal_documents` via `hub_document_id`.

### 5. Regressão / testes

- `cteBuilder.test.ts`: montagem correta de payload com tomador em cada uma das 5 posições, NFs multi-remetente, override de frete, campos faltantes.
- `rlsCteEmission.test.ts`: garante que um tenant não emite CT-e com emitter de outro tenant e não lê `hub_fiscal_emissions` alheio.
- Ajustes nos testes existentes (`Billing.tsx` snapshots) para o novo diálogo.

## Fora do escopo (não faço agora)

- Reescrever `useGenerateCTe` legado para outras finalidades além do CT-e (segue como está, apenas reaproveita o builder).
- Novos modos de agrupamento além dos 14 já existentes.
- Impressão do DACTE (o Hub retorna PDF; ficamos apenas com download via `action:'file'` já existente).
- Fluxo de MDF-e.

## Riscos & mitigações

- **Payload inválido rejeitado pelo SEFAZ** → validação Zod local + status `rejected` com `sefaz_message` visível na tabela; o rascunho fica editável para reemissão.
- **Emitente sem credencial Hub configurada** → check prévio no diálogo (chama `action:'ping'` do proxy) desabilita "Transmitir".
- **Idempotência** → antes de transmitir, verifica se já existe `fiscal_document` com mesmo `emission_id` ou `access_key` para o grupo; caso positivo, oferece "sincronizar" em vez de emitir de novo.

## Ordem de implementação

1. Migration (colunas + RPC de defaults).
2. `cteBuilder.ts` + testes unitários.
3. `useIssueCTe`, `useSyncCTe`, `useCancelCTe`.
4. `CteEmissionPreviewDialog.tsx` + integração em `/cte-hub` e LoadDetail.
5. Ajuste do `cte-sefaz-callback`.
6. Testes de RLS + regressão.
