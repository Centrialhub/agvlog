# Implantação multiempresa

## Objetivo do corte

O `workspace` passa a representar o grupo operacional e o `tenant`, cada empresa legal. Clientes, fornecedores, funcionários, motoristas, caminhões e SSX são compartilhados dentro do workspace. Documentos, fiscal e financeiro permanecem obrigatoriamente vinculados ao tenant de origem.

O corte só deve avançar quando os testes, o preflight e a restauração de backup tiverem passado. A consolidação de workspaces é transacional: qualquer conflito aborta toda a operação.

## Entradas obrigatórias

- referência do projeto Supabase de produção e acesso de implantação;
- UUID do tenant que permanecerá como destino para cada grupo;
- UUIDs dos tenants que serão incorporados ao mesmo workspace;
- decisão humana para grupos que hoje possuem mais de uma conta SSX;
- janela de manutenção e responsável por aceitar os totais fiscal/financeiro antes e depois.

Nunca escolha o tenant de destino por nome. Registre os UUIDs e a razão social/CNPJ conferidos por duas pessoas.

## Sequência de ambientes

1. Gere um backup de produção e comprove uma restauração isolada.
2. Aplique todas as migrações em ordem em uma branch ou staging restaurado.
3. Configure o Auth Hook `public.custom_access_token_hook` e implante todas as Edge Functions da mesma revisão.
4. Execute `supabase/verify/active_tenant_rls.sql`, `supabase/verify/security_boundary_inventory.sql` e `supabase/verify/multi_tenant_release.sql`.
5. Faça login novamente e valide duas contas de teste com acesso a empresas diferentes.
6. Execute a consolidação dos workspaces no staging e repita os gates.
7. Compare contagens e somatórios fiscal/financeiros por tenant com o baseline pré-corte.
8. Libere um grupo piloto; depois da aceitação, repita em produção.

## Preflight por grupo

Substitua os UUIDs apenas na sessão administrativa de implantação:

```sql
select id, name, workspace_id
from public.tenants
where id in ('TENANT_ORIGEM'::uuid, 'TENANT_DESTINO'::uuid)
for update;

select workspace_id, id, provider, username, status
from public.integration_accounts
where workspace_id in (
  select workspace_id from public.tenants
  where id in ('TENANT_ORIGEM'::uuid, 'TENANT_DESTINO'::uuid)
)
and lower(provider) = 'ssx';
```

Se aparecerem duas contas SSX distintas, não faça o merge. Identifique qual é a inscrição única real, migre os dispositivos/credenciais se necessário e remova a duplicidade pelo fluxo administrativo auditável.

## Consolidação transacional

A função abaixo é executável somente por `service_role`. Faça uma origem por vez e preserve o mesmo destino do grupo:

```sql
begin;
select public.merge_existing_tenant_workspace_v1(
  'TENANT_ORIGEM'::uuid,
  'TENANT_DESTINO'::uuid
);
commit;
```

Ela move o workspace da origem, consolida memberships, reconstrói identidades compartilhadas, materializa as projeções por tenant, religa jornadas físicas e preserva a única conta SSX. Em conflito, a transação é revertida.

## Aceitação obrigatória

- o seletor da sidebar troca empresa e renova o JWT com `active_tenant_id` assinado;
- uma empresa não lista nem altera NF-e, CT-e, MDF-e, NFS-e, anexos, contas, títulos, pagamentos ou conciliações de outra;
- clientes, fornecedores, pessoas e caminhões aparecem em todas as empresas do grupo, sem duplicar a identidade física;
- o mapa usa a posição mais recente do caminhão, independentemente da projeção da empresa;
- existe exatamente uma conta SSX `ready` por workspace que utiliza SSX;
- o app do motorista mostra uma jornada física única e troca o tenant antes de cada ação específica da carga/parada;
- upload e URL assinada recusam caminho ou tenant divergente;
- os totais e quantidades fiscal/financeiros por tenant não mudam durante o merge.

## Observação e rollback

Monitore falhas `active_tenant_*`, `workspace_*`, respostas 401/403, erros de RLS, filas fiscais e ingestão SSX. Interrompa o rollout diante de qualquer leitura cruzada, divergência de totais, SSX ambíguo ou ação do motorista atribuída ao tenant incorreto.

Antes da consolidação, rollback significa reverter a versão da aplicação e as migrações aditivas conforme o ensaio de restauração. Depois de executar merges, não tente separar dados manualmente: restaure o backup para um ambiente isolado, confirme o ponto de recuperação e faça o rollback coordenado de banco, Edge Functions e frontend.

## Comandos de validação do repositório

```powershell
npm run typecheck
npm run lint:errors
npm run lint:critical-types
npm run quality:baseline
npm run edge:syntax
npm test
npm run build:check
```

O `supabase db reset`, `supabase db lint` e os advisors devem ser executados em uma máquina com Docker/Podman ou contra a branch Supabase de staging. A ausência desse runtime invalida apenas a validação local completa; não autoriza pular os gates no ambiente restaurado.
