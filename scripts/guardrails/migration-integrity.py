import hashlib
import sys
import os
import subprocess
from pathlib import Path

MANIFEST_PATH = 'supabase/migrations/MANIFEST.sha256'
MIGRATIONS_DIR = 'supabase/migrations'

def get_actual_hashes():
    hashes = {}
    if not os.path.exists(MIGRATIONS_DIR):
        return hashes
    for filename in sorted(os.listdir(MIGRATIONS_DIR)):
        if filename.endswith('.sql'):
            path = os.path.join(MIGRATIONS_DIR, filename)
            with open(path, 'rb') as f:
                hashes[filename] = hashlib.sha256(f.read()).hexdigest()
    return hashes

def read_manifest():
    hashes = {}
    if not os.path.exists(MANIFEST_PATH):
        return None
    with open(MANIFEST_PATH, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 2:
                h, p = parts
                fname = os.path.basename(p)
                hashes[fname] = h
    return hashes

def check():
    print("Verificando integridade das migrations...")
    manifest = read_manifest()
    if manifest is None:
        print("Aviso: MANIFEST.sha256 não encontrado. Gerando novo manifesto...")
        actual = get_actual_hashes()
        with open(MANIFEST_PATH, 'w') as f:
            for fname in sorted(actual.keys()):
                f.write(f"{actual[fname]}  {fname}\n")
        print("Manifesto gerado com sucesso.")
        return
        
    actual = get_actual_hashes()
    
    failed = False
    # Check for modified or missing migrations
    for fname, expected_hash in manifest.items():
        if fname not in actual:
            print(f"ERRO: Migration {fname} ausente no disco.")
            failed = True
        elif actual[fname] != expected_hash:
            print(f"ERRO: Migration {fname} foi modificada (SHA mismatch).")
            failed = True
            
    # Check for new migrations not in manifest
    for fname in actual:
        if fname not in manifest:
            print(f"ERRO: Nova migration {fname} detectada mas não está no manifesto.")
            failed = True
            
    if failed:
        sys.exit(1)
    print("Integridade das migrations OK.")

if __name__ == "__main__":
    check()
