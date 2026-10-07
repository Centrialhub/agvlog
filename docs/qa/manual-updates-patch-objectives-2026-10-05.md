# Objetivos e aceite do pacote manual

Este documento orienta o agente que irá combinar o pacote solicitado pelo cliente com a outra atualização local e testar o resultado. Registra os ajustes de navegação, filtro de XMLs por data de importação, seleção em lote, união de grupos antes de criar cargas e acesso do motorista por usuário e senha. Cada seção registra comportamentos esperados e a evidência disponível.

Registro inicial e atualização em 05/10/2026. Responsável pelo pacote: Thomaz. Situação: cinco demandas implementadas localmente. As quatro primeiras foram revisadas; a quinta tem testes de interface e de endpoint com respostas simuladas. Aplicação da migration, substituição das contas, integração e homologação do pacote combinado estão pendentes. As seções anteriores ao filtro de XMLs documentam especificamente a correção de navegação.

## Base e localização do trabalho

| Campo | Referência |
| --- | --- |
| Pasta de trabalho | `F:/AGVLOG/work/manual-updates` |
| Branch | `task/manual-updates` |
| Tarefa e owner no coordenador | `manual-updates` e `Thomaz` |
| HEAD de base deste ajuste | `deda6fd1fa765648f8de1785a1a7693081ad11bb` |
| Base publicada registrada no coordenador | `63278f7ef77dd1c4e0db7d9e7219ca48280ee18a` |
| Guia de coordenação | `F:/AGVLOG/README.md` |

O HEAD de trabalho contém a organização local sobre a base publicada registrada. As alterações e seus testes estão na árvore de trabalho, ainda sem commit. A outra atualização local não foi incorporada nem validada nesta etapa; sua seleção cabe à integração coordenada.

Antes de editar ou testar esta tarefa, executar:

```powershell
node F:/AGVLOG/agvlog.mjs check --task manual-updates --owner Thomaz --cwd F:/AGVLOG/work/manual-updates
```

Para outra tarefa, usar o identificador, owner e cwd atribuídos pelo coordenador. Consultar o estado atual; as referências acima são o registro deste ajuste, não uma autorização para trabalhar sobre uma base que ficou obsoleta.

## Problema e objetivo da correção

O cliente relatou que, ao navegar pelo sistema, a página não trocava e era necessário entrar novamente pela URL para abrir o destino.

O teste local reproduziu uma condição compatível com esse relato: ao clicar em um destino cujo módulo ainda estava carregando, a URL mudava, mas a tela anterior continuava visível, sem o indicador de carregamento. O `BrowserRouter` envolvia a atualização em uma transição React, que preservava o conteúdo já exibido enquanto a próxima tela suspendia.

O objetivo é tornar a navegação perceptível imediatamente: o conteúdo da página anterior deve ceder ao estado de carregamento e a página solicitada deve aparecer quando seu módulo estiver disponível, sem exigir nova entrada na URL.

Essa reprodução identifica um mecanismo corrigido no código. Não comprova, sozinha, que todos os casos observados em produção tenham a mesma causa. Falhas persistentes de download de módulos ou de serviços precisam ser investigadas separadamente caso apareçam na homologação.

## Arquivos e comportamento alterados

| Arquivo relativo ao repositório | Alteração |
| --- | --- |
| `src/App.tsx` | Define `useTransitions={false}` no `BrowserRouter`, para aplicar a navegação imediatamente e permitir que o `Suspense` existente mostre o carregamento. Inclui comentário explicando a escolha. |
| `src/test/appNavigationReportedBug.test.tsx` | Acrescenta quatro casos de regressão para carregamento de destino, perfis de acesso, histórico do navegador e nova navegação com módulo pendente. |
| `docs/qa/manual-updates-patch-objectives-2026-10-05.md` | Registra objetivos, validação local e critérios de aceite da integração. |

O ajuste alcança o roteador compartilhado pelo sistema interno, motorista e portal do cliente. A alteração de execução está concentrada em `src/App.tsx`; não há mudanças de banco, migrations, Edge Functions, regras de negócio ou dependências neste ajuste.

Os guards, permissões e recuperação de falhas de módulos continuam sendo os existentes. Durante a integração, preservar o comportamento de navegação imediata mesmo se a outra atualização também modificar o roteador. Uma solução equivalente precisa passar pelos mesmos critérios de aceite.

## Resultados esperados na árvore combinada

| Cenário | Resultado esperado | Aceite da integração |
| --- | --- | --- |
| Clique em uma página ainda não carregada | A URL aponta para o destino e aparece o indicador de carregamento; a página anterior não permanece como se ainda fosse o destino ativo. | Pendente |
| Conclusão do carregamento | A página solicitada aparece automaticamente, sem recarregar ou redigitar a URL. | Pendente |
| Nova escolha enquanto um destino carrega | Onde o menu estiver disponível, o usuário consegue escolher outro destino. A conclusão tardia do primeiro módulo não substitui a última página escolhida. | Pendente |
| Voltar e avançar no navegador | URL e conteúdo correspondem à entrada selecionada no histórico. | Pendente |
| Navegação entre páginas já carregadas | A troca continua funcionando sem recarga completa obrigatória. | Pendente |
| Perfis interno, motorista e cliente | A navegação funciona nas rotas permitidas de cada perfil e mantém redirecionamentos e bloqueios de acesso. | Pendente |
| Menu expandido, recolhido e móvel | Links reais abrem o destino correto; destaque e breadcrumb acompanham a página exibida. | Pendente |
| Links financeiros e fiscais | Usuário autorizado navega normalmente; negativa ou indisponibilidade não expõe conteúdo restrito nem impede sair para outra área permitida. | Pendente |

O teste novo usa rotas de exemplo para exercitar os três tipos de guard. Os caminhos `/vehicles` e `/reports` no teste de perfil motorista ou cliente não representam autorização dessas rotas para esses perfis no produto.

