# Estado pós-correções — 28 de agosto de 2026

> As referências a MFA/AAL2 neste relatório foram substituídas em 28/08/2026
> pela autenticação de fator único com autorização obrigatória por tenant e
> papel. O estado operacional vigente está em `production-runbook.md`.

## Parecer executivo

As correções autônomas possíveis no código e no Supabase de produção foram
concluídas. Seis dos sete domínios estão em 100% no pacote local; SSX permanece
adiado conforme orientação. Em produção, os seis domínios não SSX estão em 99%:
o backend, as 29 Edge Functions e os contratos de banco estão reconciliados,
mas Auth hospedado, sincronização integral do frontend e E2E com identidades
reais ainda exigem autenticação, MFA ou confirmação do usuário.

O `hub-fiscal-proxy` foi promovido para a versão 63 com JWT obrigatório, import
map, CORS restritivo, isolamento multi-tenant e gate AAL2. A rodada final também
endureceu os contratos multi-tenant de fechamento financeiro, motorista/veículo,
perfil rural, EDI, credenciais de emissão, regiões de cliente, devolução de
pallets, tabelas de frete, pedidos, incidentes, eventos CT-e/SEFAZ e todo o grafo
de monitoramento de motoristas. Os smokes transacionais de fechamento e
pallets passaram e foram integralmente revertidos por `ROLLBACK`.

Produção ainda não deve ser declarada 100%: `/auth/v1/settings` continua
indicando cadastro público habilitado (`disable_signup=false`), a proteção
contra senha vazada está desabilitada, o frontend hospedado não contém todo o
pacote local aprovado e faltam jornadas E2E AAL2/operador/motorista/cliente. Os
percentuais representam prontidão verificável, não SLA.

## Prontidão por aplicação

| Aplicação / domínio | Pacote local | Produção efetiva | Evidência e lacuna atual |
|---|---:|---:|---|
| TMS administrativo, cargas e roteirização | **100%** | **99%** | RPCs canônicas, RLS, concorrência, auditoria e rotas estão aplicadas. Falta a jornada E2E autenticada completa e a sincronização integral do frontend hospedado. |
| Aplicativo do motorista | **100%** | **99%** | Relação viagem/carga, POD, uploads e mutações estão publicadas. O smoke RLS real encontrou 2/2 cargas e 2/2 viagens autorizadas. Falta E2E no dispositivo. |
| Financeiro, RH e manutenção | **100%** | **99%** | Contratos, RLS, pagamentos e buckets privados de 10 MB estão aplicados. Falta smoke autenticado de pagamento/upload. |
| Plataforma web, Auth e Supabase | **100%** | **99%** | 29/29 Edge Functions estão `ACTIVE`, incluindo o proxy fiscal reconciliado; MFA privilegiado e CORS estão aplicados. Cadastro pela API e proteção de senha vazada ainda dependem do painel autenticado. |
| Portal do cliente | **100%** | **99%** | RPCs, isolamento, POD backend-only e CSV seguro estão em produção. Falta E2E com uma conta cliente real. |
| Fiscal — CT-e, NFS-e, MDF-e e ORT | **100%** | **99%** | Inbox idempotente, dead-letter, polls e todas as Edge Functions, inclusive `hub-fiscal-proxy` v63, estão publicadas. Falta ping AAL2 e smoke fiscal não destrutivo autenticado. |
| Torre de controle / frota / SSX | **90%** | **87%** | Política de frescor e rotinas estão publicadas. A credencial SSX segue em `invalid_credentials` e o recadastro foi adiado. |

**Pacote local: 6 de 7 aplicações em 100% (85,7%); média 98,6%.**

**Produção efetiva: 0 de 7 em 100%; média 97,3%.**

## Alterações finais aplicadas em produção

Projeto confirmado: `qcvnsdrbcchaxvawcngk` (`PROJETO AGV LOG`,
`sa-east-1`). Nenhuma escrita foi feita no projeto alheio
`fqamejlyytrhovawgtwg`.

- `hub-fiscal-proxy` versão 63 está `ACTIVE`, `verify_jwt=true`, com import
  map e hash remoto
  `0236ebcf08f55f097ec4f1d440de487d259c728a7542d7e99a1a2a4e69e19446`.
- CORS foi comprovado com `OPTIONS 200` para a origem oficial e sem wildcard
  para origem hostil. Um `POST` sem JWT retornou 401 e apareceu no log da
  própria versão 63.
