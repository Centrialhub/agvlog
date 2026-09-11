# App Motorista — matriz final de conclusão

Data de corte: 10/09/2026.

Esta matriz separa três estados que não podem ser confundidos:

- **desenvolvimento local**: implementação e testes no repositório;
- **homologação hospedada**: migrations, Edge Functions, provedores e PWA publicados em ambiente isolado;
- **operação validada**: aparelhos físicos, estabilidade SSX/geofence e piloto de sete dias.

## Resultado executivo

| Dimensão | Estado | Evidência ou gate |
|---|---|---|
| Desenvolvimento local do escopo decidido | **concluído** | 953/953 testes em 118 arquivos; 95/95 no fechamento fiscal/carga; build, lint, typecheck do corte, qualidade e sintaxe de 73 Edge Functions aprovados |
| PWA/IndexedDB automatizados | **concluído localmente** | shell offline 3/3 e persistência nativa IndexedDB 6/6 |
| Revisão P0/P1 local | **concluída** | parecer independente sem P0/P1 aberto |
| Homologação Supabase isolada | **não iniciada** | não existe branch; criação custa US$ 0,01344/h e aguarda confirmação explícita |
| Implantação do núcleo App Motorista | **não iniciada** | produção não contém as entidades/filas/funções canônicas do módulo |
| Provedores reais | **não homologados** | geocodificação, remetente/webhook de e-mail e credenciais SSX ainda precisam ser configurados e exercitados |
| Aparelhos físicos | **não homologados** | Android atual, Android de baixa memória e iPhone ainda precisam executar a matriz |
| Estabilidade e piloto | **não iniciados** | 72 horas de SSX/geofence e sete dias com os 14 cenários obrigatórios |

Conclusão: o código local está fechado, mas o módulo permanece **no-go para produção**. “100% operacional” somente pode ser declarado depois dos gates hospedados e do piloto.

## Cobertura por sprint

| Fase | Desenvolvimento local | Homologação restante |
|---|---|---|
| Sprint 0 — contratos e segurança | concluído | repetir RLS, privilégios, idempotência e concorrência no PostgreSQL hospedado |
| Sprint 1 — endereços e geocodificação | concluído | publicar worker, configurar provedor e executar backfill em tenant de homologação |
| Sprint 2 — geofence e SSX | concluído | reconciliar trackers e cumprir 72 horas contínuas sem perda/duplicidade |
| Sprint 3 — carga, custódia e viagem | concluído | executar aceite, divergência, lacres, retorno e fechamento com dados hospedados |
| Sprint 4 — entrega e canhoto | concluído | executar NF-e, NFS-e, misto, sem CT-e, parcial, recusa e reentrega |
| Sprint 5 — scanner | concluído | validar papéis reais e processamento de até 3 s no Android de baixa memória |
| Sprint 6 — PWA e offline | concluído | instalar por A2HS/Compartilhar, reiniciar aparelhos e atualizar o PWA com pendências |
| Sprint 7 — entregas offline | concluído | exercitar modo avião, token expirado, upload interrompido e conflito remoto em aparelhos reais |
| Sprint 8 — operacional, físico e e-mail | concluído | configurar fornecedor/remetente/webhook, validar bounce/reenvio e conciliar papel real |
| Sprint 9 — despesas, observabilidade e hardening | concluído | validar métricas e fluxo completo com serviços publicados |
| Semana 11 — piloto | não aplicável ao código | executar 3–5 motoristas, 1–2 operadores e todos os 14 cenários por sete dias |

## Definition of Done

| Critério | Situação |
|---|---|
| Entrega não depende de CT-e | aprovado localmente; repetir hospedado e no piloto |
| NF-e e NFS-e isoladas e em conjunto | aprovado localmente; repetir os cenários 1–7 do piloto |
| Exatamente um canhoto por entrega | aprovado localmente |
| Total e parcial exigem canhoto e assinatura separada | aprovado localmente |
| Scan mostra somente o papel e permite ajuste dos cantos | aprovado localmente; validação visual em papéis/aparelhos reais pendente |
| Original, processado, thumbnail e PDF preservados | aprovado localmente; Storage hospedado pendente |
| Offline não perde canhotos, fotos ou assinaturas | IndexedDB real em Chromium aprovado; aparelhos físicos pendentes |
| Motorista não prossegue sem evidência durável | aprovado localmente; piloto pendente |
| Papel físico conferido no retorno | fluxo e bloqueios aprovados localmente; procedimento real pendente |
| Operacional valida, pesquisa, exporta e envia | aprovado localmente; envio por provedor real pendente |
| E-mails e downloads auditados | aprovado localmente; callback real pendente |
| Geofence e SSX estáveis por 72 horas | pendente |
| Todos os cenários fiscais e offline no piloto | pendente |
| Nenhum P0/P1 aberto | atendido no corte local; precisa permanecer verdadeiro até o fim do piloto |

## Invariantes confirmados

- o canhoto pertence à entrega, nunca ao CT-e;
- NF-e, NFS-e, CT-e e referências operacionais usam o catálogo documental comum;
- ausência de CT-e não bloqueia confirmação, PDF, busca, agrupamento ou envio;
- a outbox do motorista é um único object store IndexedDB para entrega, despesa, chegada, saída, jornada, checklist, ocorrência e carga;
- geofence de entrega é materializada a partir do destino geocodificado ou ponto confirmado no mapa, com polígono PostGIS e auditoria;
- RPCs de conflito SSX exigem papel operacional e correspondência com o tenant ativo, inclusive para usuários membros de várias empresas;
- conflito fiscal preserva os arquivos e exige decisão operacional; não produz ACK falso;
- encerramento/financeiro da viagem fica bloqueado enquanto a carga canônica não estiver fechada;
- OCR e portais permanecem P2 desativados até decisão do cliente/provedor e não são pré-condição do DoD atual.

## Sequência de fechamento operacional

1. Obter confirmação explícita do custo da branch Supabase.
2. Criar a branch isolada a partir do estado atual de produção.
3. Aplicar somente as migrations ausentes, em ordem, e publicar as Edge Functions do módulo.
4. Repetir testes SQL/RLS/concorrência e comparar Advisors antes/depois.
5. Configurar geocodificação, e-mail/webhook e SSX de homologação.
6. Publicar o PWA HTTPS e executar a matriz A1/A2/I1.
7. Cumprir o gate contínuo de 72 horas.
8. Executar os 14 cenários durante sete dias.
9. Corrigir qualquer P0/P1, reiniciando o gate afetado.
10. Registrar aprovação de Produto, Operação, QA e Engenharia antes do rollout.

O roteiro executável está em [driver-app-pilot-runbook-2026-09-10.md](driver-app-pilot-runbook-2026-09-10.md).
