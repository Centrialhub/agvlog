# Plano de desenvolvimento para 100% de prontidão de produção

**Data-base:** 28 de agosto de 2026  
**Escopo de liberação:** núcleo administrativo, cargas, rotas, motorista, portal do cliente, autenticação, banco, storage, segurança, desempenho, observabilidade, recuperação e processo de entrega.  
**Exceções operacionais temporárias:** SSX e emissão/integração fiscal. Essas áreas serão entregues desativadas para o usuário final, mas com arquitetura, configuração, segurança, monitoramento e roteiro de ativação preparados.

## Objetivo

Alcançar 100% de prontidão significa que todos os critérios de go-live definidos neste documento estão aprovados e possuem evidência reproduzível. Não significa ausência total de dívida técnica; significa que não existe risco conhecido sem controle para segurança, integridade, disponibilidade ou execução das jornadas incluídas no escopo.

O produto não deve comunicar SSX ou fiscal como funcional enquanto essas capacidades estiverem fora do escopo. Elas devem aparecer como desativadas ou em implantação, sem ações que possam produzir estados parciais.

## Estado validado em 28/08/2026

### Controles aprovados

- TypeScript aprovado.
- ESLint sem erros.
- Lint de arquivos críticos aprovado.
- 36/36 arquivos TypeScript de Edge Functions aceitos pelo gate sintático.
- 55 arquivos de teste e 446/446 testes aprovados.
- Build de produção e orçamento de bundle aprovados.
- Maior chunk JavaScript: aproximadamente 488,3 KiB, ainda abaixo do limite de 500 KiB.
- Auditoria npm atual: zero vulnerabilidades conhecidas.
- React Router 7.18.2, Vite 6.4.3 e Vitest 3.2.7.
- `xlsx` substituído pela distribuição SheetJS 0.20.3.
- Jornada do motorista passou a resolver carga/viagem pela tabela canônica `dispatch_trip_loads` e possui teste de contrato.
- Alterações de status de carga e composição de itens passaram a usar RPCs canônicas.
- Layout interno possui navegação móvel em drawer.
- `/merchandise-shortages` não monta mais um segundo `AppLayout`.
- Cadastro no código passou a ser somente por convite, com senha mínima de 12 caracteres.
- CORS de Edge Functions, dependências pinadas, configuração JWT, baseline e tipos possuem testes de contrato.
- Portal possui teste de neutralização de fórmula em CSV.
- Headers de segurança estão declarados em `vercel.json`.

### Pendências que ainda impedem 100%

1. Não existe suíte E2E automatizada no repositório.
2. As correções recentes do motorista, portal e responsividade ainda precisam de nova homologação direta pós-correção.
3. Não existe evidência de um staging Supabase isolado e reproduzível para testes com mutação.
4. O Auth hospedado ainda foi observado com cadastro público habilitado, apesar do código/configuração local invite-only.
5. O portal continua sem homologação real com conta cliente e massa de dois tenants.
6. MFA privilegiado está deliberadamente desabilitado; exige implementação ou aceite formal com controles compensatórios.
7. Faltam testes reais de RLS/RPC contra banco descartável, além dos contratos estáticos/unitários atuais.
8. Backup/PITR está documentado, mas falta evidência de restauração testada.
9. Falta observabilidade de frontend e correlação ponta a ponta com alertas operacionais.
10. Acessibilidade, paginação/virtualização e estados de erro/carregamento precisam de homologação objetiva.
11. O CI não executa E2E, cobertura mínima, teste de restauração/migração nem `lint:critical-types` de forma explícita.
12. Há 382 avisos `no-explicit-any`, 98 arquivos acima de 300 linhas, 51 acima de 500 e sete acima de 1.000.
13. Browserslist está 14 meses desatualizado.
14. O projeto usa Bun 1.1.34 e mantém dois lockfiles; o audit npm pode não representar exatamente o grafo instalado pelo Bun sem uma verificação de paridade.

## Regra para SSX e fiscal fora do escopo

### Comportamento no lançamento

- Implementar flags explícitas `ssx_enabled` e `fiscal_enabled`, preferencialmente como capacidades por tenant verificadas no backend.
- O frontend pode usar flags para apresentação, mas o backend deve negar operações desativadas; não confiar apenas em variável `VITE_*`.
- Esconder ou desabilitar botões de sincronização, emissão, cancelamento, polling e callbacks operacionais.
- Exibir estado “Integração em implantação” em vez de erro, sucesso falso ou valores zerados.
- Pausar os crons dessas integrações enquanto a capacidade estiver desativada.
- Saúde operacional deve diferenciar `disabled`, `not_configured`, `degraded` e `healthy`.
- Não exigir credenciais SSX/fiscais para o boot do núcleo, mas falhar fechado ao tentar ativar a capacidade sem todos os secrets.