## Validação local já executada

Antes da correção, os quatro casos novos falharam porque a URL mudava e o texto `Carregando...` não aparecia; a página anterior permanecia exibida. Depois da correção, passaram.

A rodada direcionada final passou com **8 arquivos e 39 testes**, usando Node **22.16.0**, dois workers e timeout de 30 segundos por teste:

- `src/test/appNavigationReportedBug.test.tsx`
- `src/test/sidebarNavigation.test.tsx`
- `src/test/navigationChunkRecovery.test.ts`
- `src/test/navigationContract.test.ts`
- `src/test/financialRouteNavigation.test.tsx`
- `src/test/financeWorkspaceNavigationReportedBug.test.tsx`
- `src/test/cteHubNavigation.test.tsx`
- `src/test/allRoutesSmokeContract.test.ts`

Também passaram a verificação completa de tipos (`tsc --noEmit -p tsconfig.app.json`), o ESLint dos dois arquivos de código envolvidos com `--max-warnings 0` e `git diff --check`.

Na primeira rodada conjunta, o teste de contrato de links excedeu o timeout padrão de cinco segundos. Passou isoladamente e na rodada final acima. Não foi alterado para ocultar uma falha funcional.

Os testes usam jsdom; o novo teste substitui autenticação, tenant, layouts e catálogo de rotas por componentes controlados. A rodada usa configuração fictícia de serviço, sem validar banco remoto. Não foi executada homologação autenticada em navegador, build de produção ou a suíte completa do pacote combinado. Esses resultados locais não aprovam a entrega final.

## Repetição dos testes direcionados

Na pasta da tarefa autorizada, com as dependências do lockfile instaladas, usar Node 22 e npm compatível com `package.json`. Para reproduzir a rodada de testes isolados, executar no PowerShell:

```powershell
# Valores fictícios para esta rodada de testes; não usar em homologação ou deploy.
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key'

npx vitest run src/test/appNavigationReportedBug.test.tsx src/test/sidebarNavigation.test.tsx src/test/navigationChunkRecovery.test.ts src/test/navigationContract.test.ts src/test/financialRouteNavigation.test.tsx src/test/financeWorkspaceNavigationReportedBug.test.tsx src/test/cteHubNavigation.test.tsx src/test/allRoutesSmokeContract.test.ts --maxWorkers 2 --testTimeout 30000
npm run typecheck
npx eslint src/App.tsx src/test/appNavigationReportedBug.test.tsx --max-warnings 0
git diff --check
```

Usar uma sessão dedicada para os valores fictícios. Homologação deve receber a configuração real do ambiente isolado aprovado.

## Filtro de XMLs por data de importação em Criar Carga

O cliente precisa conseguir formar uma carga apenas com os XMLs recebidos em um dia ou período, inclusive no dia atual. A data usada deve ser a entrada da nota no sistema, independentemente da emissão ou do faturamento da NF.

### Alterações realizadas

| Arquivo relativo ao repositório | Alteração |
| --- | --- |
| `src/components/loads/NewLoadDialog.tsx` | Consulta também `fiscal_documents.imported_at`; acrescenta campos Importação de/até e botão Importados hoje; aplica o período à lista principal e à janela de notas recentes. Exibe data e hora de importação nas linhas e nos detalhes. |
| `src/lib/loads/newLoadImportDateFilters.ts` | Implementa o intervalo de dias no fuso da empresa, valida as datas e compara o instante de importação dos documentos. |
| `src/test/newLoadImportDateFilters.test.tsx` | Contém 14 testes de regras de datas, interface, seleção, payload de criação, consulta paginada, preferências e seleção/desmarcação em lote. |

O campo de referência é `imported_at`. Somente quando ele estiver ausente usa-se `created_at`, seguindo a compatibilidade já adotada no resumo de notas importadas. `issue_date` não participa do filtro. A data de criação não substitui um `imported_at` preenchido, mesmo quando ambas caem em dias diferentes. Uma data de importação inválida não é substituída pela emissão da nota.

O intervalo inclui todos os instantes entre o início do primeiro dia e o início exclusivo do dia seguinte à data final. Usa `currentTenant.timezone`, com `America/Sao_Paulo` como padrão quando o fuso não estiver disponível. O atalho Hoje acompanha a data civil da empresa, inclusive após a virada do dia; uma preferência salva como Hoje continua relativa ao dia atual ao reabrir a tela.

O filtro de datas é aplicado localmente sobre todas as páginas já consultadas pelo fluxo existente, antes de limitar a exibição inicial a 25 notas. A consulta mantém tenant, tipo inbound e exclusão de documentos apagados. Não houve alteração de schema, migrations, Edge Functions ou payload de negócio da criação. A ordenação Mais recentes agora acompanha o mesmo instante de importação exibido e filtrado.

As buscas por NF, cliente e bairro combinam com o período na lista principal. A janela de notas recentes compartilha o período de importação, preservando sua consulta ampla em relação aos campos de texto. Período invertido ou inválido gera mensagem explícita e não permite selecionar notas daquele resultado.

As preferências existentes continuam compatíveis: registros sem os novos campos abrem com datas vazias. A persistência atual salva também o período e o modo Hoje, respeitando a opção Usar apenas nesta sessão.

### Regra de seleção

Trocar filtros preserva as notas escolhidas anteriormente, como no fluxo já existente. A tela informa essa regra. Selecionar todos acrescenta as notas elegíveis do resultado às seleções atuais e mantém o bloqueio de notas já vinculadas a cargas.

Para criar uma carga somente com as notas importadas hoje, sem incluir seleções anteriores: usar **Desmarcar todos** nas seleções, clicar em **Importados hoje**, ajustar outros filtros se necessário, clicar em **Selecionar todos**, conferir o resumo e criar a carga. **Limpar filtros** remove o período e as buscas; não remove seleções.

