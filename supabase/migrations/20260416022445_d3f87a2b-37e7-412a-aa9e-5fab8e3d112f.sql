-- Limpar dados operacionais na ordem correta (respeitando dependências)
DELETE FROM dispatch_events;
DELETE FROM dispatch_stops;
DELETE FROM dispatch_trips;
DELETE FROM load_documents;
DELETE FROM load_items;
DELETE FROM load_orders;
DELETE FROM loads;
DELETE FROM freight_calculation_log;
DELETE FROM fiscal_documents;
DELETE FROM orders;
DELETE FROM incidents;
DELETE FROM checklist_executions;
DELETE FROM driver_expenses;
DELETE FROM inventory_movements;
DELETE FROM inventory_balances;
DELETE FROM alert_instances;
DELETE FROM maintenance_orders;
