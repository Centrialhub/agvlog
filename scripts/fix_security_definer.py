import os
import re
from pathlib import Path

def fix_sql_file(file_path):
    content = Path(file_path).read_text()
    # Padrão para encontrar CREATE FUNCTION ... SECURITY DEFINER sem SET search_path
    # Procuramos o bloco da função que termina em AS $$ ... $$ LANGUAGE ...
    # Mas é mais seguro injetar antes do AS $$ se houver SECURITY DEFINER
    
    pattern = re.compile(r"(CREATE OR REPLACE FUNCTION .*?RETURNS.*?SECURITY DEFINER)(?!.*?SET search_path)", re.DOTALL | re.IGNORECASE)
    
    def replacement(match):
        header = match.group(1)
        if "SET search_path" in header:
            return header
        return header + "\n  SET search_path = public"

    new_content = pattern.sub(replacement, content)
    if new_content != content:
        print(f"Corrigindo {file_path.name}...")
        Path(file_path).write_text(new_content)
        return True
    return False

if __name__ == "__main__":
    migration_dir = Path("supabase/migrations")
    count = 0
    for sql_file in migration_dir.glob("*.sql"):
        if fix_sql_file(sql_file):
            count += 1
    print(f"Total de arquivos corrigidos: {count}")