### Resultados esperados na integração

| Cenário | Resultado esperado | Aceite da integração |
| --- | --- | --- |
| NF emitida em agosto e XML importado hoje | Aparece no filtro Hoje. | Pendente |
| NF emitida hoje e XML importado ontem | Não aparece no filtro Hoje. | Pendente |
| `imported_at` e `created_at` em dias diferentes | Prevalece `imported_at`. | Pendente |
| Registro antigo com `imported_at` nulo | Usa a data de entrada registrada em `created_at`. | Pendente |
| Período com início e fim iguais | Inclui o dia inteiro no fuso da empresa, inclusive frações de segundo; exclui os dias vizinhos. | Pendente |
| Apenas início ou apenas fim | Aplica somente o limite informado. | Pendente |
| Intervalo invertido | Mostra erro de validação, sem tratá-lo como resultado vazio normal. | Pendente |
| Hoje com fuso diferente do navegador e após meia-noite | Usa e atualiza o dia da empresa. | Pendente |
| Limpar filtros e reabrir com preferências antigas | Datas vazias voltam à busca sem restrição de período; preferências antigas não quebram a tela. | Pendente |
| Abrir notas recentes | Mantém o período e mostra a data de importação de cada nota. | Pendente |
| Selecionar todos com mais de 25 ou 500 notas | Considera todos os resultados elegíveis carregados, além da página visível e da primeira página da API. | Pendente |
| Seleções existentes fora do período | Continuam no resumo até remoção explícita, com orientação visível. | Pendente |
| Criar carga após limpar seleções e aplicar Hoje | Envia apenas IDs das notas elegíveis importadas no dia da empresa. | Pendente |

### Validação local do filtro

Na rodada inicial do filtro, antes da inclusão dos botões de seleção em lote, passaram **8 arquivos e 46 testes**, incluindo os **13 testes novos** daquela versão, com Node 22.16.0, dois workers e timeout de 30 segundos:

- `src/test/newLoadImportDateFilters.test.tsx`
- `src/test/newLoadDocumentSelection.test.ts`
- `src/test/newLoadDialogAccessibility.test.ts`
- `src/test/fetchAllPostgrestPages.test.ts`
- `src/test/loadCreationRecovery.test.ts`
- `src/test/loadCreationRelatedAudit.test.ts`
- `src/test/importedNotesTimezoneReportedBug.test.ts`
- `src/test/civilDayRefreshReportedBug.test.tsx`

O teste novo executa a consulta usando o cliente Supabase real com transporte controlado, sem acesso remoto. Exercita o diálogo real em jsdom e intercepta a criação para conferir os IDs enviados. Inclui 505 documentos para verificar consulta de todas as páginas e seleção além das 25 linhas iniciais. Autenticação contextual, preferências e comando de criação são controlados pelo teste; o resultado não comprova persistência remota nem criação real de carga.

O teste legado `loadCreationRelatedAudit.test.ts` inicializou PGlite em memória nesta rodada. Sua inclusão foi um desvio do planejamento de adiar testes de banco para a etapa coordenada. Não acessou banco remoto nem os serviços da frente ativa de frete. Deixar a repetição desse teste para a rodada de banco coordenada.

Passaram a verificação completa de tipos (`tsc --noEmit -p tsconfig.app.json`), o ESLint dos três arquivos de código deste ajuste e `git diff --check`. Build de produção e homologação autenticada do filtro permanecem pendentes.

Para repetir a seleção de testes desta funcionalidade **sem inicializar banco**, na tarefa autorizada com Node 22 e dependências instaladas:

```powershell
npx vitest run src/test/newLoadImportDateFilters.test.tsx src/test/newLoadDocumentSelection.test.ts src/test/newLoadDialogAccessibility.test.ts src/test/fetchAllPostgrestPages.test.ts src/test/loadCreationRecovery.test.ts src/test/importedNotesTimezoneReportedBug.test.ts src/test/civilDayRefreshReportedBug.test.tsx --maxWorkers 2 --testTimeout 30000
npm run typecheck
npx eslint src/components/loads/NewLoadDialog.tsx src/lib/loads/newLoadImportDateFilters.ts src/test/newLoadImportDateFilters.test.tsx --max-warnings 0
git diff --check
```

Na homologação isolada, usar notas com importação e emissão em dias diferentes e comparar com o resumo de notas importadas. Verificar Hoje, período customizado, limpeza e persistência dos filtros, janela de notas recentes e criação efetiva da carga com os IDs escolhidos. Registrar a data/hora de importação, o fuso da empresa e os IDs esperados e efetivamente vinculados à carga.

## Botões Selecionar todos e Desmarcar todos

O cliente solicitou ações explícitas para marcar e desmarcar XMLs em lote ao criar uma carga. Em `src/components/loads/NewLoadDialog.tsx`, os controles antes identificados como Selecionar filtradas e Limpar passam a se chamar **Selecionar todos** e **Desmarcar todos** e ficam sempre visíveis. Os títulos dos botões esclarecem o alcance de cada ação; a linha de controles permite quebra para acomodar telas menores.

Selecionar todos respeita os filtros ativos de importação, NF, cliente e bairro. Considera todos os resultados elegíveis carregados, inclusive além das 25 linhas visíveis e da primeira página da API. Preserva seleções anteriores e não duplica IDs quando acionado novamente. Sem filtros, seleciona todas as notas elegíveis consultadas. Notas vinculadas a outras cargas ou inelegíveis pelas regras existentes não entram na seleção em lote.

Desmarcar todos remove toda a seleção, inclusive notas que ficaram fora dos filtros atuais. Limpa também os dados agregados/autopreenchidos vinculados à seleção, conforme o fluxo existente. Mantém os filtros e o período de importação escolhidos. Permanece distinto de Limpar filtros.

