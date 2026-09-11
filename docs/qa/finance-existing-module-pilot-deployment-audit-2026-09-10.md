# Disponibilização do financeiro existente: auditoria de piloto

## Escopo e estado

Auditoria somente leitura de configuração de entrega e evidências existentes. Nenhuma migration remota aplicada, CI disparada ou servidor PostgreSQL iniciado nesta etapa.

O ramo de ajustes de descarga foi interrompido: `20260910214053_finance_unloading_adjustment_flow.sql` era um arquivo vazio, nunca aplicado, e foi removido. Não foi implementado leitor econômico v2 nesta frente. O autor da fundação confirmou que também removeu a migration vazia214012; o resolver e a tabela de versões são apenas proposta, não dependências disponíveis. Nenhum processo de teste desta frente permanece ativo.

## Executor configurado versus execução comprovada

- Repositório: `Centrialhub/agvlog`. Main remoto e HEAD local consultados: `b9af33dfc37b32ef3654feba62ff6041a4507151`.
- `.github/workflows/quality.yml` existe no main remoto (blob `be3c3cf2616ddd518b11e4655c278944f83e456b`). Tem executores Ubuntu, instalação do Supabase local, reset local, seed, autenticação real, lint SQL, contrato de baseline, pgTAP e Playwright; para ao final e publica artefatos. Dispara em push main e pull request.
- Esse workflow prova, quando efetivamente passar no candidato, uma instalação nova com a plataforma local. Não ensaia upgrade sobre o histórico remoto406.
- A consulta de execuções disponível retornou lista vazia para esse commit, mas é limitada a execuções de pull request e à primeira página. Não permite afirmar ausência de todas as execuções de Actions nem indisponibilidade do executor.
- O status combinado observado foi sucesso do Vercel. Não comprova aplicação ou compatibilidade do banco financeiro.
- `.github/workflows/release-candidate.yml` local tem execução manual contra URL candidata, ambiente `release-candidate`, smoke e jornadas hospedadas. Depende dos nomes de configuração `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY` e `STAGING_E2E_PASSWORD`. Valores e disponibilidade dos segredos não foram consultados. Esse workflow não aplica migrations.
- Nenhum push, commit ou dispatch foi feito nesta auditoria.

## Bloqueios concretos

O mapa de upgrade existente registra406 versões remotas e divergência entre o histórico remoto e os arquivos locais. A baseline consolidada local não equivale à migration remota com o mesmo número. Versões ausentes localmente não significam necessariamente funcionalidade ausente remotamente: há aliases por nome, versões diferentes e corpos diferentes. Portanto, `db reset` ou a reaplicação da baseline sobre esse remoto não constituem caminho de upgrade.

O coordenador verificou novamente a ausência de oito RPCs financeiras essenciais no remoto. Logo, a aplicação atual não pode depender apenas de publicar o frontend para tornar o novo módulo utilizável.

O diagnóstico local recente está em `finance-full-sequence-prerequisites-current-2026-09-10.md/json`: Supabase CLI2.116.0 disponível; Docker/Podman ausentes, WSL não instalado, e runtime PostgreSQL17.11 sem PostGIS, pg_net, pg_cron e vault. Auth e Storage também não surgem ao criar um banco vazio. O runner de cadeia integral cria um banco novo e não é bootstrap da plataforma Supabase. As factories financeiras não substituem essa prova.

O manifesto inicial de259 arquivos e o mapa de261 arquivos são fotografias históricas. Não representam automaticamente o conjunto candidato atual. A auditoria posterior de pré-requisitos capturou333 arquivos; qualquer release precisa congelar e recalcular seu próprio manifesto.

## Menor sequência funcional segura

Não há evidência suficiente para declarar uma lista mínima de arquivos pronta para produção. O menor recorte funcional deve incluir os contratos efetivamente chamados pelo módulo existente, os escritores e leitores financeiros correspondentes, suas travas, auditoria, acesso e dependências operacionais. Escolher somente arquivos com prefixo financeiro excluiria dependências reais de entregas, tentativas, fechamento operacional, recebíveis e identidade.

O próximo caminho concreto é:

1. Congelar um candidato com o financeiro existente e seu manifesto ordenado, deixando propostas de descarga v2 fora dele. Publicar/abrir PR somente quando autorizado; usar o workflow `quality.yml` já existente para a instalação nova completa e guardar os artefatos do SHA exato.
2. Obter uma base de ensaio representativa do catálogo e histórico remoto, sem dados pessoais de produção. Resolver aliases e diferenças por objeto antes de derivar migrations exclusivamente de avanço. Não executar a baseline consolidada sobre406 versões.
3. Executar esse avanço em ambiente descartável Supabase, preservando história e sem stubs de Auth/Storage/extensões. Validar os contratos de RPC, isolamento, escritores, fechamento e as jornadas do piloto. Isso exige um ambiente com plataforma real; o runner PostgreSQL reduzido disponível não basta.
4. Provisionar o banco de staging somente após esse ensaio; publicar o mesmo SHA e então usar `release-candidate.yml` para smoke/jornadas. O workflow hospedado valida a aplicação já provisionada, não provisiona o banco.

Até concluir2 e3, não é correto apresentar uma ordem de aplicação como aprovada. A prova de instalação nova e a prova de upgrade são duas evidências distintas. O piloto pode permanecer limitado a poucos operadores e contas, mas não pode dispensar as dependências dos comandos que estarão disponíveis.

## Limitações da etapa

Não houve consulta de segredos, dados pessoais ou mutação remota. Não foi comprovada a disponibilidade operacional/billing dos executores GitHub nem o conteúdo de configurações de staging. Ao retomar a consolidação, duas tentativas de leitura pelo shell falharam antes de criar processo (`helper_unknown_error: setup refresh had errors`); isso não é falha de SQL e não motivou novo preflight ou início de PostgreSQL. As evidências acima são das leituras concluídas nesta frente e dos relatórios locais indicados, com a verificação remota final explicitamente atribuída ao coordenador.
