# AGVLog TMS

Plataforma web multi-tenant para operação logística: cargas, viagens, torre de controle, frota, aplicativo do motorista, portal do cliente, documentos fiscais e financeiro.

## Arquitetura

- React 18, TypeScript, Vite, TanStack Query e Tailwind no frontend.
- Supabase Auth, Postgres com RLS, Storage, RPCs e Edge Functions no backend.
- Integrações externas isoladas em Edge Functions: SSX, Hub Fiscal e roteamento OSRM.
- `load_items` é a fonte de verdade da composição de cargas; `dispatch_trip_loads` é a fonte de verdade do vínculo viagem-carga. Consulte [o contrato de dados](docs/data-contract.md) antes de alterar esses fluxos.

## Requisitos

- Node.js 22 e npm 10.9.4 (fixados por `.node-version`, `engines` e `packageManager`).
- Docker para o stack Supabase descartável e os testes E2E.
- Supabase CLI instalado pelo lockfile do projeto.

## Desenvolvimento local

```sh
cp .env.example .env
npm ci
npm run dev
```

Preencha apenas a URL, a chave publicável e o identificador público do projeto no `.env`. Service role, chaves fiscais, credenciais SSX e demais segredos pertencem ao cofre de secrets do Supabase, nunca ao frontend.

## Validação

```sh
npm run check
```

Esse comando executa typecheck, lint geral e crítico, sintaxe das Edge Functions,
testes com cobertura e build de produção com orçamento máximo de 500 KiB por
chunk JavaScript. O job `database-and-e2e` do GitHub Actions acrescenta reset
Supabase, contratos SQL/RLS e Playwright desktop/tablet/mobile.

Para o E2E local, inicie e resete o stack isolado antes de exportar `API_URL` e
`ANON_KEY` retornados por `supabase status -o env` como variáveis `VITE_*`. O
Playwright recusa por padrão qualquer backend não local.

## Produção

- Aplique migrações antes de publicar o frontend.
- Faça deploy das Edge Functions respeitando o `verify_jwt` de `supabase/config.toml`.
- Mantenha o Auth invite-only, com senha mínima de 12 caracteres e TOTP/AAL2
  obrigatório para proprietário e administrador.
- Configure `AGVLOG_APP_ORIGIN` com a origem HTTPS exata do frontend; o CORS das
  Edge Functions falha fechado quando essa configuração está ausente ou inválida.
- Configure um `OSRM_BASE_URL` aprovado e dedicado; a aplicação falha de forma segura sem ele.
- Mantenha SSX e fiscal desativados por tenant até homologação específica; as
  Edge Functions e os crons falham fechado quando as flags estão desligadas.

O procedimento completo de deploy, smoke test e rollback está no [runbook de produção](docs/production-runbook.md). A torre de controle e suas regras estão descritas em [docs/control-tower.md](docs/control-tower.md).
