# PATCH2 - reconciliação dos hotfixes publicados em09/10

Task patch2-hotfix-reconciliation-20261012/CodexMerge; base12577fdd05d2e98aa294d5fcfc74ee4aa56b07a5/tree6397d719c0326dc827531fa50d71d0b2b84da327. Incorporação local autorizada12/10 para homologação; nenhuma publicação ou alteração produtiva.

Entrypoints byte-idênticos aos aprovados: geocode-address v14 SHA642f551360af4897ffe9c0724e10f1883a73c3cbfa94f7bd0725f6d2c9abf2a2 e process-address-resolution-queue v10 SHA9c5d34026a0db21ce119524fd957d96ad037b3a2349bb36ae8fda4130daaa210. Os sete outros blobs dos bundles já eram idênticos e não foram editados.

Registradas versões reais20261009151836 e20261009161011 no suplemento (13originais+13follow-ups+7supplements), conservando os cinco registros e duas âncoras anteriores.151836 é reconstrução revisada dos postconditions publicados, original comando exato indisponível;161011 contém bytes da SQL aprovada/aplicada. Proposta153500 permanece somente histórica, não incluída. Não executar novamente esses reparos em produção; confirmar ledger e efeitos antes de qualquer aplicação. Histórico anterior preservado sem reescrever migrations.

Leitura produtiva12/10 14:50:11UTC:927migrations; ambos reparos presentes, trêsRPCs de endereço sem40001/comP0001 e hashes aprovados; cron26OFF. SSXforwards20261007122904/20261007131504 ausentes e agora retroativos em relação ao maxledger: dbpush automático continua fora do caminho de publicação.

Regressões adaptam apenas transporte mock abortSignal e VM AbortController/clearTimeout, e aplicam a contenção completa antes de exigirP0001. Contraprovas históricas/guards/ACL/tenant/replay/atomicidade continuam exigidas. Testes e relatório final do novoSHA serão registrados fora desta fonte em C:/Users/Thomaz/Documents/Codex/2026-10-01/task/patch2-homologation-20261012. Nenhum PASS histórico8391/1skip ou62emergência será atribuído ao novoSHA.

Native não aprovado: WSLUbuntu-24.04 estáStopped no inventário12/10; janelas antigas expiradas. Sem iniciardaemon/containers, geocodificação/SSX externos ou excluir contas. Forge/Braces bloqueados e não modificados; LEG1815 aberto e guard500 não é contrato externo documentado. Cadastro interno e criação de conta permanecem separados. Publicação depende dos gates aplicáveis no candidato combinado, revisão/aceite e coordenação final.
