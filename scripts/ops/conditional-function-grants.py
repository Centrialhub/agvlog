#!/usr/bin/env python3
"""Transforma GRANT/REVOKE EXECUTE ON FUNCTION em concessões condicionais.

Migrations históricas concedem privilégios em funções criadas em migrations
posteriores (grants antecipados). Em um banco já existente elas passam; desde
schema vazio falham. Este utilitário reescreve cada instrução para só executar
quando a assinatura existir (to_regprocedure), preservando o efeito real.
"""
import re, sys

STMT = re.compile(
    r'^(?P<indent>\s*)(?P<verb>GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+(?P<sig>[^;]+?)\s+(?P<dir>TO|FROM)\s+(?P<role>[A-Za-z_"]+)\s*;\s*$',
    re.IGNORECASE)

def convert(text: str) -> tuple[str, int]:
    out, n = [], 0
    for line in text.split('\n'):
        m = STMT.match(line)
        if not m:
            out.append(line)
            continue
        n += 1
        sig = ' '.join(m.group('sig').split())
        verb, direction, role = m.group('verb').upper(), m.group('dir').upper(), m.group('role')
        out.append(
            f"DO $cond$ BEGIN\n"
            f"  IF to_regprocedure('{sig}') IS NOT NULL THEN\n"
            f"    EXECUTE '{verb} EXECUTE ON FUNCTION {sig} {direction} {role}';\n"
            f"  END IF;\n"
            f"END $cond$;"
        )
    return '\n'.join(out), n

if __name__ == '__main__':
    for path in sys.argv[1:]:
        src = open(path).read()
        new, n = convert(src)
        if n:
            open(path, 'w').write(new)
        print(f"{path}: {n} instruções condicionadas")