| Cenário | Resultado esperado | Aceite da integração |
| --- | --- | --- |
| Abrir Criar Carga sem seleção | Ambos os botões aparecem; Desmarcar todos fica desabilitado. | Pendente |
| Selecionar todos com Hoje ou período e filtros de texto | Seleciona todas as notas elegíveis correspondentes, incluindo páginas não visíveis. | Pendente |
| Repetir Selecionar todos | Quantidade e IDs continuam sem duplicação. | Pendente |
| Desmarcar todos após mudar filtros | Remove também as seleções que ficaram ocultas e mantém os filtros atuais. | Pendente |
| Nenhuma nota elegível ou período inválido | Selecionar todos fica desabilitado. | Pendente |
| Lista atualizando ou criação em andamento | Selecionar todos fica desabilitado durante atualização; ambos ficam desabilitados durante criação. | Pendente |

Passaram **3 arquivos e 18 testes** nesta rodada: `newLoadImportDateFilters.test.tsx` (14), `newLoadDocumentSelection.test.ts` (3) e `newLoadDialogAccessibility.test.ts` (1). A cobertura inclui seleção/desmarcação de 505 notas, remoção de seleções ocultas, payload sem IDs após desmarcar, preservação do filtro Hoje e ausência de IDs duplicados. O ESLint dos dois arquivos de código envolvidos e `git diff --check` passaram. Esta rodada não inicializou banco; a verificação completa de tipos registrada na seção anterior pertence à versão anterior aos novos botões.

Homologar os dois botões no diálogo real, nos mesmos filtros da demanda de importação, e conferir os IDs efetivamente vinculados à carga após cada operação.

## Botão (+) para unir grupos antes de criar cargas

O cliente relatou que a primeira versão permitia juntar destinos antes de criar e movimentar a carga, por exemplo adicionando Espinosa ao grupo de Jaíba. A implementação atual reintroduz essa possibilidade em **Cargas → Agrupar NF-es → (+) no grupo de destino**. O histórico consultado não identificou o código exato do botão original; o aceite deve avaliar o comportamento solicitado.

Ao clicar no (+), aparece uma lista dos demais grupos pendentes, com destino, quantidade de notas e paletes. Escolher um grupo reúne suas NF-es ao grupo principal e atualiza cidades, notas, paletes, peso, valor e ocupação. O grupo incorporado deixa de aparecer como carga separada. É possível incorporar mais destinos, inclusive grupos já unidos. A ação **Separar grupos** desfaz toda a união daquele grupo e restaura os grupos originais ainda disponíveis. Cancelar união fecha o seletor sem alterações.

A união é um planejamento local do diálogo: nenhuma carga é criada ou movimentada ao clicar no (+). Somente **Criar N Carga(s)** confirma os grupos selecionados. Jaíba e Espinosa unidos geram uma chamada de criação com os IDs únicos dos dois grupos e destino `Jaíba - Espinosa`. O fluxo existente de criação agrupada e recuperação continua sendo usado, sem novas migrations ou alteração do contrato de banco. Homologar que a carga é criada no estado inicial previsto pelo contrato e permanece sem movimentação automática.

O grupo principal mantém suas escolhas de veículo e motorista, inclusive escolhas explícitas de nenhum. As escolhas do grupo incorporado não prevalecem. Depois da união, a carga principal fica selecionada, mesmo se os grupos estavam desmarcados. Separar um grupo marcado marca os grupos restaurados; separar um grupo desmarcado os mantém desmarcados. As escolhas dos grupos restaurados são sugeridas pelo fluxo existente; não há promessa de restaurar as atribuições anteriores do grupo incorporado.

A soma combinada deve respeitar a capacidade do veículo: exceder o limite mostra aviso e impede a criação até revisar o veículo ou a união. A identidade interna do grupo principal fica estável para as atribuições e a recuperação de criação, enquanto o destino exibido e enviado passa a incluir todos os grupos unidos. Notas e totais são reconstruídos da consulta atual: documentos que deixaram de ser pendentes não são mantidos no planejamento. Se um grupo principal perder todas as notas, os grupos restantes continuam no planejamento e apenas os destinos com notas aparecem no cabeçalho.

União e separação ficam bloqueadas durante atualização da consulta, criação em andamento, erro de contexto ou criação sem confirmação. Recuperar criação continua disponível mesmo se as notas não aparecerem mais na lista. Fechar o diálogo descarta as uniões temporárias; mudar de empresa também limpa as uniões e atribuições. Com apenas um grupo disponível, o (+) aparece desabilitado.

### Arquivos desta demanda

- `src/components/loads/PendingDocsGrouping.tsx`: controles, união/separação, seleção, destino combinado, bloqueios e validação de capacidade.
- `src/components/loads/PendingGroupPicker.tsx`: escolha do grupo a incorporar, com resumo e cancelamento.
- `src/lib/loads/pendingGroupCombinations.ts`: reconstrução dos grupos com notas atuais, IDs únicos e totais. Usa `mergeDestinations` existente para a convenção e deduplicação do texto de destino.
- `src/test/PendingDocsGroupingRecovery.test.tsx`: amplia a cobertura do diálogo de agrupamento, mantendo os casos de atribuições e recuperação existentes.

Os controles têm nomes acessíveis que identificam o destino. As linhas de controles e o seletor permitem quebra em telas estreitas; verificar o resultado visual na homologação.

A revisão anterior à integração corrigiu um caso adicional: se as notas do destino principal desaparecem, o operador incorpora outro grupo e depois as notas voltam, a união mantém a lista completa de destinos planejados. A proposta continua única, com os IDs atuais, sem criar dois cartões ou dois pedidos com a mesma identidade. O teste desse cenário falhou antes da correção, com aviso de chave React duplicada, e passou depois.

