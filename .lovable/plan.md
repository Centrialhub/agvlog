## Diagnóstico confirmado

O CNPJ do destinatário existe no sistema, mas **não** em `fiscal_documents.recipient_cnpj` — ele está em `clients.tax_id`, referenciado via `fiscal_documents.client_id`.

Exemplo (COMERCIAL GALA LTDA):
- `fiscal_documents.recipient_cnpj` = NULL em 55 NFs
- `clients.tax_id` = `42.985.218/0017-50` (via `client_id`)

Por isso o RPC `cte_defaults_for_group` devolve `recipient_cnpj = null` e a prévia deixa o campo vazio. O front-end já está correto: usa o valor da RPC quando o campo está vazio. O problema é a origem do dado.

## Correções propostas

### 1. Atualizar RPC `cte_defaults_for_group` para resolver CNPJ do cadastro de clientes
Fazer fallback: quando `fiscal_documents.recipient_cnpj` estiver NULL, buscar `clients.tax_id` a partir do `client_id` dominante. Também normalizar o CNPJ (só dígitos) para casar com o formato esperado pelo builder.

```text
recipient_cnpj = COALESCE(fd.recipient_cnpj, c.tax_id via client_id)
```

Retornar sempre `recipient_cnpj` só com dígitos.

### 2. Backfill em `fiscal_documents.recipient_cnpj`
Migration única que popula `recipient_cnpj` a partir de `clients.tax_id` (usando `client_id`) onde estiver NULL. Garante que:
- Faturas listadas em `Billing.tsx` mostrem o CNPJ na coluna correta.
- Outras telas que leem direto de `fiscal_documents` (portal, LoadDetail) também ganhem o CNPJ.

### 3. Trigger de auto-preenchimento em `fiscal_documents`
Ao INSERT/UPDATE, se `recipient_cnpj` for NULL e `client_id` estiver setado, preencher com `clients.tax_id` (só dígitos). Evita que novas ingestões fiquem sem CNPJ no destinatário quando o XML/ORT não trouxer.

### 4. Sem alterações no front
O `CteEmissionPreviewDialog` já faz o fallback correto (usa `d.recipient?.recipient_cnpj` quando o form está vazio). Depois do backfill + RPC ajustados, a prévia abrirá com o CNPJ preenchido para GALA e demais destinatários.

## Escopo técnico

**Migration única** contendo:
1. UPDATE de backfill em `fiscal_documents` a partir de `clients.tax_id`.
2. Função de trigger + trigger `BEFORE INSERT OR UPDATE` para manter sincronizado.
3. `CREATE OR REPLACE FUNCTION public.cte_defaults_for_group(p_load_ids uuid[])` com o fallback para clients e normalização de CNPJ.

Sem mudanças em código de UI, edge functions ou hooks.

## Fora de escopo
- Preencher CNPJ para NFs que não tenham nem `recipient_cnpj` nem `client_id` (nada a resolver).
- Alterar preenchimento de remetente (já vem correto do XML).
