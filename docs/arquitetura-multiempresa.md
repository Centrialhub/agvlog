# Arquitetura multiempresa

## Limites de dados

`workspace` representa o grupo operacional. `tenant` representa uma empresa legal, fiscal e contábil. Uma empresa pertence a exatamente um workspace; um workspace pode conter várias empresas.

| Domínio | Limite obrigatório | Regra |
| --- | --- | --- |
| Clientes, fornecedores e contatos | Workspace | Cadastro canônico compartilhado, com dados fiscais específicos por tenant quando necessário |
| Funcionários e motoristas | Workspace | Identidade compartilhada; vínculo, permissão e custo podem ser específicos por tenant |
| Caminhões, implementos e dispositivos | Workspace | Frota física única para todas as empresas do grupo |
| SSX e telemetria | Workspace | Uma conta/inscrição e um fluxo de posições; nenhum dispositivo duplicado por empresa |
| Viagem física | Workspace | Pode agrupar trechos/cargas de empresas diferentes |
| Pedidos, cargas e paradas | Tenant | Cada registro operacional conserva a empresa responsável |
| NF-e, CT-e, MDF-e, NFS-e e anexos | Tenant | Numeração, emitente, certificado, XML, PDF e eventos nunca atravessam empresa |
| Contas, títulos, pagamentos e conciliação | Tenant | Livro financeiro e permissões separados por empresa |

## Contexto de acesso

O frontend registra o tenant ativo, renova a sessão e envia `x-agvlog-tenant-id` em cada requisição de dados segregados. O Auth Hook assina `active_tenant_id` e `active_workspace_id` no JWT. O PostgreSQL exige que header e claim coincidam, que o tenant do registro seja o tenant ativo e que o usuário possua vínculo ativo com ele. Ausência, formato inválido ou divergência falha de forma fechada.

Consultas compartilhadas usam `workspace_id`, derivado de um vínculo válido. O seletor da sidebar troca a empresa fiscal ativa, não o workspace. A troca atualiza o contexto persistido, renova o JWT, cancela consultas em andamento e limpa os caches segregados antes de liberar a nova tela.

## App do motorista

O motorista trabalha sobre uma jornada física compartilhada. Cada carga, documento, comprovante, ocorrência financeira ou ação fiscal dentro da jornada mantém `tenant_id`. O backend retorna o tenant de origem de cada trecho/parada; antes de navegar ou iniciar a ação, o aplicativo ativa esse tenant e renova a sessão. O motorista não escolhe arbitrariamente a empresa. A posição exibida é a mais recente do caminhão físico no workspace, independentemente da projeção de empresa usada pelo fluxo único da SSX.

## Implantação

As mudanças são aditivas antes do corte. A sequência é: fundação de workspace e contexto; aplicação das políticas restritivas; cadastros compartilhados; frota/SSX; jornada física; fiscal/financeiro/storage; migração de dados; piloto; corte. Cada etapa possui verificação de banco e aplicação e pode ser interrompida antes da etapa destrutiva seguinte.
