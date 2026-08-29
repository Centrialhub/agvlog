// Browser-safe projections for relations that contain backend-only credentials.
// Keep these lists aligned with the column-level grants in the database baseline.

export const VEHICLE_SAFE_SELECT = 'id, tenant_id, plate, nickname, type, active, tags, created_at, updated_at, created_by, updated_by, tank_capacity_liters, speed_limit_kmh, fuel_canonical_key, max_pallets, max_weight_kg, max_volume_m3, body_type, base_consumption_estimate, loaded_consumption_factor, expected_speed_penalty_loaded, current_driver_id, blocked, in_maintenance, odometer_km, model, year_of_manufacture, brand, capacity_ton, chassis, color, renavam, result_center, result_area, business_unit, vehicle_type_code, body_type_code, category, fleet_type_code, axle_structure, situation_code, avg_km_per_liter, city, uf, owner_name, owner_neighborhood, owner_mobile, owner_phone, owner_notes, tracker_name, tracker_login, plate_raw' as const;

export const INTEGRATION_ACCOUNT_SAFE_SELECT = 'id, tenant_id, provider, base_url, username, status, settings, last_login_at, last_error, created_at, updated_at, token_expires_at' as const;

export const NFSE_PROVIDER_CONFIG_SAFE_SELECT = 'id, tenant_id, branch_code, provider, environment, city_code, cnpj, inscricao_municipal, regime_tributario, rps_serie, webhook_url, extra_settings, enabled, created_at, updated_at' as const;

export const HUB_FISCAL_CREDENTIAL_SAFE_SELECT = 'id, tenant_id, emitter_id, doc_scope, environment, secret_name, secret_hint, enabled, metadata, created_at, updated_at' as const;