- A migração `20260828105626_hide_driver_rls_helpers_from_data_api` moveu seis
  helpers `_driver_*` para o schema não exposto `private`.
- A migração `20260828110409_hide_policy_only_driver_helpers_from_data_api`
  moveu `driver_can_access_vehicle` e `driver_owns_stop`, usados somente por
  políticas, para o mesmo schema.
- A migração `20260828113034_harden_tenant_mutation_rpcs_and_cte_monitor`
  adicionou gates de tenant a acertos de motorista e atualização de funcionário,
  validou todas as referências cruzadas, tornou quatro RPCs legados exclusivos
  de `service_role` e substituiu os dois overloads quebrados do monitor ICMS por
  uma assinatura canônica `_tenant_id uuid` protegida por AAL2.
- As 18 referências RLS dependentes foram preservadas pelo OID das funções.
  `authenticated` tem somente `USAGE/EXECUTE` interno; `anon` não tem
  `USAGE` no schema privado.
- Nove migrações adicionais fecharam os contratos multi-tenant de fechamento
  financeiro, atribuições motorista/veículo, perfil rural, EDI, credenciais de
  emissão, regiões, pallets, tabelas de frete e pedidos. Os três arquivos cujo
  timestamp local divergia do ledger foram renomeados para a versão efetivamente
  registrada em produção, evitando reaplicação futura pelo CLI.
- O ledger remoto agora tem 352 entradas e termina na migração
  `20260828151937_remove_duplicate_driver_monitoring_indexes`.
- Cinco novas migrações validaram 16 FKs adicionais para incidentes, ações,
  eventos CT-e/SEFAZ e monitoramento de motoristas. O advisor revelou cinco
  índices idênticos criados durante o endurecimento; somente as cópias foram
  removidas, preservando os índices preexistentes e zerando esse alerta.
- O contrato SQL atualizado passou diretamente em produção com 187/187 tabelas
  públicas sob RLS, 278 funções públicas, 719 políticas, 993 índices, 430 chaves
  estrangeiras validadas e zero constraint não validada.
- Os tipos TypeScript foram novamente reconciliados com o catálogo: tamanho,
  conteúdo FNV-1a e enumeração de RPCs coincidem com a geração remota.
- A conta owner/admin AAL1 continua bloqueada pela tela de verificação em duas
  etapas, sem erro ou warning no console.
- O smoke pós-migração, executado sobre as definições já implantadas e revertido
  por `ROLLBACK`, negou as quatro operações para um ator aleatório e permitiu a
  passagem pelos gates de associação/monitor para um admin ativo em AAL2.
- O smoke de devolução de pallets criou protocolo e item, validou quantidade 3,
  executou a transição `draft -> returned`, conferiu duas entradas de histórico
  e terminou em `pallet_return_smoke_passed`, sempre dentro da transação revertida.
- O frontend local respondeu HTTP 200 em `127.0.0.1:4174`, entregou o elemento
  raiz e carregou o asset JavaScript principal também com HTTP 200.
- Na leitura final dos logs, API teve 81 respostas 200, três 204 e 16 respostas
  406, todas restritas às consultas `positions_last`/`positions_raw` sem linha do
  polling SSX adiado. Auth teve 44 eventos sem falha; Edge teve 100/100 respostas
  200; Postgres teve 100/100 entradas `LOG`, sem `ERROR`, `FATAL` ou `PANIC`.
- Nenhuma emissão, cancelamento, descarte, entrega fiscal ou e-mail foi usado
  como smoke test.

## Segurança e consistência

1. Cargas usam mutações canônicas transacionais e transições de estado
   auditáveis; gravações diretas perigosas foram removidas do papel autenticado.
2. RLS de pagamentos, integração, emissores, mensagens, portal e fiscal está
   consolidada, sem sobreposição permissiva conhecida.
3. Owner/admin requer AAL2 no frontend, nas políticas/helpers do banco e nas
   Edge Functions humanas com `service_role`.
4. Portal e POD revalidam ator, tenant, cliente e documento no backend; CSV
   neutraliza formula injection.
5. Polling fiscal tem teto, backoff e dead-letter atômico; webhooks usam inbox
   idempotente, lease e conclusão explícita.
6. Credenciais usam envelope `enc:v1:`, não aparecem em logs e falham fechado
   quando a chave não as decifra.
7. Oito helpers `SECURITY DEFINER` de política deixaram de ser endpoints RPC.
   Os oito helpers restantes no schema público são dependências diretas do
   frontend, de RPCs de produto ou de centenas de políticas e não podem ser
   movidos sem uma migração ampla de corpos PL/pgSQL e E2E.
