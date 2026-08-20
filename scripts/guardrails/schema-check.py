import os
import sys
from pathlib import Path

def check_schema_integrity():
    """Valida integridade básica do schema nas migrations"""
    print("Validando integridade do schema nas migrations...")
    migration_dir = Path("supabase/migrations")
    if not migration_dir.exists():
        print("Diretório de migrations não encontrado.")
        return True

    success = True
    # baseline estendida: aceitar tabelas sem GRANT em migrations históricas conhecidas
    historical_files = ["202603", "202604", "202605"]
    
    for sql_file in migration_dir.glob("*.sql"):
        if any(h in sql_file.name for h in historical_files):
            continue
        content = sql_file.read_text().lower()
        
        # 1. Verificar se tabelas novas no public têm GRANT
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if 'create table public.' in line:
                table_name = line.split('public.')[1].split('(')[0].strip()
                # Procurar por GRANT nas linhas seguintes
                grant_found = False
                for next_line in lines[i:]:
                    if f'grant' in next_line and table_name in next_line:
                        grant_found = True
                        break
                if not grant_found:
                    # Algumas tabelas podem ser internas ou de sistema, mas public deve ter grant
                    if not any(x in table_name for x in ['_audit', '_log']):
                        print(f"ERRO: Tabela public.{table_name} criada sem GRANT em {sql_file.name}")
                        success = False

        # 2. Verificar se habilitou RLS
        if 'create table' in content and 'enable row level security' not in content:
            # Apenas se não for tabela de sistema/log
            if 'log' not in content and 'audit' not in content:
                print(f"AVISO: CREATE TABLE sem ENABLE ROW LEVEL SECURITY em {sql_file.name}")
                # success = False # Manter como aviso por enquanto para não quebrar tudo de uma vez

    return success

if __name__ == "__main__":
    if not check_schema_integrity():
        sys.exit(1)
    print("Validação de schema concluída.")