### Preparação obrigatória antes da liberação do núcleo

- Schema, RLS, RPCs, filas, inbox, dead-letter e índices devem aplicar normalmente em staging e produção.
- Todas as Edge Functions devem compilar e ser implantáveis, mesmo desativadas.
- Secrets devem possuir nomes, owner, destino, rotação e checklist documentados; valores não devem ser colocados no repositório.
- URLs de callback, allowlists, CORS, contratos de payload e ambientes sandbox devem estar documentados.
- O monitoramento deve reconhecer a integração desativada sem gerar alarmes falsos.
- Deve existir kill switch independente por integração e por tenant.

### Roteiro posterior de ativação

1. Configurar credenciais no Vault e validar criptografia/rotação.
2. Ativar somente no staging/sandbox.
3. Executar testes de contrato, callback duplicado/fora de ordem, retry e falha.
4. Ativar um tenant canário em produção, mantendo crons gerais pausados.
5. Monitorar durante 24 horas e reconciliar todos os registros.
6. Ativar os demais tenants progressivamente.
7. Reverter pela flag/kill switch se qualquer SLO ou contrato falhar.

## Plano de execução

## Onda 0 — congelar o contrato de lançamento

**Objetivo:** impedir que recursos excluídos ou configurações divergentes contaminem o release.

### PR-001 — Capacidades por tenant

- Criar fonte canônica de capacidades com leitura segura por tenant.
- Validar capacidades em RPCs e Edge Functions sensíveis.
- Adaptar menus, botões e páginas para estado desativado explícito.
- Pausar agendamentos relacionados quando a capacidade estiver desligada.

**Aceite:** chamadas diretas ao backend também são negadas; a UI nunca apresenta operação concluída; os testes cobrem tenant habilitado e desabilitado.

### PR-002 — Configuração hospedada de Auth

- Desabilitar signup no projeto Supabase correto.
- Configurar senha mínima e política de complexidade no ambiente hospedado.
- Habilitar proteção contra senhas vazadas quando suportada pelo plano.
- Confirmar allowlist HTTPS de `/set-password`.
- Aplicar e verificar as migrações de autorização de convite.
- Decidir MFA para owner/admin. A opção recomendada é MFA obrigatório; se adiado, registrar aceite formal, sessão curta, rate limiting, auditoria e procedimento de revogação.

**Aceite:** tentativa de signup público falha no backend; convite expira; nonce não pode ser reutilizado; usuário define a própria senha; owner/admin segue a política aprovada.

### PR-003 — Unificar toolchain e lockfiles

- Atualizar Bun para uma versão suportada e homologada.
- Escolher um único lockfile como fonte de instalação.
- Se `npm audit` continuar no CI, gerar/verificar `package-lock.json` a partir do mesmo `package.json` e bloquear divergência com o lock do Bun.
- Atualizar Browserslist.

**Aceite:** checkout limpo + instalação congelada + `bun run check` reproduz o resultado do CI; auditoria representa exatamente o grafo liberado.

**Dependências:** nenhuma.  
**Prioridade:** P0.

## Onda 1 — staging e dados determinísticos

**Objetivo:** permitir testes destrutivos seguros e repetíveis.

### PR-010 — Staging Supabase isolado

- Criar projeto/branch separado de produção.
- Aplicar baseline e migrações forward em banco vazio.
- Executar `baseline_contract.sql`, advisors e geração de tipos.
- Configurar secrets de teste diferentes dos de produção.
- Desabilitar integrações externas reais e usar sandbox/mocks controlados.

### PR-011 — Seed E2E

Criar massa idempotente contendo:

- tenant A e tenant B;
- owner/admin, operador, motorista e cliente;
- motorista ativo com uma e múltiplas cargas;
- viagem com paradas, entrega e POD de teste;
- clientes, veículos, rotas, documentos e registros suficientes para paginação;
- dados de outro tenant para provar isolamento;
- estados vazio, erro, carregamento, sucesso e permissão negada.

Nunca usar credenciais pessoais ou dados produtivos no seed.

### PR-012 — Reset e teardown

- Comando único para recriar banco e storage de teste.
- Limpeza restrita ao projeto/tenant E2E.
- IDs previsíveis ou aliases recuperáveis após o seed.

