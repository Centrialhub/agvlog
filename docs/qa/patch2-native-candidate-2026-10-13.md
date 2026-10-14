# Candidato combinado para homologação Native — 2026-10-13

Base preservada: `3e1cdd30900da5a1d3c9922cc5ff67d3e3dfc6e6`. Inputs congelados e revisados: motorista `8aa7821e326ea9db2c13658ef3f7144482b11317` e SSX Deno `a35432988adcb7280d6142458d1ed2eb5b5c6675`.

A composição em `task/patch2-native-candidate-20261013` preserva ambos os históricos e inclui o diagnóstico anterior do motorista. Os merges foram feitos pelo mecanismo external do coordenador, sem conflito, sem integração em `integration/local`, sem promoção da principal e sem publicação.

O deadline do motorista limita a espera local e descarta resultados tardios. Ele não desfaz uma transação já commitada no servidor. Homologação precisa cobrir refresh, duas sessões, escopo assinado e ordering servidor.

As correções Deno preservam opções reais de cliente e estreitam tipos/backoff/contrato de descoberta. Não substituem homologação do motorista ou de SSX, e nenhuma chamada real de SSX pertence a esta preparação.

Os gates afetados serão executados sobre o commit que contém esta nota, com env sintético, arquivos privados negados e rede real bloqueada. O resultado exato, SHA/tree, comandos, logs e limites serão registrados no handoff local selado; esta nota não afirma gates ainda não executados.

Baseline completo, os 40 forwards, aplicação/Auth/Storage/Realtime, testes Native, CI hospedado, aceite funcional e publicação continuam separados. `applicationReady=false`; nenhuma migração, operação de banco ou publicação foi executada nesta composição.
