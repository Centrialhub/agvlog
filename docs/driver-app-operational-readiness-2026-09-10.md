# App Motorista — ativação operacional

Este documento consolida o que precisa ser ativado e validado fora do código antes da liberação aos motoristas. O domínio de canhotos é por **entrega** e aceita NF-e, NFS-e, CT-e, outros documentos fiscais e referências operacionais como vínculos equivalentes.

O estado por sprint e por critério de aceite está consolidado em [qa/driver-app-completion-matrix-2026-09-10.md](qa/driver-app-completion-matrix-2026-09-10.md).

## Evidência local consolidada em 10/09/2026

- TypeScript, ESLint sem erros, baseline de qualidade, build de produção e sintaxe das 73 Edge Functions foram aprovados após o fechamento dos diffs desta rodada. Todos os chunks JavaScript ficaram abaixo do limite de 500 KiB definido pelo projeto.
- A execução completa mais recente percorreu 4.806 testes: **4.798 passaram**. As oito falhas restantes estão restritas a quatro suítes financeiras alteradas em paralelo e não pertencem aos fluxos do App Motorista. O fixture de reentrega que ainda simulava devolução sem objeto de evidência no Storage foi atualizado sem afrouxar o guard; o grupo relacionado passou **110/110**.
- O regressivo consolidado do App Motorista, canhotos, PWA, geofence/SSX, banco, RLS e configuração passou **730/730** em 77 arquivos.
- Depois desse regressivo, os fechamentos adicionais passaram em suítes dirigidas: scanner/projeção **10/10**, núcleo integrado motorista/canhotos/PWA/geofence **154/154**, geocodificação automática **53/53**, observabilidade **31/31** e rotas auxiliares offline **32/32**. As suítes se sobrepõem e, por isso, não devem ser somadas como quantidade de casos únicos.
- O shell PWA reabriu sem rede após o primeiro carregamento em Chromium mobile (1/1). Isso não substitui a matriz em aparelhos físicos.
- As lacunas locais P0/P1 encontradas na auditoria independente foram fechadas: foto obrigatória em recusa/devolução total, GPS imutável na entrega/canhoto, chegada automática pelo geofence SSX, exceções auditáveis do papel físico, filtros operacionais completos e divisão de e-mail pelo tamanho real dos PDFs.
- O scanner agora só dispara automaticamente quando há papel plausível e quatro bordas estáveis, usa transformação projetiva e amostragem bilinear, bloqueia corte severo e exige ajuste manual quando não consegue confirmar o contorno. O PDF mede a resolução pela área física ocupada na página, rejeita menos de 200 DPI e limita cada arquivo a 5 MiB.
- A geocodificação ganhou worker automático com lease, `SKIP LOCKED`, retry/backoff, cache, quota, auditoria append-only, reaproveitamento de endereço verificado e invalidação/rematerialização de geofence quando o endereço muda. O mapa permite selecionar e arrastar o marcador; o destino deixa de depender da digitação de coordenadas.
- Geofences de frota podem ser criadas e editadas por endereço ou marcador, incluindo raio, margem de entrada, histerese de saída e quantidade de confirmações. Geofences automáticas de entrega são exibidas como somente leitura e têm mutações diretas protegidas no banco.
- O tracking SSX usa paginação keyset estável por `(captured_at, point_key)` e continua lendo até uma página vazia, sem perder a cauda acima do limite do PostgREST; o teste de banco cobriu 5.001 posições. O fast-pass registra, com auditoria, entrada e saída quando existe um único ponto profundamente dentro entre dois pontos inequivocamente fora, sem converter oscilação de borda em evento.
- Checklist e ocorrências reabrem por snapshot local após hard reload, inclusive por link direto de viagem. Comandos pendentes ficam visíveis e isolados por empresa, usuário e viagem. A observabilidade opt-in expõe somente agregados do PWA/outbox/geofence, sem fotos, coordenadas, IDs operacionais ou texto livre.
- O ciclo de lacres agora é imutável (`instalado` → `removido`, `rompido` ou `ausente`), registra ator/data/motivo/evidência, impede reutilizar a mesma foto em lacres diferentes, bloqueia saída sem prova de instalação e bloqueia retorno/fechamento sem conciliação. Lacre rompido ou ausente abre divergência operacional.
- Dentro desse regressivo, o contrato dirigido de banco, RLS, configuração, geofence, canhotos, política de qualidade e canais por fornecedor passou 92/92; o fluxo físico adicional passou 4/4 e os filtros explícitos foram exercitados com viagem, carga, cliente, cidade, UF e recebedor.
- A auditoria final por sprints encontrou e fechou localmente dois P0 de infraestrutura: o dispatcher de workspace passou a acionar também a fila de geocodificação (inclusive sem conta SSX vencida), e o replay de `confirm_cargo` com lacres passou a devolver o mesmo resultado sem duplicar comando, auditoria ou evidência. A agenda SSX do dispatcher agora respeita os intervalos de poll/full sync configurados por empresa.
- O writer real agora materializa exatamente um canhoto em entregas exclusivamente NFS-e, sem `proof_of_delivery` artificial e sem exigir NF-e ou CT-e. A prova dirigida executou a RPC real e confirmou um recibo, um vínculo NFS-e, zero vínculos NF-e/CT-e e replay idempotente.
- Chegada offline e entrega offline passaram a compartilhar o overlay da outbox; a entrega aguarda comandos operacionais anteriores da mesma viagem antes do replay. Recusa e devolução total exigem todos os itens antes de qualquer upload, e SQLSTATE `40001` entra em revisão explícita em vez de retry infinito.
- A página Canhotos passou a selecionar todos os resultados filtrados de um fornecedor, não apenas os 25 visíveis; lotes acima de 100 são planejados integralmente. O histórico de e-mails ganhou busca, filtro e paginação server-side, e reenvio por snapshot imutável independente da página atual.
- Conflitos SSX de placa/vínculo agora têm fila persistente com SLA operacional de quatro horas, contagem de recorrência, estados aberto/resolvido, resolução transacional, ator, motivo e veículo escolhido. A resolução preserva os guards de viagem em andamento e de vínculo ativo único. O shell do motorista publica heartbeat opt-in a cada cinco minutos durante uso normal, e comandos operacionais repetem a mesma identidade após refresh coordenado de token.
- O heartbeat opt-in publica uma métrica dedicada de falhas de upload: total de tentativas, quantidade de itens afetados e contagem por tipo de comando. O sinal é derivado da outbox local e não inclui nome de arquivo, conteúdo, hash, caminho, IDs operacionais ou mensagem de erro. Entregas e despesas preservam o contador no mesmo registro durável até o ACK do servidor.
- A regressão dirigida posterior a esses fechamentos passou **137/137** em 14 arquivos. Typecheck, lint sem erros, sintaxe das 73 Edge Functions e build de produção passaram; o único gate que precisou de ajuste foi o limite estrutural de 500 linhas em um teste de canhotos, sem perda de cobertura.
- O fechamento final do App Motorista passou **953/953** testes em 118 arquivos. A bateria crítica de snapshot fiscal, NFS-e, conflito, quarentena, custódia, submissão e UI passou **95/95**; typecheck global, lint sem erros, baseline estrutural, sintaxe das 73 Edge Functions, build de produção, limite dos chunks e inspeção de artefato público também passaram.
- O E2E final confirmou o shell PWA offline em desktop, tablet e celular Chromium (**3/3**) e a persistência real em IndexedDB após reload/reabertura, incluindo canhoto original/processado/thumbnail, assinatura, foto, hashes, request ID e coexistência com atualização do cache (**6/6**).
- A revisão independente encerrou sem P0/P1 local aberto. O snapshot fiscal agora é travado e revalidado para NF-e e NFS-e; CT-e continua opcional. Conflito concorrente preserva arquivos e exige decisão operacional/nova tentativa. O encerramento canônico da carga bloqueia settlement, pagamento e consumidores financeiros, inclusive para legado quarentenado, sem alterar acertos já aprovados, pagos ou fechados.
- Uma auditoria final de tenant ativo encontrou e fechou uma brecha P1 nas RPCs autenticadas de revisão de conflito SSX: um operador membro de duas empresas não pode mais listar ou resolver conflito da empresa que não está ativa na sessão. A migration aditiva `20260910223000_harden_ssx_mapping_conflict_active_tenant.sql` preserva os privilégios mínimos existentes e falha fechada se os contratos anteriores mudarem. A regressão dirigida de tenant/SSX/geofence passou **33/33**, e o typecheck e o lint do teste passaram.
- O projeto Supabase principal foi reconectado e está `ACTIVE_HEALTHY` em PostgreSQL 17.6.1.084, sem branch de desenvolvimento. Em 10/09/2026 houve implantação paralela e seletiva de fundações de workspace, tenant, SSX e financeiro até `20260910221838_harden_dispatch_planned_route`; isso **não** representa a implantação do App Motorista. Continuam ausentes no remoto as tabelas canônicas de canhotos, snapshot/conflito fiscal, custódia/fechamento de carga, geocodificação e lotes de e-mail, bem como as Edge Functions de geocodificação, canhotos, OCR e portais.
- O baseline remoto dos Advisors foi atualizado antes da branch: segurança aponta 10 tabelas com RLS sem policy, 134 funções `SECURITY DEFINER` executáveis por usuários autenticados e proteção contra senhas vazadas desativada; desempenho aponta 24 chaves estrangeiras sem índice, uma tabela sem chave primária, 760 índices ainda não utilizados, 7 casos de policies permissivas múltiplas e alocação absoluta de conexões do Auth. Esses achados pertencem ao estado atual compartilhado de produção e precisam ser comparados com o resultado da branch; não devem ser atribuídos automaticamente ao App Motorista. Referências: [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [SECURITY DEFINER exposta](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [chaves estrangeiras sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) e [produção](https://supabase.com/docs/guides/deployment/going-into-prod).

## Ordem de implantação

1. Aplicar as migrations pendentes em ordem cronológica, com backup e janela de rollback.
2. Publicar as Edge Functions `geocode-address`, `send-delivery-receipts`, `delivery-receipt-email-webhook`, `process-delivery-receipt-ocr` e, somente após existir um adaptador de fornecedor homologado, `process-delivery-receipt-portals`, além das funções SSX alteradas.
3. Configurar os segredos abaixo e registrar o webhook do provedor de e-mail.
4. Publicar o build web em HTTPS e validar instalação do PWA em Android e iOS.
5. Executar o roteiro de homologação em empresa de teste, sem reutilizar dados de produção.
6. Fazer piloto controlado por 7 dias, com gate inicial de estabilidade nas primeiras 72 horas, antes da expansão para toda a frota.

## Configuração externa obrigatória

### Geocodificação

- `GEOCODING_BASE_URL`: endpoint do provedor contratado.
- `GEOCODING_USER_AGENT`: identificação e contato operacional válidos.
- O fallback público do Nominatim serve somente para homologação/baixo volume; produção precisa de provedor com SLA, política de uso compatível e capacidade contratada.

### E-mail de canhotos

- `RESEND_API_KEY`: chave restrita ao domínio remetente.
- `DELIVERY_RECEIPT_EMAIL_FROM`: remetente verificado.
- `RESEND_WEBHOOK_SECRET`: segredo de assinatura do endpoint `delivery-receipt-email-webhook`.
- Registrar os eventos de entrega, bounce e falha no provedor.
- Definir destinatários e modelos por fornecedor no briefing do cliente. Até lá, a tela exige revisão manual dos destinatários, assunto, mensagem, documentos e PDFs.
- A capa do PDF pode ser configurada por fornecedor; configuração e dados usados ficam congelados no lote para que um reenvio seja determinístico.
- A divisão dos lotes usa o tamanho real do PDF no Storage, reserva para a capa e expansão Base64; o backend revalida cinco PDFs, 5 MiB por arquivo e 25 MiB por mensagem, e o worker mede novamente o anexo final antes do provedor.
- O agrupamento usa a identidade CNPJ, ID ou nome presente em todos os documentos associados. NF-e, NFS-e e CT-e são referências pares, e uma entrega pode participar de grupos de fornecedores distintos quando seus documentos assim exigirem.

### Tracking SSX

- Confirmar credenciais e conta SSX por empresa.
- Conferir que cada viagem em andamento possui exatamente um veículo e um tracker ativo e inequívoco.
- Validar telemetria recente, fila sem atraso e ausência de bloqueios na tela de saúde da integração.
- Resolver toda ocorrência aberta na fila operacional de conflitos de placa/vínculo dentro do SLA de quatro horas. Nenhuma viagem pode iniciar enquanto o veículo não possuir exatamente um vínculo SSX inequívoco.

## Critérios de homologação do motorista

- Apenas uma viagem pode ficar em andamento para o mesmo motorista.
- A partida exige conferência/aceite de carga, veículo e custódia; divergências exigem aprovação operacional.
- Chegada por geofence deve funcionar com endereço geocodificado ou ponto escolhido no mapa, sem digitação manual de latitude/longitude no fluxo principal.
- Entrega total ou parcial exige scan recortado do canhoto e assinatura digital separada.
- O registro offline só libera a próxima parada depois de persistir arquivos e comando no IndexedDB; a tela deve manter “confirmação no servidor pendente” até o ACK.
- A reconexão deve repetir o mesmo `request_id`, sem duplicar entrega, despesa ou evento.
- Despesas exigem comprovante e entram como pendentes de aprovação, sem escrever diretamente no razão financeiro.
- Retorno/encerramento normal exige conciliação dos canhotos físicos. Papel ausente gera ocorrência operacional; dispensa exige proprietário/administrador, justificativa e trilha imutável de auditoria.
- O operacional deve localizar canhotos por fornecedor, data, viagem, carga, cliente, cidade/UF, recebedor, motorista, veículo e referências NF-e/NFS-e/CT-e; baixar PDF individual e enviar lote revisado por e-mail.

## Matriz mínima de dispositivos

- Android atual: Chrome, câmera, GPS preciso, instalação, fechamento forçado, modo avião e retomada.
- Android de menor memória: captura de canhoto, assinatura e sincronização de vários registros.
- iPhone atual: Safari/PWA instalado, permissão de localização, câmera, modo avião e retomada.
- Cenários: sinal intermitente, upload interrompido, token expirado, troca de empresa/usuário, pouco armazenamento, rejeição do canhoto, bounce de e-mail e indisponibilidade SSX.

## Go/no-go do piloto

O piloto somente começa quando migrations e funções estiverem implantadas, segredos válidos, PWA instalável, geocodificador de produção contratado e tracker SSX reconciliado. As primeiras 72 horas precisam transcorrer sem duplicidade, perda de evidência, avanço indevido de parada, vazamento entre empresas ou bloqueio sem recuperação; a expansão só ocorre após concluir os 7 dias do piloto. Incidentes críticos suspendem o rollout e preservam as filas locais para diagnóstico.

Antes de tocar produção, criar uma branch temporária do projeto Supabase, aplicar nela a sequência completa, publicar as Edge Functions e executar os testes SQL/E2E. O custo informado pelo Supabase para essa branch é de **US$ 0,01344 por hora** e exige confirmação direta do responsável antes da criação.

## Pendências externas para ativação operacional

O desenvolvimento local do escopo decidido nesta rodada está fechado, sem P0/P1 conhecido. O release permanece em **no-go** por depender de homologação e decisões externas que não podem ser simuladas pelo repositório:

- criar uma branch Supabase de homologação, aplicar toda a cadeia de migrations e repetir RLS, triggers, concorrência multissessão, paginação e Edge Functions no PostgreSQL hospedado;
- configurar provedor/segredos de geocodificação e e-mail, publicar as funções e validar callback real, bounce e reenvio;
- publicar o PWA em HTTPS e executar scanner, IndexedDB/reinício, GPS, instalação e retomada em Android e iPhone reais;
- reconciliar os trackers SSX, cumprir o gate de 72 horas de tracking/geofence e realizar o piloto controlado de sete dias;
- concluir com o cliente as decisões ainda abertas de destinatários/campos por fornecedor, retenção, OCR e eventuais portais.

A branch Supabase custa **US$ 0,01344 por hora**. Sua criação e qualquer aplicação remota aguardam confirmação explícita do responsável. A implantação seletiva que ocorreu em paralelo não publicou o núcleo do App Motorista nem substitui a branch de homologação.

## Cobertura local de persistência e limites dos testes

O teste `npm run test:driver-offline-browser` usa o IndexedDB nativo do Chromium, não um mock em memória. Ele grava pelo código real da entrega offline, fecha e reabre a página/banco, e confere byte a byte canhoto original/processado/thumbnail, assinatura e foto, além dos hashes e da identidade idempotente. Também substitui um snapshot de rota no object store de cache e confirma que a outbox permanece intacta. Os testes unitários do ledger interrompem o upload depois de cada slot possível, reabrem o rascunho durável e verificam que apenas os slots ainda pendentes são enviados; o teste do service worker mantém o cache anterior quando a instalação seguinte falha e confirma que a ativação do novo cache não chama `indexedDB.deleteDatabase`.

Ainda exigem aparelhos físicos e não podem ser considerados homologados apenas pelo Chromium automatizado:

- Android atual e Android de baixa memória: instalação via prompt/A2HS, ícone e abertura standalone, encerramento forçado pelo sistema, reinício do aparelho, pressão real de armazenamento, câmera, processamento de vários canhotos e retomada de upload em 3G/4G intermitente;
- iPhone atual: instalação pelo Safari/Compartilhar, abertura standalone, política de descarte de abas/PWA pelo iOS, câmera, assinatura por toque, permissão de localização e retomada após modo avião;
- ambos: revogação e nova concessão de câmera/GPS, GPS com precisão ruim e melhora posterior, troca real de rede Wi-Fi/celular, token expirado durante upload, bateria baixa/economia de energia e atualização entre duas versões publicadas do PWA;
- validação visual e documental do scanner em papéis reais (amassado, sombra, reflexo, baixa luz e múltiplos modelos), legibilidade do PDF resultante e ausência de perda após vários dias sem abrir o app.

## Evolução P2 — OCR e política de qualidade

O scanner já preserva original, imagem processada e thumbnail com hashes, recorte, cantos, rotação, métricas de qualidade e confirmação manual. A política de qualidade versionada também está pronta: resolução cliente → empresa → baseline, cache offline, limiares efetivos no scanner, bloqueio enquanto a política online é resolvida e snapshot imutável da regra aplicada. A fundação local do OCR está pronta: fila vinculada ao hash processado, lease exclusivo, retry/idempotência, rejeição de resultado obsoleto, busca por texto/confiança/status e worker seguro. Sem adaptador configurado, o worker marca o item como indisponível antes de ler o Storage, portanto não transmite a imagem nem PII.

Ainda dependem de decisão do cliente e autorização explícita:

- definição de OCR local/on-prem ou provedor contratado, idioma/modelo, SLA, custo, retenção, campos extraídos e níveis mínimos de confiança;
- credenciais, contrato de tratamento de dados e política de reprocessamento de itens indisponíveis;
- política para dados pessoais capturados no papel e limites finais de qualidade a cadastrar por cliente.

## Evolução P2 — canais por fornecedor

Os modelos de e-mail por fornecedor já são versionados; cada lote preserva o snapshot usado e registra se o operador personalizou destinatários, assunto, corpo ou capa. A fundação de portais também está pronta localmente: configuração sem segredos, catálogo de adaptadores, verificação de capacidades somente por serviço confiável, fila com lease e idempotência, eventos de auditoria e observabilidade no operacional.

O adaptador `supplier_portal_generic_v1` permanece propositalmente não implementado e desabilitado. O worker não contém transporte para fornecedor e não possui caminho de sucesso; portanto, nenhum portal é acessado e nenhum resultado é simulado. A ativação depende do briefing e de um adaptador específico. Consulte `docs/driver-receipt-supplier-channels-2026-09-10.md`.

## Decisões de negócio ainda abertas

- Campos adicionais exigidos pelo fornecedor no envio do canhoto.
- Catálogo de destinatários e modelos de e-mail por fornecedor.
- Prazo legal definitivo de retenção; a referência provisória é cinco anos.
- Confirmação do cliente de que a decisão adotada — papel ausente gera ocorrência e somente proprietário/administrador pode dispensar — atende à operação real.
- Indicadores e limites finais do piloto acordados com o cliente.
