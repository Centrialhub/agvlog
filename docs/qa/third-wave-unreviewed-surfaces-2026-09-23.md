# Terceira onda — superfícies ainda sem revisão específica

Base: `16d65a2c72ed8df6473b1571ccf0a4a3f9a11083` (`origin/main`). Esta onda evitou repetir as análises financeiras, de cargas, autorização, migrações, acessibilidade e qualidade estrutural já registradas em `docs/qa/full-system-audit-2026-09-16.md`, `docs/bugs.md` e `docs/qa/bugs-revisoes-locais-2026-09-23.md`.

## Escopo examinado

- Coerência do cache do shell PWA entre publicação online e ativação de um novo Service Worker.
- Exportadores CSV de ocorrências, controle de cargas, clientes rurais, relatório de frota, rastreabilidade e resultados de Ingestão. Os registros anteriores tratavam a neutralização de fórmulas em relatórios específicos, mas esses caminhos ainda usavam serialização própria ou concatenação direta.
- Persistência local relacionada: conferidos o escopo por empresa/ator dos outboxes e snapshots do motorista e a limpeza dos caches no logout. Os contratos existentes já exercitam o isolamento por empresa/ator; não houve alteração nessa área.

## Achados corrigidos

1. **P1 — shell offline misturava versões.** Uma navegação online sobrescrevia `/` no cache do worker ativo com o HTML de uma publicação mais nova. Se a rede caísse antes da ativação do novo worker, o fallback entregava esse HTML novo junto ao conjunto antigo de módulos em cache. O shell instalado agora permanece fixo até a ativação da próxima versão. Um teste sintético reproduziu a falha antes da correção e confirmou a resposta offline da versão instalada depois dela.
2. **P2 — exportadores CSV restantes não neutralizavam fórmulas.** Campos de usuário começando com `=`, `+`, `-` ou `@` saíam como células executáveis em ocorrências, controle de cargas, clientes rurais, frota, dois relatórios de rastreabilidade e dois CSVs de Ingestão. Esses fluxos agora usam `csvSafeCell`, inclusive para separadores e quebras de linha. O codificador compartilhado também reconhece fórmulas após espaços iniciais.

## Verificação

- `npx vitest run src/test/thirdWaveCsvExports.test.ts src/test/driverPwaUpgrade.test.ts src/test/occurrenceReports.test.ts src/test/ruralClients.test.ts src/test/productTraceabilityCsvSafety.test.ts --reporter=dot`: 54 testes aprovados.
- `npm run check`: aprovado, com 7.211 testes aprovados e 1 pulado; cobertura monitorada de 91,35% das linhas. Inclui typecheck, lint, higiene, contrato de release, sintaxe Edge e build.
- A inspeção final encontrou também os dois CSVs da tela de resultados da Ingestão. Após incluí-los, `npx vitest run src/test/ingestionCsvSafety.test.tsx src/test/thirdWaveCsvExports.test.ts --reporter=dot` passou com 10 testes; typecheck, lint e build foram repetidos e passaram.
- O build verificou que o artefato público não contém source maps nem material secreto reconhecido.

Limite: o teste PWA executa o script do worker com Cache Storage e rede simulados. Ele cobre a troca de versão e o fallback offline, mas não substitui uma prova em navegador instalado sob uma publicação real.