| Cenário | Resultado esperado | Aceite da integração |
| --- | --- | --- |
| Jaíba → (+) → Espinosa | Um grupo, destino Jaíba - Espinosa, soma de notas/paletes/peso/valor e nenhuma criação antecipada. | Pendente |
| Confirmar apenas o grupo unido | Uma única carga com todas as notas dos dois grupos, sem duplicação ou movimentação automática. | Pendente |
| Unir mais destinos ou dois grupos já unidos | Uma única proposta com todos os IDs únicos e totais corretos. | Pendente |
| Veículo e motorista escolhidos no grupo principal | Permanecem após a união, inclusive escolhas explícitas de nenhum. | Pendente |
| Soma excede a capacidade do veículo | Mostra aviso e bloqueia Criar; trocar para veículo compatível libera a criação. | Pendente |
| Cancelar união ou Separar grupos | Cancelar não altera a proposta; separar restaura os grupos e a seleção conforme o estado do grupo principal. | Pendente |
| Grupos previamente desmarcados | Ao unir, o grupo principal fica marcado e a quantidade de cargas considera só os grupos atuais. | Pendente |
| Consulta atualizada após união | Remove notas que deixaram de ser pendentes e recalcula destino e totais sem reintroduzir IDs antigos. | Pendente |
| Destino principal desaparece, outro grupo é incorporado e as notas principais voltam | Preserva uma única proposta com todos os destinos planejados e os IDs atuais; envia uma única criação. | Pendente |
| Criação em andamento, pendente de confirmação ou erro de contexto | Não permite modificar a união; mantém a recuperação pelo pedido original. | Pendente |
| Fechar/reabrir ou trocar de empresa | Não carrega uniões temporárias para a próxima abertura ou para outra empresa. | Pendente |
| Apenas um grupo ou nenhum XML pendente | Não oferece outro grupo inexistente; preserva o estado vazio e a recuperação. | Pendente |

### Validação local e limites

Passaram **7 arquivos e 51 testes** na rodada conjunta final com Node 22.16.0, dois workers e timeout de 30 segundos:

- `PendingDocsGroupingRecovery.test.tsx`: 13 testes do diálogo, incluindo as uniões e os dois casos anteriores de atribuições/recuperação.
- `loadCreationRecovery.test.ts`: 12 testes de recuperação e sugestões de atribuições.
- `loadReallocationMerge.test.ts`: 4 testes da composição de destinos usada pela união.
- `newLoadImportDateFilters.test.tsx`, `newLoadDocumentSelection.test.ts` e `newLoadDialogAccessibility.test.ts`: 18 testes dos filtros e seleção em lote.
- `appNavigationReportedBug.test.tsx`: 4 testes da correção de navegação.

Passaram também a verificação completa de tipos (`tsc --noEmit -p tsconfig.app.json`), ESLint sem avisos nos nove arquivos de código alterados do pacote e `git diff --check`. Esta rodada não inicializou banco nem acessou serviços remotos. Os testes do agrupamento controlam a consulta, contexto, atribuições e comando de criação; o diálogo e as ações de união são exercitados em jsdom. A criação real, a vinculação persistida das notas, o layout no navegador e o fluxo posterior de movimentação precisam ser verificados em homologação isolada após a integração. O build de produção e os gates completos da árvore combinada continuam pendentes.

Para repetir os testes direcionados do agrupamento sem inicializar banco, após o check do coordenador e com Node 22:

```powershell
npx vitest run src/test/PendingDocsGroupingRecovery.test.tsx src/test/loadCreationRecovery.test.ts src/test/loadReallocationMerge.test.ts --maxWorkers 2 --testTimeout 30000
npm run typecheck
npx eslint src/components/loads/PendingDocsGrouping.tsx src/components/loads/PendingGroupPicker.tsx src/lib/loads/pendingGroupCombinations.ts src/test/PendingDocsGroupingRecovery.test.tsx --max-warnings 0
git diff --check
```

## Revisão das solicitações antes da integração — 05/10/2026

Thomaz confirmou que estas são todas as solicitações e pediu uma revisão antes de unir as atualizações. A revisão foi feita apenas na tarefa `manual-updates`, na base registrada neste documento, sem integração, commit ou publicação.

| Solicitação | Resultado da revisão local |
| --- | --- |
| Navegação sem precisar entrar novamente pela URL | O router instalado suporta a opção usada; a navegação mostra o carregamento de páginas lazy. Testes cobrem perfis interno, motorista e cliente, voltar/avançar e uma segunda navegação durante carregamento. |
| Filtro pela importação do XML | Consulta `imported_at`, já existente no schema; usa `created_at` apenas no legado sem importação registrada, coerente com o resumo de notas importadas. Não usa emissão/faturamento. Validada composição com filtros de texto, limites do dia no fuso da empresa, Hoje e todas as páginas consultadas. |
| Selecionar todos / Desmarcar todos | Seleciona os resultados elegíveis dos filtros além da página visível, preserva escolhas anteriores sem IDs repetidos e permite limpar também as escolhas ocultas. Mantém a proteção contra notas vinculadas e os filtros ao desmarcar. |
| (+) para unir grupos antes de criar | Revisa notas/totais/capacidade e preserva atribuições do grupo principal; envia uma criação por proposta consolidada. Corrigida e testada a duplicação do grupo na sequência de desaparecimento e retorno das notas após nova união. |

Foram revistos os arquivos de implementação e testes, os guards e fallbacks de navegação, o schema de importação, a consulta paginada, a elegibilidade das notas, as sugestões de atribuições e o fluxo existente de criação/recuperação. A única falha reproduzida nesta revisão foi a duplicação de identidade descrita acima; está corrigida, com teste de regressão. Não foi identificada outra pendência bloqueadora dentro do escopo revisado. Isso não substitui o aceite operacional nem os gates do candidato combinado.