**Aceite da onda:** qualquer desenvolvedor ou CI recria o ambiente, executa contratos e obtém o mesmo conjunto de dados sem tocar produção.  
**Dependências:** PR-001 e PR-002.  
**Prioridade:** P0.

## Onda 2 — E2E automatizado e homologação funcional

**Objetivo:** provar as jornadas incluídas no escopo.

### PR-020 — Base Playwright

- Adicionar Playwright com projetos Chromium desktop e viewport móvel.
- Usar fixtures por papel; segredos somente no cofre do CI.
- Capturar trace, screenshot e vídeo apenas em falha.
- Implementar selectors por papel/label/test-id estável.
- Proibir dependência de ordem entre testes.

### PR-021 — Autenticação e autorização

- Login, logout, recuperação de sessão e convite.
- Acesso de owner/admin, operador, motorista e cliente.
- Guards de rota.
- Troca de tenant.
- IDOR/BOLA com IDs do tenant B.
- Signup público bloqueado.

### PR-022 — Cargas e operação

- Criar carga no staging.
- Inserir/remover/mover itens somente pelas RPCs.
- Validar transição permitida e rejeitar transição inválida.
- Planejar rota, atribuir motorista e iniciar viagem.
- Conferir auditoria e totais recalculados.

### PR-023 — Jornada do motorista

- Login → selecionar carga → resolver viagem canônica.
- Listar paradas → iniciar → chegar → finalizar entrega.
- Registrar ocorrência, checklist, despesa e POD de teste.
- Reabrir a sessão e comprovar persistência.
- Mostrar erro/retry quando a query falhar; não converter erro em estado vazio.
- Validar celular real ou device emulado, teclado e permissões.

### PR-024 — Portal do cliente

- Validar as dez telas com conta cliente.
- Dashboard, remessas, detalhes, documentos, POD, faturas e relatórios.
- Confirmar que erros de RPC aparecem como erro, não como zero ou “sem acesso”.
- Neutralizar CSV e validar download.
- Provar isolamento entre clientes e tenants.

### PR-025 — Administração e smoke de rotas

- Smoke automatizado de todas as rotas registradas.
- Rotas dinâmicas com IDs reais do seed.
- 404, aliases e lazy chunks.
- Executar no build de produção, não apenas no servidor de desenvolvimento.

**Aceite da onda:** 100% dos cenários críticos aprovados três vezes consecutivas em staging; nenhum teste flaky; artefatos de falha disponíveis no CI.  
**Dependências:** Onda 1.  
**Prioridade:** P0.

## Onda 3 — segurança, banco e recuperação

**Objetivo:** transformar controles estáticos em evidência operacional.

### PR-030 — Testes reais de RLS/RPC

- Executar cenários com tokens anon, cliente, motorista, operador, admin e service role.
- Testar SELECT/INSERT/UPDATE/DELETE e funções expostas.
- Confirmar `USING` e `WITH CHECK` em alterações.
- Confirmar que helpers privados e `SECURITY DEFINER` não são APIs acidentais.
- Bloquear grants anônimos ou novos objetos sem RLS.

### PR-031 — Migração e drift

- Aplicar todas as migrações em banco vazio.
- Comparar schema/tipos com o ambiente alvo.
- Bloquear `db push` cego em banco populado.
- Validar postconditions e ledger por nome lógico.
- Executar advisors e impedir novos alertas graves.

### PR-032 — Upload e conteúdo

- Validar limites de tamanho, MIME, extensão e assinatura real.
- Rejeitar path de outro tenant.
- Definir retenção e remoção.
- Integrar varredura antimalware ou quarentena se documentos externos forem aceitos.

### PR-033 — Backup e desastre

- Confirmar backup/PITR contratado e retenção.
- Restaurar em ambiente isolado.
- Executar contratos SQL após restauração.
- Medir RPO/RTO e documentar responsáveis.

### PR-034 — Segurança da aplicação publicada

- Validar headers no domínio real.
- Fazer smoke de CSP sem violações bloqueantes.
- Executar DAST leve nas rotas públicas/autenticadas.
- Confirmar ausência de secrets no bundle e source maps públicos.
- Validar rate limiting de login, convite, upload e Edge Functions sensíveis.

**Aceite da onda:** zero vulnerabilidade crítica/alta sem exceção formal; zero acesso cross-tenant; restauração comprovada; signup público bloqueado no serviço hospedado.  
**Dependências:** Onda 1.  
**Prioridade:** P0/P1.

