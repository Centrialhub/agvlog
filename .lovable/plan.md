---
title: Cost Center Management & Reporting
description: Centralize cost center registration, category management, and detailed financial reporting.
---

## Summary
Implement a centralized management system for cost centers and expense categories, including the ability to register new centers, edit existing ones, and extract detailed reports (PDF/Excel) for financial analysis.

## Technical Details

### Database Schema
- **Table**: `public.cost_centers`
  - `id`: uuid (primary key)
  - `tenant_id`: uuid (referenced to tenants)
  - `name`: text (not null)
  - `active`: boolean (default true)
  - `created_at`: timestamptz (default now())
  - `updated_at`: timestamptz (default now())
- **Security**: RLS enabled, granted to `authenticated` and `service_role`.

### Frontend Components
- **CostCenterManager**: New component for CRUD operations on cost centers.
- **CostCenterReportGenerator**: Logic to generate PDF/Excel reports based on selected cost centers and periods.
- **CostCenters Page**: Update `src/pages/CostCenters.tsx` to include the management UI and reporting actions.

### Data Flow
1. Users register cost centers in the management UI.
2. Financial transactions (payables, bank transactions, expenses) link to these centers via the `cost_center` column (transition from text to FK reference or keep as text but validated against the catalog).
3. The dashboard and reports fetch data from all linked entities to provide a consolidated view.

## User Experience
- Dedicated tab or section in the Cost Centers page for management.
- Simple, intuitive form for adding/editing categories.
- One-click report generation with date range and category filters.