Na rodada ampliada após a correção, passaram **17 arquivos e 92 testes**, usando Node 22.16.0, dois workers e timeout de 30 segundos. A suíte de agrupamento agora tem **14 testes**; os 13 e o total de 51 da seção anterior são o registro da rodada anterior à revisão. Passaram também a verificação completa de tipos (`tsc --noEmit -p tsconfig.app.json`), ESLint sem avisos dos nove arquivos de código alterados e `git diff --check`. Não foram executados testes de banco, serviços da frente ativa de frete, criação remota de cargas ou testes pesados.

Saída da execução de testes:

```text
Test Files  17 passed (17)
Tests       92 passed (92)
Duration    19.18s
```

Comando para repetir esta rodada após o check do coordenador, na pasta autorizada e com Node 22:

```powershell
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key'
npx vitest run src/test/appNavigationReportedBug.test.tsx src/test/sidebarNavigation.test.tsx src/test/navigationChunkRecovery.test.ts src/test/navigationContract.test.ts src/test/financialRouteNavigation.test.tsx src/test/financeWorkspaceNavigationReportedBug.test.tsx src/test/cteHubNavigation.test.tsx src/test/allRoutesSmokeContract.test.ts src/test/newLoadImportDateFilters.test.tsx src/test/newLoadDocumentSelection.test.ts src/test/newLoadDialogAccessibility.test.ts src/test/fetchAllPostgrestPages.test.ts src/test/loadCreationRecovery.test.ts src/test/importedNotesTimezoneReportedBug.test.ts src/test/civilDayRefreshReportedBug.test.tsx src/test/PendingDocsGroupingRecovery.test.tsx src/test/loadReallocationMerge.test.ts --maxWorkers 2 --testTimeout 30000
```

Os valores de ambiente acima são placeholders para os testes locais e não exigem iniciar Supabase. A revisão atual não inclui build de produção nem homologação autenticada no navegador. A próxima etapa deve incorporar a outra atualização aprovada pela coordenação, conferir os arquivos compartilhados e executar o roteiro de homologação abaixo sobre a árvore combinada, antes de preparar o único commit final de entrega.

## Homologação após combinar as atualizações

1. Confirmar com Thomaz que as demandas manuais terminaram e selecionar a outra atualização aprovada conforme o guia. Integrar pela fila do coordenador, preservando o histórico. Não alterar a frente ativa de frete ou seu Git comum.
2. Conferir o resultado combinado de `src/App.tsx`, dos guards, dos layouts, de `src/components/loads/NewLoadDialog.tsx`, de `src/components/loads/PendingDocsGrouping.tsx`, dos comandos de criação, do login e do gerenciamento de motoristas/equipe caso a outra atualização toque esses arquivos. Preservar o uso de `imported_at`, a união antes da criação, a recuperação de pedidos e o contrato de acesso por usuário. Executar novamente os testes direcionados das cinco demandas.
3. Gerar o build do candidato combinado e homologar esse mesmo candidato em ambiente isolado, usando contas autorizadas dos perfis interno, motorista e cliente.
4. Em uma sessão nova, navegar pelo menu real entre páginas ainda não carregadas. Repetir com rede limitada para tornar o carregamento observável. Conferir conteúdo, URL, indicador de carregamento, destaque do menu e breadcrumb.
5. Testar voltar/avançar e, quando o menu continuar disponível, escolher uma segunda página antes que a primeira termine de carregar. Repetir com menus expandido, recolhido e móvel, além das áreas financeira e fiscal.
6. Verificar erros de console e rede. Se alguma tela continuar presa, registrar rota de origem, destino, perfil, tempo de espera e falha encontrada; não considerar a simples recarga da URL como aceite.
7. Executar os gates exigidos pelo guia: CI validate, todos os shards unit-tests, database-and-e2e e homologação do mesmo SHA/contrato. Coordenar testes de banco e testes pesados com a frente ativa de frete.
8. Em Cargas, preparar grupos com NF-es de Jaíba e Espinosa, unir pelo (+), comparar totais e conferir uma única carga persistida com todos os IDs. Testar separação, capacidade, recuperação de resposta incerta e movimentação posterior pelos controles normais. Executar também o aceite do filtro de importação e da seleção em lote, registrado nas respectivas seções.
9. Executar o roteiro de substituição e aceite das contas de motorista descrito abaixo. A exclusão não foi executada nesta tarefa; precisa do backend atualizado e da homologação prévia. Não considerar os testes com respostas simuladas como validação de banco ou Supabase Auth real.

O commit único final de entrega somente será preparado depois da conclusão de Thomaz, da incorporação dos candidatos aprovados e dos gates da árvore combinada. Validar também o SHA final e a equivalência das árvores, conforme `F:/AGVLOG/README.md`.

## Registro que o agente de integração deve completar

- SHA e tree hash do candidato combinado e do commit final, quando existir.
- Identificação da outra atualização incorporada.
- Ambiente, release, navegador e perfis usados na homologação.
- Resultados e links para logs dos testes direcionados e gates completos.
- Resultado de cada cenário de aceite, com evidência e falhas pendentes.

O patch de navegação será aceito quando os cenários acima passarem no candidato combinado. A entrega do pacote depende também dos objetivos das demais demandas e dos gates finais de release.

## Demanda 5 — Motorista com usuário e senha

### Objetivo e decisão do cliente

O motorista informa **usuário e senha**, sem precisar de e-mail. Internamente, a aplicação autentica usando `[username]@usuario.com` e a senha no Supabase Auth. A troca de senha é realizada por um administrador da empresa no painel operacional.

Thomaz determinou que **todas as contas atuais de motorista sejam excluídas e recriadas no novo modelo**. Não converter o e-mail ou preservar as credenciais de uma conta antiga. Manter o cadastro operacional do motorista (`drivers.id`), seus veículos, cargas, viagens, comprovantes e histórico. A conta nova recebe outro `auth.users.id` e é vinculada ao mesmo cadastro de motorista.