## Onda 4 — observabilidade e operação

**Objetivo:** detectar, explicar e recuperar falhas antes que o usuário precise reportá-las.

### PR-040 — Telemetria do núcleo

- Adotar ferramenta de captura de exceções no frontend ou pipeline equivalente.
- Correlation ID entre browser, Edge Function e banco quando aplicável.
- Logs estruturados com allowlist; sem tokens, cookies, documentos ou payloads completos.
- Marcar versão/release e tenant de forma não identificadora.

### PR-041 — Alertas e SLOs

Definir SLOs iniciais para:

- disponibilidade do frontend e APIs;
- taxa de erro de login e convite;
- latência p95 das principais telas/RPCs;
- falhas de Edge Functions e filas;
- erros de upload/POD;
- exceções não tratadas no frontend;
- falha de cron, distinguindo sucesso HTTP de sucesso de negócio.

### PR-042 — Runbooks e rollback

- Atualizar checklist de deploy, rollback e incidente.
- Definir owner e canal de escalonamento.
- Fazer exercício de rollback de frontend e Edge.
- Preferir migração corretiva forward-only para banco.

**Aceite da onda:** alerta sintético é recebido e conduz ao runbook; erro possui release e correlação; rollback ensaiado; nenhuma informação sensível nos logs.  
**Prioridade:** P1.

## Onda 5 — UX, acessibilidade e desempenho

**Objetivo:** tornar o sistema utilizável em volume e em diferentes dispositivos.

### PR-050 — Estados de tela

- Padronizar `loading`, `error`, `empty`, `success` e `permission denied`.
- Nunca transformar erro técnico em zero ou lista vazia.
- Adicionar retry seguro e mensagens acionáveis.

### PR-051 — Paginação e virtualização

Priorizar clientes, documentos, cargas/detalhes, auditoria, faturamento, produtos e demais listas acima de 100 registros.

- Paginação server-side com contagem opcional.
- Debounce em busca e filtros persistentes.
- Virtualização quando a página precisar manter grande volume local.
- Queries com índices verificados por plano de execução.

### PR-052 — Acessibilidade

- Nome acessível para botões somente com ícone.
- Cards clicáveis substituídos por link/button ou recebem semântica completa.
- Diálogos com título e descrição.
- Ordem de foco, escape, contraste e teclado.
- Executar axe no E2E e zerar violações críticas/graves.

### PR-053 — Responsividade

- Revalidar sistema interno em 390×844, tablet e desktop.
- Revalidar motorista em dispositivos Android de referência.
- Garantir ausência de overflow e alvos de toque adequados.

### PR-054 — Performance

- Medir Web Vitals e p50/p95 das jornadas.
- Manter orçamento de chunks e tratar o bundle de planilhas, que está próximo do teto.
- Carregar planilhas/PDF/mapa apenas sob demanda e preferir Worker em operações pesadas.
- Estabelecer orçamento por rota e falhar CI em regressão material.

**Aceite da onda:** axe sem crítico/grave; mobile sem bloqueio; listas suportam massa do seed; budgets e SLOs aprovados.  
**Dependências:** Onda 2.  
**Prioridade:** P1.

## Onda 6 — manutenibilidade e sustentabilidade

**Objetivo:** reduzir risco de regressão e custo de evolução sem atrasar o go-live por refatoração cosmética.

### PR-060 — Refatorar fluxos críticos primeiro

Fora do fiscal, priorizar:

1. `OperationalEvents.tsx` — 2.108 linhas;
2. `Ingestion.tsx` — 1.653 linhas;
3. `DriverDeliveries.tsx` — 1.147 linhas;
4. `RoutePlanning.tsx` — 1.054 linhas;
5. `TeamManagement.tsx` — 977 linhas;
6. `OperationsCenter.tsx` — 933 linhas.

Extrair camada de consulta, regras/transformações, estado de formulário, tabela e diálogos. Cada extração deve vir acompanhada de teste de caracterização.

### PR-061 — Tipagem e lint

- Reduzir os 382 `no-explicit-any` por domínio.
- Começar pelos contratos Supabase, motorista, cargas, autenticação e portal.
- Adicionar `lint:critical-types` explicitamente ao workflow.
- Criar baseline decrescente; não permitir novos `any`.
- Reativar detecção de imports/variáveis não usados como erro.

### PR-062 — Complexidade

- Limitar novas funções por tamanho e complexidade.
- Extrair validadores e mapeadores puros.
- Reduzir funções extensas antes de alterar regras de negócio nelas.

