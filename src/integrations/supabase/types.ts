export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alert_instances: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          last_event_id: string | null
          opened_at: string
          rule_id: string | null
          status: string
          tenant_id: string
          vehicle_id: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          last_event_id?: string | null
          opened_at?: string
          rule_id?: string | null
          status?: string
          tenant_id: string
          vehicle_id?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          last_event_id?: string | null
          opened_at?: string
          rule_id?: string | null
          status?: string
          tenant_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_instances_last_event_id_fkey"
            columns: ["last_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_instances_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_instances_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          params: Json
          requires_capabilities: Json | null
          requires_feature_key: string | null
          rule_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          params?: Json
          requires_capabilities?: Json | null
          requires_feature_key?: string | null
          rule_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          params?: Json
          requires_capabilities?: Json | null
          requires_feature_key?: string | null
          rule_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          doc: string | null
          id: string
          name: string
          phone: string | null
          provider_person_id: string | null
          provider_person_sync_status: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          doc?: string | null
          id?: string
          name: string
          phone?: string | null
          provider_person_id?: string | null
          provider_person_sync_status?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          doc?: string | null
          id?: string
          name?: string
          phone?: string | null
          provider_person_id?: string | null
          provider_person_sync_status?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          event_at: string
          event_type: string
          id: string
          payload: Json | null
          severity: string
          tenant_id: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          event_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          severity?: string
          tenant_id: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          event_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          severity?: string
          tenant_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          direction: string
          event_at: string
          geofence_id: string
          id: string
          payload: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          direction: string
          event_at?: string
          geofence_id: string
          id?: string
          payload?: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          direction?: string
          event_at?: string
          geofence_id?: string
          id?: string
          payload?: Json | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      geofences: {
        Row: {
          category: string | null
          created_at: string
          enabled: boolean
          geometry: unknown
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          enabled?: boolean
          geometry?: unknown
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          enabled?: boolean
          geometry?: unknown
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_cursors: {
        Row: {
          backoff_until: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          last_polled_at: string | null
          last_success_at: string | null
          provider_unit_id: string
          tenant_id: string
        }
        Insert: {
          backoff_until?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_polled_at?: string | null
          last_success_at?: string | null
          provider_unit_id: string
          tenant_id: string
        }
        Update: {
          backoff_until?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_polled_at?: string | null
          last_success_at?: string | null
          provider_unit_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_cursors_provider_unit_id_fkey"
            columns: ["provider_unit_id"]
            isOneToOne: false
            referencedRelation: "provider_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_cursors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          base_url: string
          created_at: string
          hashauth: string | null
          hashcode: string | null
          id: string
          last_error: string | null
          last_login_at: string | null
          password_encrypted: string
          provider: string
          settings: Json
          status: string
          tenant_id: string
          token_cache: string | null
          token_expires_at: string | null
          updated_at: string
          username: string
        }
        Insert: {
          base_url?: string
          created_at?: string
          hashauth?: string | null
          hashcode?: string | null
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          password_encrypted: string
          provider?: string
          settings?: Json
          status?: string
          tenant_id: string
          token_cache?: string | null
          token_expires_at?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          base_url?: string
          created_at?: string
          hashauth?: string | null
          hashcode?: string | null
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          password_encrypted?: string
          provider?: string
          settings?: Json
          status?: string
          tenant_id?: string
          token_cache?: string | null
          token_expires_at?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          action: string
          created_at: string
          duration_ms: number | null
          endpoint: string | null
          error_message: string | null
          id: string
          integration_account_id: string | null
          metadata: Json | null
          status_code: number | null
          success: boolean
          tenant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          duration_ms?: number | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          integration_account_id?: string | null
          metadata?: Json | null
          status_code?: number | null
          success?: boolean
          tenant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          duration_ms?: number | null
          endpoint?: string | null
          error_message?: string | null
          id?: string
          integration_account_id?: string | null
          metadata?: Json | null
          status_code?: number | null
          success?: boolean
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_integration_account_id_fkey"
            columns: ["integration_account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_daily: {
        Row: {
          day: string
          km_estimated: number | null
          moving_time_seconds: number | null
          offline_minutes: number | null
          overspeed_events: number | null
          stopped_time_seconds: number | null
          stops_count: number | null
          tenant_id: string
          trips_count: number | null
          vehicle_id: string
        }
        Insert: {
          day: string
          km_estimated?: number | null
          moving_time_seconds?: number | null
          offline_minutes?: number | null
          overspeed_events?: number | null
          stopped_time_seconds?: number | null
          stops_count?: number | null
          tenant_id: string
          trips_count?: number | null
          vehicle_id: string
        }
        Update: {
          day?: string
          km_estimated?: number | null
          moving_time_seconds?: number | null
          offline_minutes?: number | null
          overspeed_events?: number | null
          stopped_time_seconds?: number | null
          stops_count?: number | null
          tenant_id?: string
          trips_count?: number | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metrics_daily_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_daily_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      pois: {
        Row: {
          category: string | null
          confidence_score: number | null
          created_at: string
          id: string
          lat: number
          lng: number
          metadata: Json | null
          name: string | null
          radius_m: number | null
          source: string
          tenant_id: string
        }
        Insert: {
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          lat: number
          lng: number
          metadata?: Json | null
          name?: string | null
          radius_m?: number | null
          source?: string
          tenant_id: string
        }
        Update: {
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          metadata?: Json | null
          name?: string | null
          radius_m?: number | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pois_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      positions_last: {
        Row: {
          captured_at: string
          heading: number | null
          lat: number
          lng: number
          received_at: string
          source: Json | null
          speed: number | null
          telemetry_snapshot: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          captured_at: string
          heading?: number | null
          lat: number
          lng: number
          received_at?: string
          source?: Json | null
          speed?: number | null
          telemetry_snapshot?: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          captured_at?: string
          heading?: number | null
          lat?: number
          lng?: number
          received_at?: string
          source?: Json | null
          speed?: number | null
          telemetry_snapshot?: Json | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_last_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_last_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      positions_raw: {
        Row: {
          captured_at: string
          heading: number | null
          id: string
          lat: number
          lng: number
          provider_payload_hash: string | null
          received_at: string
          speed: number | null
          telemetry: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          captured_at: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          provider_payload_hash?: string | null
          received_at?: string
          speed?: number | null
          telemetry?: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          captured_at?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          provider_payload_hash?: string | null
          received_at?: string
          speed?: number | null
          telemetry?: Json | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_raw_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_raw_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_units: {
        Row: {
          active: boolean
          created_at: string
          external_code: string
          external_id: string | null
          id: string
          integration_account_id: string
          label: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          external_code: string
          external_id?: string | null
          id?: string
          integration_account_id: string
          label?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          external_code?: string
          external_id?: string | null
          id?: string
          integration_account_id?: string
          label?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_units_integration_account_id_fkey"
            columns: ["integration_account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_units_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry_catalog: {
        Row: {
          created_at: string
          data_type: string | null
          description: string | null
          id: string
          name: string | null
          provider: string
          raw: Json | null
          telemetry_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_type?: string | null
          description?: string | null
          id?: string
          name?: string | null
          provider?: string
          raw?: Json | null
          telemetry_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_type?: string | null
          description?: string | null
          id?: string
          name?: string | null
          provider?: string
          raw?: Json | null
          telemetry_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      telemetry_mapping: {
        Row: {
          canonical_key: string
          created_at: string
          id: string
          provider: string
          telemetry_id: string
          tenant_id: string
          transform: Json | null
        }
        Insert: {
          canonical_key: string
          created_at?: string
          id?: string
          provider?: string
          telemetry_id: string
          tenant_id: string
          transform?: Json | null
        }
        Update: {
          canonical_key?: string
          created_at?: string
          id?: string
          provider?: string
          telemetry_id?: string
          tenant_id?: string
          transform?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_mapping_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry_observations: {
        Row: {
          canonical_key: string
          first_seen_at: string
          id: string
          last_seen_at: string
          last_value_type: string | null
          tenant_id: string
          times_seen: number
          vehicle_id: string
        }
        Insert: {
          canonical_key: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          last_value_type?: string | null
          tenant_id: string
          times_seen?: number
          vehicle_id: string
        }
        Update: {
          canonical_key?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          last_value_type?: string | null
          tenant_id?: string
          times_seen?: number
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_observations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telemetry_observations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_feature_policy: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_key: string
          id?: string
          notes?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_feature_policy_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          plan_key: string
          settings: Json | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan_key?: string
          settings?: Json | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan_key?: string
          settings?: Json | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      trip_stops: {
        Row: {
          created_at: string
          duration_seconds: number | null
          end_at: string | null
          id: string
          lat: number
          lng: number
          poi_id: string | null
          start_at: string
          stop_class: string
          tenant_id: string
          trip_id: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          end_at?: string | null
          id?: string
          lat: number
          lng: number
          poi_id?: string | null
          start_at: string
          stop_class?: string
          tenant_id: string
          trip_id?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          end_at?: string | null
          id?: string
          lat?: number
          lng?: number
          poi_id?: string | null
          start_at?: string
          stop_class?: string
          tenant_id?: string
          trip_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_stops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stops_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stops_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          confidence_score: number | null
          created_at: string
          detection_mode: string
          distance_km_estimated: number | null
          end_at: string | null
          id: string
          moving_time_seconds: number | null
          start_at: string
          stopped_time_seconds: number | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          detection_mode?: string
          distance_km_estimated?: number | null
          end_at?: string | null
          id?: string
          moving_time_seconds?: number | null
          start_at: string
          stopped_time_seconds?: number | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          detection_mode?: string
          distance_km_estimated?: number | null
          end_at?: string | null
          id?: string
          moving_time_seconds?: number | null
          start_at?: string
          stopped_time_seconds?: number | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_capabilities: {
        Row: {
          capabilities: Json
          confidence_score: number | null
          id: string
          last_detected_at: string | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          capabilities?: Json
          confidence_score?: number | null
          id?: string
          last_detected_at?: string | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          capabilities?: Json
          confidence_score?: number | null
          id?: string
          last_detected_at?: string | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_capabilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_capabilities_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_driver_assignments: {
        Row: {
          created_at: string
          driver_id: string
          end_at: string | null
          id: string
          start_at: string
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          end_at?: string | null
          id?: string
          start_at?: string
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          end_at?: string | null
          id?: string
          start_at?: string
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_driver_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_driver_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_driver_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_tracker_links: {
        Row: {
          active: boolean
          created_at: string
          end_at: string | null
          id: string
          provider_unit_id: string
          start_at: string
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_at?: string | null
          id?: string
          provider_unit_id: string
          start_at?: string
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          end_at?: string | null
          id?: string
          provider_unit_id?: string
          start_at?: string
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_tracker_links_provider_unit_id_fkey"
            columns: ["provider_unit_id"]
            isOneToOne: false
            referencedRelation: "provider_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_tracker_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_tracker_links_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          nickname: string | null
          plate: string
          tags: Json | null
          tenant_id: string
          type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nickname?: string | null
          plate: string
          tags?: Json | null
          tenant_id: string
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          nickname?: string | null
          plate?: string
          tags?: Json | null
          tenant_id?: string
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_tenant_with_owner: {
        Args: { _tenant_name: string }
        Returns: string
      }
      get_user_tenant_ids: { Args: never; Returns: string[] }
      has_tenant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
        }
        Returns: boolean
      }
      is_tenant_admin: { Args: { _tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      upsert_geofence: {
        Args: {
          _category: string
          _enabled: boolean
          _geojson: string
          _id: string
          _name: string
          _tenant_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "operator" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "operator", "client"],
    },
  },
} as const