Exclusão de acesso é diferente de apagar o cadastro de motorista. O histórico contém chaves para `auth.users`, inclusive `ON DELETE RESTRICT`. Por isso, a implementação desativa os vínculos de acesso, remove o vínculo de login no motorista e executa **exclusão lógica do Auth** (`deleteUser(id, true)`), preservando a linha usada pelas referências históricas. A conta antiga fica sem acesso; não se trata de conversão para usuário. Não substituir isso por exclusão física sem tratar os históricos em uma demanda específica.

### Comportamentos implementados

- `/driver` e o app instalado, cujo início já é `/driver`, encaminham quem está desconectado para `/auth?access=driver`. O formulário mostra Usuário e Senha. O login do painel e dos clientes permanece por e-mail, com opção visível para escolher o tipo de acesso.
- O usuário é normalizado para minúsculas, removendo espaços nas extremidades. Aceita 3–40 caracteres ASCII, letras, números, ponto, hífen e sublinhado; começa/termina com letra ou número e não aceita `..` nem `@`. A unicidade é global no Auth: nomes repetidos exigem escolher outro nome, sem vincular ou assumir a conta existente.
- A senha mantém a política atual: mínimo de 12 caracteres, maiúscula, minúscula e número. Limite de 72 bytes para compatibilidade com o hash do Auth. A senha não é normalizada nem salva em caches, tabelas, notas, mensagens de erro ou respostas do endpoint.
- Em **Motoristas**, cada linha tem “Gerenciar acesso”. Cadastro ativo sem conta permite criar usuário/senha. Conta do novo modelo permite trocar a senha. Conta antiga exige exclusão e recriação. Criação vincula automaticamente o novo usuário ao motorista.
- Em **Equipe → Editar membro**, motoristas usam o mesmo controle de senha. O endereço sintético é apresentado como usuário na lista. Convites por e-mail e redefinição por e-mail continuam disponíveis para os outros perfis; a criação de motorista por convite foi retirada e é recusada pelo backend.
- **Motoristas → Excluir contas antigas** apresenta as contas restantes, solicita confirmação na própria tela, exclui as disponíveis uma a uma e informa sucessos/falhas. Inclui membros ativos/inativos e contas vinculadas a cadastros, mesmo com vínculo de acesso inconsistente. Consulta todas as páginas. Contas novas e contas já excluídas não são incluídas novamente.
- Contas compartilhadas com outras empresas, outros perfis, acesso ao portal ou permissões administrativas são bloqueadas para revisão. Não excluir a identidade global de um administrador, operador ou cliente para cumprir a limpeza dos motoristas. Resolver os vínculos bloqueados antes de dar o aceite de “todas as contas antigas substituídas”.
- Se a exclusão no Auth falhar após a desativação, o acesso permanece revogado e a tela permite tentar novamente. Os vínculos inativos são conservados no banco para histórico/identificação da tentativa, mas contas retiradas deixam de aparecer como membros gerenciáveis na Equipe.
- O app orienta o motorista a solicitar a senha à operação; não oferece redefinição por e-mail nem o formulário pessoal de `/set-password` para os logins sintéticos. Isso define o fluxo suportado na interface; não constitui um bloqueio universal dos endpoints próprios do Supabase Auth fora da aplicação.

### Arquivos e contrato de backend

| Arquivo ou conjunto | Alteração |
| --- | --- |
| `src/pages/Auth.tsx`, `src/app/routeGuards.tsx`, `src/pages/SetPassword.tsx` | Entrada por usuário para motorista e encaminhamento da troca de senha à operação. |
| `src/pages/Drivers.tsx`, `src/pages/TeamManagement.tsx` | Entrada dos controles de acesso, limpeza das contas antigas e remoção dos convites de motorista por e-mail. |
| `src/components/drivers/DriverAccessControls.tsx`, `LegacyDriverAccountsDialog.tsx` | Formulários de criação/troca de senha e substituição das contas antigas. |
| `src/lib/auth/driverCredentials.ts`, `driverAccess.ts`, `src/hooks/useRefreshDriverAccess.ts` | Política compartilhada, chamada do endpoint e atualização das listas. |
| `supabase/functions/_shared/driverCredentials.ts` | Política pura de usuário/senha, usada no navegador e no endpoint. |
| `supabase/functions/manage-driver-access/{index,handler}.ts`, `supabase/config.toml` | Endpoint com JWT obrigatório, validação da sessão e administrador ativo da empresa; ações inspect/create/password/legacy_list/retire_legacy. Service key somente no servidor. |
| `supabase/functions/create-team-member/index.ts`, `update-team-member/index.ts`, `list-tenant-members/index.ts` | Recusam convite/redefinição por e-mail para motoristas; listagem paginada trata contas retiradas sem falhar a consulta de membros. |
| `supabase/migrations/20261005204938_driver_username_access.sql` | Reserva com nonce, criação/vínculo atômicos, validação do escopo da conta, retirada de acesso e bloqueio de compartilhamento/promoção/reativação de logins gerenciados ou retirados. Criada com a CLI; ainda não aplicada. |
| `src/test/driverUsernameAccess.test.tsx`, `driverAccessHandler.test.ts`, `productionConfiguration.test.ts` | Cobertura local do fluxo e atualização do inventário de endpoints privilegiados/JWT. |

`prepare_driver_access_v1` reserva uma criação para o cadastro ativo sem login. O trigger já existente de convite foi ampliado para inserir membership e vincular o motorista na mesma transação da criação do usuário do Auth. Duas criações concorrentes para o mesmo motorista não devem deixar uma conta órfã. `driver_access_scope_v1` revalida empresa, ator, papéis e demais vínculos; na retirada, revoga memberships de tenant/workspace, remove papel global de motorista e desvincula o login antes da exclusão do Auth. As duas RPCs são executáveis somente pelo `service_role`; o frontend usa exclusivamente a Edge Function.

