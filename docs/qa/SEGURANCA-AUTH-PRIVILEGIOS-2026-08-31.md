# Segurança de Auth, tenants e funções privilegiadas

Estado: controles locais verificados; configuração hospedada e revisão integral
das funções ainda bloqueiam a conclusão do P1. Nenhuma alteração de produção foi
feita neste bloco.

## Resultado

- Em 31/08/2026 às 19:59:40 de São Paulo, a leitura pública de
  `/auth/v1/settings` ainda retornou `disable_signup=false`. A configuração
  versionada exige `enable_signup=false`, senha mínima de 12 caracteres com
  maiúscula, minúscula e número, e login por senha sem TOTP obrigatório.
- A barreira de banco para convites foi executada em PostgreSQL descartável:
  criação sem autorização falha, um nonce preparado é consumido uma única vez,
  o nonce é removido dos metadados persistidos e `anon`/`authenticated` não
  conseguem preparar convite nem ler o ledger privado.
- `create_tenant_with_owner(text)` permanece sem execução por `PUBLIC`, `anon`,
  `authenticated` e `service_role`; somente o dono do banco conserva acesso para
  administração controlada. A migração revisada tem SHA-256
  `dbd8c21323940283169058f6fce538408eff44ddee956e59bb59a0f5653e0f37`.
- `application_error_events`, `application_web_vitals` e
  `secure_upload_rate_events` têm RLS ativo e zero políticas de propósito. Os
  testes das migrações reais confirmam browser sem DML e `service_role` apenas
  com `SELECT`, `INSERT` e `DELETE`. Criar uma política permissiva só para
  eliminar o aviso reduziria a segurança.
- A migração de revogações direcionadas permanece explícita, sem loop por
  catálogo ou revogação ampla. Seu SHA-256 é
  `e629386ffc5c883707735c8682f33f6f96e456888af71c7ac509e85c78bc9aa7`.

## Inventário e allowlist

O arquivo `supabase/verify/security_boundary_inventory.sql` é estritamente
read-only. Ele impõe as negações objetivas e retorna cada função
`SECURITY DEFINER` de `public`/`private` com assinatura completa, hash do corpo,
ACL efetiva, `search_path`, uso por trigger, referência textual em políticas e
sinais de guarda por ator/tenant.

A allowlist aceita somente uma combinação revisada de **assinatura + hash do
corpo + papel + tipo de consumidor**. Os tipos possíveis são: RPC chamada pelo
frontend autenticado; RPC de Edge que encaminha o JWT do usuário; helper exigido
por RLS no schema privado; ou rotina exclusivamente backend com execução apenas
por `service_role`. Nome de função isolado, presença de `auth.uid()` ou retorno
do advisor não constituem aprovação.

O contrato existente deriva as RPCs do frontend/Edge do código e verifica que
elas existem e têm o grant esperado. O inventário SQL complementa esse lado do
consumidor com o catálogo efetivo do banco. A revisão só termina quando todas as
linhas executáveis por `authenticated` forem conciliadas com um consumidor e
com testes de papel, tenant, `search_path` e concorrência aplicáveis. Por isso os
140 alertas observados anteriormente não são declarados resolvidos neste bloco.

## Intervenções hospedadas restantes

1. No Dashboard/Management API do projeto correto, definir signup público como
   desabilitado sem enviar o restante de `config.toml` às cegas. Depois, repetir
   signup público, convite válido, nonce expirado/reutilizado, login e
   recuperação de senha no domínio final.
2. Confirmar o plano contratado. A proteção contra senhas vazadas deve ser
   habilitada apenas se já estiver incluída; não contratar upgrade nem serviço
   adicional para eliminar o alerta.
3. Executar o inventário read-only no catálogo publicado, preservar a saída e
   revisar cada função. Revogar somente assinaturas classificadas e testadas;
   republicar banco, Edge e frontend na ordem coordenada.

Nenhuma emissão fiscal, chamada de provedor fiscal, ativação SSX, pagamento,
mudança de plano ou escrita remota ocorreu nesta revisão.
