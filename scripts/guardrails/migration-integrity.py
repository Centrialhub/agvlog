#!/usr/bin/env python3
"""Gate de integridade das migrations.

Fonte canônica: supabase/migrations/MANIFEST.sha256 (nomes de arquivo).
Espelho: MANIFEST.sha256 na raiz (caminhos com prefixo supabase/migrations/).

Falha (exit 1) quando:
  - um dos manifestos está ausente;
  - alguma linha é inválida ou o hash não é SHA-256 hex de 64 chars;
  - há entrada duplicada;
  - a ordem das entradas não é cronológica (ordenação lexicográfica pelo nome);
  - existe migration no disco ausente do manifesto, ou entrada extra sem arquivo;
  - algum hash divergente do conteúdo real;
  - os dois manifestos não descrevem exatamente o mesmo conjunto/hashes.

Não gera manifestos automaticamente e não possui fallback de sucesso.
"""

import hashlib
import os
import re
import sys

MIGRATIONS_DIR = "supabase/migrations"
CANONICAL_MANIFEST = os.path.join(MIGRATIONS_DIR, "MANIFEST.sha256")
ROOT_MANIFEST = "MANIFEST.sha256"
ROOT_PREFIX = MIGRATIONS_DIR + "/"

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

errors = []


def fail(msg):
    errors.append(msg)


def parse_manifest(path, expect_prefix):
    """Retorna lista ordenada de (filename, hash) ou None se inválido/ausente."""
    if not os.path.isfile(path):
        fail(f"Manifesto ausente: {path}")
        return None

    entries = []
    seen = set()
    with open(path, "r", encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.rstrip("\n")
            if not line.strip():
                fail(f"{path}:{lineno}: linha vazia não permitida.")
                continue
            parts = line.split()
            if len(parts) != 2:
                fail(f"{path}:{lineno}: linha inválida ({line!r}).")
                continue
            digest, entry_path = parts
            if not SHA256_RE.match(digest):
                fail(f"{path}:{lineno}: hash não é SHA-256 hexadecimal ({digest!r}).")
                continue
            if expect_prefix:
                if not entry_path.startswith(ROOT_PREFIX):
                    fail(f"{path}:{lineno}: caminho deve começar com {ROOT_PREFIX} ({entry_path!r}).")
                    continue
                filename = entry_path[len(ROOT_PREFIX):]
            else:
                if "/" in entry_path:
                    fail(f"{path}:{lineno}: esperado apenas o nome do arquivo ({entry_path!r}).")
                    continue
                filename = entry_path
            if not filename.endswith(".sql"):
                fail(f"{path}:{lineno}: entrada não é migration .sql ({filename!r}).")
                continue
            if filename in seen:
                fail(f"{path}:{lineno}: entrada duplicada ({filename}).")
                continue
            seen.add(filename)
            entries.append((filename, digest))

    names = [name for name, _ in entries]
    if names != sorted(names):
        fail(f"{path}: entradas fora de ordem cronológica.")
    return entries


def disk_hashes():
    if not os.path.isdir(MIGRATIONS_DIR):
        fail(f"Diretório de migrations ausente: {MIGRATIONS_DIR}")
        return {}
    result = {}
    for filename in sorted(os.listdir(MIGRATIONS_DIR)):
        if not filename.endswith(".sql"):
            continue
        with open(os.path.join(MIGRATIONS_DIR, filename), "rb") as fh:
            result[filename] = hashlib.sha256(fh.read()).hexdigest()
    return result


def main():
    print("Verificando integridade das migrations...")

    canonical = parse_manifest(CANONICAL_MANIFEST, expect_prefix=False)
    root = parse_manifest(ROOT_MANIFEST, expect_prefix=True)
    actual = disk_hashes()

    if canonical is not None:
        canonical_map = dict(canonical)
        for filename, expected in canonical_map.items():
            if filename not in actual:
                fail(f"Migration listada no manifesto canônico não existe no disco: {filename}")
            elif actual[filename] != expected:
                fail(f"Hash divergente para {filename} (manifesto canônico).")
        for filename in actual:
            if filename not in canonical_map:
                fail(f"Migration presente no disco e ausente do manifesto canônico: {filename}")

        if root is not None:
            root_map = dict(root)
            for filename, digest in canonical_map.items():
                if filename not in root_map:
                    fail(f"Migration ausente em {ROOT_MANIFEST}: {filename}")
                elif root_map[filename] != digest:
                    fail(f"Hash divergente entre manifestos para {filename}.")
            for filename in root_map:
                if filename not in canonical_map:
                    fail(f"Entrada extra em {ROOT_MANIFEST}: {filename}")

    if errors:
        for msg in errors:
            print(f"ERRO: {msg}")
        print(f"Integridade das migrations FALHOU ({len(errors)} problema(s)).")
        sys.exit(1)

    if not actual:
        print("ERRO: nenhuma migration encontrada.")
        sys.exit(1)

    print(f"Integridade das migrations OK ({len(actual)} migrations).")


if __name__ == "__main__":
    main()