Os logins novos recebem marca de gerenciamento em `app_metadata`, além do vínculo relacional com a empresa. Não usar `user_metadata` como autorização. Triggers restringem novas vinculações/reativações de motorista ao novo modelo e impedem que uma conta gerenciada seja promovida a outro perfil, compartilhada ou tenha acesso ao portal. O protocolo normal de convite dos demais perfis é preservado. A desativação dos vínculos é necessária porque um JWT já emitido pode continuar válido por algum tempo após a exclusão no Auth.

### Aceite na homologação do candidato combinado

| Cenário | Resultado esperado | Estado |
| --- | --- | --- |
| App instalado e URL `/driver`, sem sessão | Abre Usuário/Senha; não pede e-mail. | Pendente no navegador real |
| Criar acesso para motorista ativo sem conta | Nova identidade, usuário único, membership driver e vínculo no mesmo cadastro, sem convite por e-mail. | Pendente no Auth/banco reais |
| Login com usuário, espaços externos e diferença de caixa | Autentica no app do motorista e mostra somente os dados permitidos ao mesmo motorista. | Pendente no Auth real |
| Usuário inválido/repetido e senha fraca | Mensagem adequada; sem conversão, sem tomar conta existente e sem vínculo parcial. | Cobertura simulada; banco pendente |
| Criar duas contas simultâneas para o mesmo motorista | Somente uma vinculada; a outra falha sem deixar usuário/membership órfãos. | Pendente de banco |
| Trocar senha no painel | Nova senha autentica; senha anterior deixa de autenticar. Login por e-mail de operador/cliente permanece funcionando. | Cobertura simulada; Auth real pendente |
| Limpar contas antigas, incluindo inativas e listas >500 | Todas as contas elegíveis excluídas; lista mostra falhas/bloqueios; contas novas preservadas. | Cobertura simulada; Auth/banco reais pendentes |
| Conta antiga com outros perfis/empresas/portal | Exclusão e troca privilegiada recusadas; resolver vínculo para finalizar substituição. | Handler simulado; SQL pendente |
| Conta excluída com sessão antiga | Não pode executar novas operações online, ler dados protegidos ou voltar a ser ativada/vinculada. | Pendente de RLS/Auth real |
| Recriar acesso de motorista com viagens existentes | Mesmo driver.id, novas credenciais e UID, viagens/cargas/comprovantes preservados; acesso correto ao app. | Pendente de banco/E2E |
| Tentativa de promoção, nova empresa ou portal para login gerenciado | Banco recusa mesmo fora da interface. | Pendente de banco |
| Pedido de senha pelo app | Orienta a operação. O painel de Equipe/Motoristas efetua a troca; nenhum e-mail sintético aparece como contato. | Interface testada; E2E pendente |

### Implantação e retorno

1. Integrar o candidato e coordenar banco/testes pesados conforme `F:/AGVLOG/README.md`. Aplicar a migration primeiro em homologação isolada com o contrato atual de Auth, `pgcrypto`, papéis e triggers. Verificar permissões, concorrência, revogação e referências históricas. Não iniciar limpeza de produção usando apenas os testes simulados.
2. Publicar na homologação o novo endpoint e as três funções alteradas, mantendo JWT habilitado para a administração, e o frontend do mesmo candidato. Conferir configuração hospedada da política de senha, criação confirmada sem convite e notificações de segurança do Auth para o domínio sintético. Não depender de SMTP para entregar credenciais de motorista.
3. Fazer inventário das contas atuais e dos cadastros antes da retirada; registrar bloqueios e a estratégia de entrega das novas credenciais pelo operacional, sem guardar senhas no relatório. Preparar backup e uma janela coordenada porque haverá motoristas sem acesso entre exclusão e recriação.
4. Com implantação autorizada, excluir as contas antigas pela tela, resolver todos os bloqueios, recriar cada acesso no cadastro existente e distribuir as credenciais pela operação. Não excluir os registros de motorista. Conferir que não restou conta antiga elegível, que cada motorista esperado tem um login novo e que os históricos permanecem íntegros.
5. No retorno, uma versão antiga do frontend não recupera senhas/identidades já excluídas. Preservar o backend e criar/corrigir acessos no novo modelo; qualquer restauração de backup precisa ser coordenada com os dados operacionais e Auth. Não desfazer automaticamente a migration nem restaurar papéis administrativos em contas de motorista.

**Nada deste roteiro foi executado no ambiente real nesta tarefa.** Não houve migration aplicada, conta excluída/recriada remotamente, envio de convite, alteração de senha real, deploy, integração ou commit final.

### Validação local desta demanda

A primeira rodada passou 29 testes novos. Após ampliar a cobertura de limpeza em lote, paginação e falha de exclusão, passaram **33 testes novos** em dois arquivos. A rodada conjunta com autenticação existente, navegação e controles de Equipe passou **8 arquivos / 78 testes**. Esses testes usam mocks/HTTP fixtures e não acessam Auth ou banco implantados. A sintaxe das Edge Functions passou em **97/97 arquivos TypeScript**. A verificação de tipos e ESLint local também passaram; os resultados da rodada final ampliada estão registrados a seguir.

Repetir, com Node 22 na pasta autorizada, os testes novos, `teamAccessReportedBug`, `teamAccessReportedBugs`, `authSessionIsolation`, `authClientConfiguration`, `authCoordination`, `productionConfiguration` e a rodada das quatro demandas. Executar os gates de banco/E2E somente depois da coordenação. A ausência de validação real de SQL/Auth é uma pendência de homologação desta quinta demanda.
