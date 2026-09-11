# Candidato de commit financeiro — rodada atual

Manifesto: `finance-current-round-commit-allowlist-2026-09-11.json`. Contém 112 arquivos exatos, SHA256 dos bytes atuais e HEAD observado. Nenhum stage, commit, push, deploy ou alteração de dados foi realizado por esta revisão.

O escopo é uploads/comprovantes e importação em quarentena; filtros globais de pagar/receber; correção versionada da cobrança de descarga; diagnóstico de XML existente e bloqueio da colisão lote/protocolo. A informação de implantação vem do coordenador. A lista não pretende comprovar homologação remota de cada arquivo.

## Exclusões importantes

A migração 053349 de cancelamento coordenado e seus componentes, contratos, outboxes, fixtures e testes estão explicitamente excluídos. SSX, motorista, DeliveryReceipts, geocodificação, cópias de deploy, Sites, caches, credenciais e binários de benchmark não entram. Bundles gerados `*-deploy-files*.json` não são necessários ao código-fonte desta entrega e ficaram fora; o manifesto resumido do preview foi incluído.

`supabase/config.toml` foi conferido: seu único diff é o preview com `verify_jwt=true`. O diff atual de `Receivables.tsx` contém filtro de origem e correção de cobrança, sem entrada para cancelamento coordenado. Ambos devem ser reconferidos pelo SHA imediatamente antes do stage, pois a árvore é compartilhada.

## Alterações anteriores e dependências ainda separadas

O JSON lista oito arquivos em `review_required_prior_or_shared_changes`: quatro migrations antigas com correções de instalação fresh, dois helpers compartilhados e navegação/teste de sidebar. Não pertencem automaticamente ao commit recente. Em especial, os testes de upload derivam de `movementCorrectionContextDatabase` e da migration190516 corrigidas no working tree; um checkout somente da allowlist sobre HEAD não pode ser declarado testado. O coordenador deve incorporar o commit anterior revisado desses ajustes ou verificar o candidato isolado antes de afirmar que todos os testes são reproduzíveis.

Outras alterações antigas e rollouts de implantação permanecem fora desta lista, sem serem descartadas. Relatórios históricos incluídos preservam o status local/sem deploy da data de autoria; não devem ser reescritos para simular testes posteriores. Os arquivos de aplicação do preview não fazem emissão fiscal nem promovem a evidência em título.

## Uso seguro

Selecionar exclusivamente os caminhos `files[].path`, após conferir hashes. Não usar `git add src`, `git add supabase`, glob financeiro ou `git add .`. Este documento e o JSON podem acompanhar o commit de auditoria; não se auto-hasheiam. SHA divergente exige revisar o novo diff, não regenerar silenciosamente a aprovação.
