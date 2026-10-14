# Native homologation successor — 2026-10-14

Isolated cumulative successor of b9ad8dab, preserving stop fix f6406116 and offline fix a362f8d8 as merge parents. Local-first UI mutations now run offline before reconnect; helper EXECUTE is limited to authenticated and preserves invoker/RLS.

CI historical seed now loads after approved empty baseline and before all 41 exact forwards. Original 40 bytes remain pinned; new forward 20261014062118 SHA256 220233cb4d54a3685290bc6eb2a81c4ddaef34b75ebc52c5337b6727923dd902 is one atomic file. Both original address self-transactions remain unchanged. Historical lifecycle test pins its exact unique entry rather than assuming it remains last.

Associated QA: stop 9/9; offline 21 unit + 3 Chromium/IndexedDB, lint and app TypeScript PASS on their respective frozen tasks. Combined gates, real Native 3-flow replay and separate CI baseline/seed/forward execution are pending. No main/integration/publication or production action.

Catalog fingerprint must record the authorized helper proacl delta without rewriting original baseline approval. Query helper/trigger metadata explicitly because the security-boundary inventory only selects definer functions.
