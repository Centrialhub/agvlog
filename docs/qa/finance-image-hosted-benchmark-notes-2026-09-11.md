# Ensaio hospedado de imagens — 11/09/2026

Executado no projeto Supabase de produção com 14 arquivos sintéticos, sem documentos do cliente e sem criar artefatos, despesas ou movimentos. Resultados em finance-image-hosted-benchmark-2026-09-11.json.

Cinco imagens produziram derivado: PNG/JPEG de 1 pixel, PNG/JPEG 640×480 e JPEG 1600×1200. PNG 1600×1200 e ambas 2000×1000 foram recusadas por recursos/codec; não aumentar limites para aceitar esses casos sem novo ensaio. Ambas 2000×1200 excederam o limite de pixels. Animação, conteúdo após fim, CRC corrompido e JPEG inválido foram recusados. Resultado positivo de benchmark permanece usable:false e não é atestado antivírus.

O carregador verificou o hash fixo do WASM privado. Limites: original e derivado até 5MiB, até 2 milhões de pixels, máximo4096 por lado, orçamento de processamento1200ms, memória do codec64MiB e disco desativado. O limite de pixels não garante que toda imagem abaixo dele caberá nos recursos; falhas devem preservar quarentena.

A primeira configuração de autenticação exigia igualdade com a chave de serviço do runtime; a chave obtida pela CLI foi recusada, mesmo revelada. Esses testes401 não executaram o codec. O ensaio válido usou token aleatório dedicado de32bytes, definido apenas temporariamente e mantido na memória do processo. Anônimo continuou401. Token removido no finally; função temporária finance-image-runtime-benchmark excluída com sucesso pela CLI. Nenhum endpoint de benchmark/provisionamento foi inserido no upload de produção.

Esses resultados habilitam a revisão da integração do derivado, não provam por si sós anexação de comprovante ou fluxo financeiro completo.
