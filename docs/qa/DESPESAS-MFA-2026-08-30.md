# MFA na criação de despesas — correção forward

Estado: implementação local, não publicada. A prontidão integral do aplicativo continua não comprovada.

## Evidência e causa

Com as definições reais dos helpers MFA de 28/08, owner/admin em AAL1 conseguiam consultar contexto, criar despesa, recuperar confirmação e recalcular acerto manual. A revisão da mesma despesa era corretamente negada. Três testes preservam essa reprodução local; não houve tentativa contra produção nem comprovação de exploração histórica.

A criação consultava membership ativa e papel, mas não a garantia MFA do JWT. Além disso, políticas de leitura por autor/perfil podiam manter acesso à despesa, auditoria ou comprovante após promoção a administrador sem MFA.

## Correção

- Sete APIs conservam nome, argumentos e formato de resposta, mas passam a wrappers SECURITY INVOKER. Implementações privilegiadas ficam em expense_creation_private, com search_path vazio e grants explícitos.
- A autorização exige usuário da sessão igual ao ator, membership atual ativa e papel apropriado. Owner/admin exigem claim de nível superior aal2; claim ausente equivale a AAL1. user_metadata e app_metadata não substituem a garantia de autenticação.
- A criação revalida após obter o lock da membership e antes de devolver uma confirmação antiga. Promoção/revogação enquanto o pedido espera não preserva a autorização anterior.
- Recálculo revalida após o lock. As regras existentes de origem, valores, revisão, comprovante, transação e idempotência permanecem.
- Políticas restritivas adicionais cobrem leitura direta de despesas, auditoria da criação e arquivos no diretório reservado. Não apagam nem reatribuem histórico.
- O gateway secure-upload passa a consultar a autorização do comprovante com o JWT do usuário, não com service_role. A inspeção exige ator igual a auth.uid(); service_role deixa de ter EXECUTE. A verificação é repetida após o scanner e na confirmação.
- O formulário explica a necessidade de MFA, preserva campos e bloqueia envio/contexto visível após falha de revalidação. Confirmação incerta permanece recuperável com a mesma chave após recuperar MFA.

O gateway continua usando Storage API para gravar o arquivo. As escritas SQL em storage.objects vistas nos testes são exclusivamente fixtures descartáveis. Nenhum scanner, upload, emissão fiscal, pagamento ou integração externa foi chamado.

## Testes

34 casos novos: três reproduções, 16 SQL, seis de frontend real ligado ao SQL, quatro de gateway/contrato e cinco de contenção/retomada. Os grupos passaram isoladamente. Testes de aprovação e recálculo conferem os valores em centavos e zero pago.

**Gate final aprovado: 2.301 testes em 195 arquivos**, tipos, lint, qualidade, 41 sintaxes Edge, build e inspeção do artefato público. A sessão 72338 encerrou com código zero. Testes em 326,92 s com máximo de dois workers; build em 19,84 s, maior chunk 488,3 KiB e index 353,5 KiB. Sem source maps ou segredos reconhecidos no artefato público. A cobertura de 93,03% de linhas refere-se ao subconjunto instrumentado, não ao aplicativo inteiro.

O primeiro gate encontrou tipos ausentes em resultados SQL dos novos testes. Foram declarados tipos específicos, sem any ou alteração das expectativas. Na execução seguinte, houve dois timeouts de 5 s em cenários que inicializam outro banco: preflight de planejamento e recusa de instalação durante contenção. Os 49 testes desses dois arquivos passaram isoladamente (6,35 s, mesmo código/timeouts). A repetição final usou menos workers, sem retirar casos, aumentar timeouts ou alterar a configuração versionada.

**281 cenários PostgreSQL 17.11 aprovados**: sete adicionais anexados aos 274 anteriores, sem remover casos. Cobrem concorrência idêntica, promoção durante espera, promoção antes de replay, lock de papel durante recálculo, contenção concorrente, wrappers e falha tardia. A sessão 24728 encerrou com código zero, confirmou o hash abaixo e parou o cluster descartável.

Snapshots acompanham dez tabelas operacionais/financeiras. Para comparar registros preexistentes, excluem apenas as novas entidades sintéticas ligadas ao motorista/acerto desta suíte. Não são snapshots nem cópias de produção.

## Publicação, contenção e limites

Migração: 20260830231003_enforce_expense_creation_mfa.sql.
SHA-256: a7a3ac1bb45a09d79d864fd667f58104b758cebe9277690bbbc14f8673417dc7.

Contenção/retomada: EXPENSE-MFA-CONTAIN-2026-08-30.sql (SHA-256 73c1f4a4ff7c93fc18e47e700dd7e4e25b2b04ccd6be0fd469d6383a529fb2be) e EXPENSE-MFA-RESUME-2026-08-30.sql (d4145aef60204cc0677b02926423b4cf612d381bf0fc82163e68fa5419274376). Conferem corpos, papéis, grants, triggers, constraints e fronteiras MFA antes de alterar permissões. Revogam/restauram tanto wrappers quanto implementações privadas de escrita/inspeção; nenhuma retomada restaura service_role.

As migrações e roteiros anteriores foram preservados. Os roteiros EXPENSE-CREATION antigos recusam a versão nova por divergência de contrato; não devem ser usados para restaurar acesso pré-MFA. Instalação da migração também recusa uma versão anterior já contida, impedindo retomada implícita.

Hashes anteriores reconferidos: criação de despesas bdcf404396ed97340051f8c30a9d6ab21fde917b247066efb2ab8fd5818d91d7; chat direto 70ed39766a83b80c49c651fce9b592997735c1ab63feb754036f863f36775fa4; chat por ocorrência fb3c759e5112f2bf02fc66255cc40d14adcdf9cb02135fcc5fc9b6f7d2777bda.

Publicação exige coordenar banco, gateway e frontend, drenando uploads em andamento. O gateway antigo perderia acesso à inspeção após a migração; publicar só um lado causaria falhas de upload. Não restaurar uma versão sem MFA como rollback. Retomar apenas a versão protegida após verificar os contratos.

Ainda faltam: verificar configuração real dos schemas expostos e permissões, Auth/PostgREST/Storage reais, scanner disponível sem gasto adicional, E2E autenticado, reconciliação/retenção de arquivos e a revisão individual das demais APIs financeiras. Não se infere que todas as funções privilegiadas foram corrigidas.

Advisors locais não conectaram a 127.0.0.1:54322. Isso não é aprovação de segurança. A limitação anterior do navegador permanece sem E2E hospedado comprovado. Nenhuma nova configuração de produção foi alterada nesta etapa. SSX permanece inativo.

As skills Supabase/Postgres orientaram isolamento das funções, grants e locks; React orientou preservação da fila versionada e bloqueio derivado do estado atual da consulta. Referências: [MFA e JWT no Supabase](https://supabase.com/docs/guides/auth/auth-mfa), [RLS e MFA](https://supabase.com/docs/guides/database/postgres/row-level-security), [locks PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS).
