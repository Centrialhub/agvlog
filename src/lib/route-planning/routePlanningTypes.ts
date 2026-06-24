export type RouteStopRiskLevel = 'normal' | 'warning' | 'critical';
export type RouteStopSortMode = 'original' | 'manual' | 'smart' | 'auto';
export type RoutePlanStatus = 'ready' | 'review' | 'blocked';

export interface RouteStopDraft {
  id: string;
  client_id?: string | null;
  recipient_name: string;
  destination: string;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;

  load_ids: string[];
  fiscal_document_ids: string[];
  invoice_numbers: string[];

  total_weight_kg: number;
  total_volume_m3: number;
  total_pallet_count: number;
  total_value: number;

  latitude?: number | null;
  longitude?: number | null;

  original_order?: number | null;
  optimized_order?: number | null;
  manual_order?: number | null;

  planned_arrival_at?: string | null;
  estimated_departure_at?: string | null;
  service_time_minutes: number;

  delivery_window_start?: string | null;
  delivery_window_end?: string | null;

  priority: number;
  risk_level: RouteStopRiskLevel;
  risk_reason?: string | null;
  notes?: string | null;
}

export interface RoutePlanValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface CustomerWindow {
  client_id: string;
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
}
