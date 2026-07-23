## Diagnóstico

Os relatos de **tela branca** e **loading infinito** não vêm do código do app — vêm do **backend Supabase deste projeto** (`qcvnsdrbcchaxvawcngk`), que está degradado agora.

### Evidências coletadas nesta rodada

1. **Auth (GoTrue) retornando 500/504** nos últimos ~15 min:
   - `POST /auth/v1/token?grant_type=refresh_token` → **504 upstream request timeout**
   - `POST /auth/v1/token?grant_type=password` → **500 "Database error querying schema"**, erro interno `error finding user: context canceled`
   - Isso explica o loading infinito: o `useAuth` fica preso em `getSession()`/refresh que nunca resolve, então o `AuthProvider` nunca sai de `loading=true` e nada é renderizado além do "Carregando…".

2. **Postgres saturado / não respondendo**:
   - Todas as tentativas de `supabase--read_query` (inclusive `SELECT 1`) retornam `Connection terminated due to connection timeout`.
   - Logs do Postgres mostram:
     - `duration: 55223.831 ms plan: …` (query rodando ~55s)
     - `cron job 4 job startup timeout` repetido
     - `could not accept SSL connection: EOF detected`
     - checkpoints longos (~58s total)
   - As ferramentas de metadata do Supabase também falharam (ver `<supabase-info>` no contexto: "Connection terminated due to connection timeout").

3. **Endpoints REST/Auth respondem no TCP** (401 rápido no health), mas qualquer request que toque no banco trava — clássico de **saturação/lock no Postgres**, não de rede.

### Causa mais provável

Um **cron pg_cron** (jobid 4) está entrando em timeout de startup em ciclo, e há pelo menos uma query longa (~55s) segurando conexões. Combinado, isso satura o pool → GoTrue não consegue nem ler `auth.users`/schema → refresh/login expiram → o front trava no boot.

Nada disso é regressão do código recém-mergeado. É saúde do backend.

## O que fazer

### 1. Mitigação imediata no backend (fora do código)

Enquanto o Postgres estiver assim, nenhuma correção de front resolve. Precisamos:

- Abrir o **Supabase Dashboard → Database → Roles/Reports** e verificar:
  - conexões ativas e queries longas (`pg_stat_activity`);
  - se dá para **cancelar** a query de ~55s e/ou **pausar o cron job 4** (`SELECT cron.unschedule(4);`) temporariamente.
- Se o dashboard também estiver lento, abrir **ticket na Supabase** anexando: request-ids dos 504 (`019f8b74-…`, `019f8b72-…`, `019f8b6d-…`) e os trechos de log acima.

Preciso da sua confirmação antes de tentar `cron.unschedule` / cancelar queries via migração — é ação destrutiva em produção.

### 2. Blindagem no front para não ficar "loading infinito" quando o backend falhar

Independente da causa raiz, o app não deve travar em tela branca quando o Supabase está fora. Ajustes pequenos, sem mudar regra de negócio:

- **`src/hooks/useAuth.tsx`**: hoje, se `supabase.auth.getSession()` demorar/rejeitar, `setLoading(false)` nunca roda. Adicionar:
  - `try/catch` em torno de `getSession()` que ainda chama `setLoading(false)`;
  - um **timeout de segurança** (ex.: 8s) que força `loading=false` mesmo sem resposta, com `session=null` (usuário vai para `/auth`).
- **`src/hooks/useTenant.tsx`**: mesma proteção em `fetchMemberships` — hoje, se a query trava, `loading` fica `true` para sempre.
- **`src/pages/Auth.tsx` / layout raiz**: quando `loading=false` e ainda não há sessão por falha de rede, mostrar um estado de erro com botão "Tentar novamente" em vez de spinner infinito.

### 3. Verificação pós-mitigação

Depois que o backend voltar:

- Re-rodar `SELECT 1` via read_query para confirmar responsividade.
- Conferir cron job 4 (nome, schedule, última execução) e decidir se ele precisa ser otimizado ou reescrito (provavelmente é um dos jobs SSX/agvlog descritos na memória).
- Rodar `bunx vitest run` para garantir que os guards adicionados no front não quebraram nada.

## Detalhes técnicos

- Arquivos a editar (etapa 2): `src/hooks/useAuth.tsx`, `src/hooks/useTenant.tsx`, e um pequeno componente/estado em `src/App.tsx` ou `src/pages/Auth.tsx` para o fallback "backend indisponível".
- Sem migrações, sem edge functions novas, sem mudança de RLS.
- Ações no banco (cancelar query, `cron.unschedule`) só depois da sua aprovação explícita.

## Pergunta antes de implementar

Quer que eu:
- **(a)** foque só na **blindagem do front** agora (item 2), para o app não ficar branco enquanto o backend se recupera; ou
- **(b)** também investigue/desative o **cron job 4** e tente cancelar a query longa (ação em produção)?
