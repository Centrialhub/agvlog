import subprocess
import os
import sys
import re

def run_command(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
    return result

def get_defined_functions(content):
    """Extrai nomes de funções e assinaturas de um conteúdo SQL."""
    # Regex simplificada para capturar CREATE OR REPLACE FUNCTION public.name(args)
    pattern = r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\((.*?)\)'
    matches = re.finditer(pattern, content, re.IGNORECASE | re.DOTALL)
    defs = []
    for m in matches:
        name = m.group(1).lower()
        args = m.group(2).strip().lower()
        # Normalização básica de espaços em argumentos
        args = re.sub(r'\s+', ' ', args)
        defs.append((name, args))
    return defs

def check_forward_references():
    print("Verificando referências antecipadas em GRANT/REVOKE/ALTER FUNCTION...")
    migration_dir = "supabase/migrations"
    migrations = sorted([f for f in os.listdir(migration_dir) if f.endswith(".sql")])
    
    defined_so_far = set()
    
    for m in migrations:
        path = os.path.join(migration_dir, m)
        with open(path, 'r') as f:
            lines = f.readlines()
            content = "".join(lines)
            
            # 1. Registrar o que esta migration define
            for name, args in get_defined_functions(content):
                defined_so_far.add((name, args))
            
            # 2. Verificar o que esta migration tenta referenciar via GRANT/REVOKE/ALTER
            # Regex para GRANT/REVOKE/ALTER FUNCTION public.name(args)
            ref_pattern = r'(GRANT|REVOKE|ALTER)\s+.*?FUNCTION\s+public\.(\w+)\s*\((.*?)\)'
            for i, line in enumerate(lines):
                matches = re.finditer(ref_pattern, line, re.IGNORECASE)
                for m_ref in matches:
                    name = m_ref.group(2).lower()
                    args = m_ref.group(3).strip().lower()
                    args = re.sub(r'\s+', ' ', args)
                    
                    if (name, args) not in defined_so_far:
                        # Exceção comum: funções nativas ou de extensões (se necessário)
                        # Por agora, falhamos se for public.*
                        print(f"ERRO: {m}:{i+1} Referência antecipada detectada.")
                        print(f"Assinatura: public.{name}({args}) referenciada antes de ser definida.")
                        return False
    return True

def check():
    print("Iniciando prova executável de schema...")
    
    # Validação do ambiente Supabase
    print("Validando presença do Supabase CLI e Docker...")
    res_cli = run_command("supabase --version")
    if res_cli.returncode != 0:
        print("ERRO: Supabase CLI não encontrado. O gate exige ambiente executável.")
        sys.exit(1)
        
    res_docker = run_command("docker info")
    if res_docker.returncode != 0:
        print("ERRO: Docker não disponível. Reset real impossível.")
        sys.exit(1)

    # Execução do Reset Real
    print("Executando supabase db reset...")
    res_reset = run_command("supabase db reset")
    if res_reset.returncode != 0:
        print("ERRO: Falha ao aplicar migrations no banco local.")
        sys.exit(1)

    # Verificação Estática de Ordem Cronológica
    if not check_forward_references():
        sys.exit(1)

    print("Schema-check: Histórico completo e integridade de referências validados.")

if __name__ == "__main__":
    check()