**Aceite:** nenhum novo arquivo crítico acima de 500 linhas; nenhum novo `any`; fluxos críticos refatorados possuem testes; dívida restante está registrada, priorizada e não afeta o gate operacional.  
**Prioridade:** P1/P2.

## Onda 7 — CI/CD e release candidate

### PR-070 — Pipeline obrigatório

O pipeline deve executar, em ordem:

1. instalação congelada;
2. auditoria de lockfile real;
3. typecheck;
4. lint sem erros e lint crítico sem warnings;
5. sintaxe de Edge Functions;
6. unitários com cobertura mínima;
7. contratos SQL/RLS em Supabase descartável;
8. build e orçamento de bundle;
9. E2E desktop/mobile;
10. upload de traces/relatórios;
11. smoke do preview/deploy.

### PR-071 — Estratégia de promoção

- Pull request → preview frontend + banco/branch isolado.
- Staging → testes completos e homologação.
- Produção → artefato imutável já aprovado.
- Aprovação manual apenas após relatório do gate.
- Rollback para artefato anterior sem rebuild.

### PR-072 — Release candidate

- Executar 48–72 horas de soak do núcleo com SSX/fiscal desativados.
- Processar jornadas completas com os quatro papéis.
- Corrigir qualquer P0/P1 e reiniciar a janela de soak quando necessário.
- Registrar decisão formal de go/no-go.

**Aceite:** pipeline verde no mesmo commit/artefato publicado; zero teste flaky conhecido; smoke pós-deploy aprovado; rollback disponível.  
**Prioridade:** P0.

## Ordem recomendada e paralelização

| Sequência | Frente | Pode ocorrer em paralelo com |
|---|---|---|
| 1 | Onda 0 — flags, Auth e toolchain | início do desenho do staging |
| 2 | Onda 1 — staging/seed | observabilidade básica |
| 3 | Onda 2 — E2E | Onda 3 — segurança/RLS/backup |
| 4 | Onda 4 — observabilidade | Onda 5 — UX/performance |
| 5 | Onda 6 — refatoração crítica | expansão do E2E |
| 6 | Onda 7 — pipeline e release candidate | documentação final |

Com uma equipe pequena de dois desenvolvedores e uma função de QA/PO disponível para homologação, a ordem acima tende a ocupar aproximadamente três a cinco semanas. Para uma pessoa, considerar seis a oito semanas. São estimativas de planejamento, não compromissos, e dependem principalmente da disponibilidade de staging, conta cliente e configuração hospedada.

## Critérios finais de 100%

### Produto e acesso

- Todas as rotas do escopo possuem smoke automatizado.
- Admin, operador, motorista e cliente concluem suas jornadas críticas.
- Cadastro público está bloqueado no backend hospedado.
- Convite, senha e MFA/controle compensatório estão homologados.
- Recursos SSX/fiscal aparecem como desativados e não aceitam chamadas diretas.

### Dados e segurança

- Zero leitura ou mutação cross-tenant em testes reais.
- Escritas canônicas passam pelas RPCs previstas.
- Zero vulnerabilidade crítica/alta não aceita formalmente.
- Uploads e downloads respeitam tenant, tipo, tamanho e expiração.
- Headers e CSP validados no domínio final.

### Confiabilidade

- E2E crítico aprovado três vezes consecutivas.
- Backup restaurado e RPO/RTO conhecidos.
- Alertas e rollback ensaiados.
- Erros não são convertidos em estados vazios.
- SLOs mínimos atendidos no soak de 48–72 horas.

### Qualidade de entrega

- CI executa todos os gates no artefato promovido.
- Instalação e lockfiles são reproduzíveis.
- Sem teste flaky conhecido.
- Cobertura mínima definida para módulos críticos.
- Dívida remanescente possui owner, prioridade e não afeta segurança/operação.

## Resultado esperado

Ao concluir as ondas 0, 1, 2, 3 e 7, o núcleo poderá entrar em release candidate. As ondas 4 e 5 precisam estar aprovadas antes do go-live. A onda 6 deve concluir as refatorações dos arquivos críticos que sofrerão mudanças frequentes, mas não deve bloquear o lançamento por métricas puramente cosméticas quando o comportamento estiver protegido por testes e controles operacionais.

SSX e fiscal permanecerão fora do SLA funcional inicial, claramente desativados, mas prontos para um processo de ativação controlado por configuração, sandbox, canário, monitoramento e rollback.