8. Acertos manuais, associação de cargas e atualização de funcionário agora
   rejeitam ator sem permissão e referências de outro tenant; o relatório ICMS
   deixou de consultar colunas inexistentes e exige tenant administrativo AAL2.
9. Exclusões de CT-e/NFS-e, aprovação de despesas, alertas, checklists, frete e
   monitoramento agora exigem tenant ativo, filtram gravações por tenant e não
   silenciam falhas intermediárias. Consultas que referenciavam colunas
   inexistentes (`invoice_numbers`, `vehicles.license_plate`, `tara_kg`) foram
   corrigidas para o catálogo real.

## Gates finais

| Gate | Resultado |
|---|---|
| TypeScript | zero erro; 16 barreiras adicionais ativas, incluindo `noImplicitAny` e `strictNullChecks` |
| ESLint bloqueante | zero erro |
| ESLint crítico tipado | zero aviso nos fluxos incluídos no gate |
| ESLint completo | 385 avisos, todos `no-explicit-any`; redução acumulada de 491 (56,1%) |
| Sintaxe Edge | **37/37** arquivos aprovados |
| Vitest | **51 arquivos, 422/422 testes aprovados** |
| Contrato Supabase estático | **36/36** testes aprovados |
| Contrato Supabase em produção | catálogo e smokes transacionais aprovados |
| Build | Vite 6.4.3, 4.148 módulos |
| Bundle | aprovado; maior JavaScript com 488,3 KiB |
| Auditoria npm | 0 vulnerabilidades na última execução; dependências não mudaram |
| Tipos Supabase | geração local/remota idêntica; 569.556 bytes, FNV-1a `30e2e3ee` |

O build emite apenas o aviso não bloqueante de `caniuse-lite` com 14 meses.

## Advisors remotos

- Segurança: **140 avisos**. Um é a proteção de senha vazada desabilitada. Os
  outros 139 são funções `SECURITY DEFINER` executáveis por `authenticated`;
  essa categoria exige revisão função a função porque inclui RPCs legítimas do
  produto. As revogações comprovadamente seguras já foram aplicadas; uma
  revogação em massa quebraria a API autenticada.
- Performance: **561 informações**, sendo 560 índices sem uso observado e uma
  configuração absoluta de dez conexões do Auth. Os cinco avisos de índice
  duplicado foram eliminados. Não remover índices sem janela representativa de
  tráfego e análise de planos.

Referências: [funções SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [proteção de senha](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [produção/conexões Auth](https://supabase.com/docs/guides/deployment/going-into-prod).

## Intervenções externas restantes

1. Autenticar no painel Supabase do projeto correto para desabilitar cadastro
   público, ativar proteção de senha vazada, revisar senha mínima/complexidade e
   confirmar TOTP/URLs permitidas. O conector disponível não expõe mutação da
   configuração Auth e o painel aberto está na tela de login.
2. Confirmar a transmissão de uma sessão AAL2 e concluir o MFA para executar o
   ping autenticado do proxy e as jornadas owner/admin.
3. Autorizar a sincronização integral do frontend local para o provedor
   hospedado. O upload de código para serviço externo exige confirmação no
   momento da transmissão.
4. Executar E2E com contas reais de operador, motorista e cliente, incluindo
   POD, upload, pagamento e tentativas cross-tenant.
5. Quando SSX voltar ao escopo, regravar a senha exclusivamente pela tela segura
   e comprovar telemetria fresca por 24 horas.

## Dívida estrutural não bloqueante

A auditoria encontrou 484 arquivos de aplicação/Edge, 114 acima de 300 linhas,
59 acima de 500 e 12 acima de 1.000, excluindo testes e tipos gerados. Os 73
diagnósticos de `noImplicitAny` e os 167 de `strictNullChecks` foram eliminados;
ambas as regras agora integram o gate normal. A dívida remanescente concentra-se
nos 385 usos explícitos de `any` e na divisão dos God Components, que deve ser
feita por domínio e precedida por cobertura E2E.

## Conclusão

O máximo de correções seguras sem nova autenticação/intervenção foi executado.
O backend e as 29 Edge Functions estão reconciliados, os gates locais estão
verdes e seis aplicações atingem 100% no pacote local. A produção permanece em
97,3% verificável até fechar Auth hospedado, sincronização do frontend, E2E com
sessões reais e, posteriormente, SSX.
