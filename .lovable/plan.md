# Plan: Database Redundancy Audit & Integrity Fixes

The system now implements a robust two-tier auditing strategy to identify and resolve logical and fiscal redundancies within the multi-tenant database.

## Technical Details

- **Logical Audit (`audit_data_consistency_v2`):** A comprehensive PostgreSQL RPC that scans for structural anomalies in HR and Finance. It identifies employees with overlapping contracts, driver settlements missing operational links, and approved payroll periods without matching financial obligations (payables).
- **Fiscal Audit (`monitor_simples_nacional_icms_violations`):** A specialized monitor that detects Simples Nacional emittters with incorrect ICMS highlight. This ensures tax compliance and prevents redundant tax highlights.
- **Audit Interface:** A centralized dashboard under **Configurações > Auditoria de Dados** and **Documentos Fiscais > Auditoria ICMS** allows operators to re-run consistency checks and act on findings.

## User Interface

- Accessible via the main navigation menu.
- Real-time "Reexecutar" action to refresh the audit results.
- Severity-based grouping (Critical, Warning, Info).
- Direct "Corrigir" paths for irregular documents.
