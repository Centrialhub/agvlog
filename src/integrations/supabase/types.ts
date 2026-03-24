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
          source: string | null
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
          source?: string | null
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
          source?: string | null
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
      clients: {
        Row: {
          active: boolean
          addresses: Json | null
          company_name: string
          contacts: Json | null
          created_at: string
          created_by: string | null
          id: string
          legal_name: string | null
          payment_notes: string | null
          service_notes: string | null
          tax_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          addresses?: Json | null
          company_name: string
          contacts?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          legal_name?: string | null
          payment_notes?: string | null
          service_notes?: string | null
          tax_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          addresses?: Json | null
          company_name?: string
          contacts?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          legal_name?: string | null
          payment_notes?: string | null
          service_notes?: string | null
          tax_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
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
          source: string | null
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
          source?: string | null
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
          source?: string | null
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
      fiscal_documents: {
        Row: {
          access_key: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          document_type: string
          id: string
          invoice_number: string | null
          issue_date: string | null
          load_id: string | null
          order_id: string | null
          pallet_count: number | null
          product_summary: string | null
          recipient: string | null
          remitter: string | null
          status: string
          tenant_id: string
          updated_at: string
          value: number | null
          weight_kg: number | null
        }
        Insert: {
          access_key?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          order_id?: string | null
          pallet_count?: number | null
          product_summary?: string | null
          recipient?: string | null
          remitter?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          value?: number | null
          weight_kg?: number | null
        }
        Update: {
          access_key?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          order_id?: string | null
          pallet_count?: number | null
          product_summary?: string | null
          recipient?: string | null
          remitter?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          value?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_events: {
        Row: {
          created_at: string
          delta: number | null
          end_value: number | null
          event_at: string
          event_type: string
          id: string
          payload: Json | null
          start_value: number | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          delta?: number | null
          end_value?: number | null
          event_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          start_value?: number | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          delta?: number | null
          end_value?: number | null
          event_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          start_value?: number | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_readings: {
        Row: {
          captured_at: string
          fuel_unit: string
          fuel_value: number
          raw: Json | null
          source_key: string | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          captured_at: string
          fuel_unit?: string
          fuel_value: number
          raw?: Json | null
          source_key?: string | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          captured_at?: string
          fuel_unit?: string
          fuel_value?: number
          raw?: Json | null
          source_key?: string | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_readings_vehicle_id_fkey"
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
      geofence_states: {
        Row: {
          geofence_id: string
          is_inside: boolean
          last_changed_at: string | null
          last_checked_at: string | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          geofence_id: string
          is_inside?: boolean
          last_changed_at?: string | null
          last_checked_at?: string | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          geofence_id?: string
          is_inside?: boolean
          last_changed_at?: string | null
          last_checked_at?: string | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_states_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_states_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_states_vehicle_id_fkey"
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
          poll_memo: Json
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
          poll_memo?: Json
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
          poll_memo?: Json
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
      inventory_balances: {
        Row: {
          client_id: string | null
          first_inbound_at: string | null
          id: string
          item_description: string
          last_movement_at: string | null
          location_id: string | null
          pallet_count: number
          quantity: number
          tenant_id: string
          updated_at: string
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          client_id?: string | null
          first_inbound_at?: string | null
          id?: string
          item_description: string
          last_movement_at?: string | null
          location_id?: string | null
          pallet_count?: number
          quantity?: number
          tenant_id: string
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          client_id?: string | null
          first_inbound_at?: string | null
          id?: string
          item_description?: string
          last_movement_at?: string | null
          location_id?: string | null
          pallet_count?: number
          quantity?: number
          tenant_id?: string
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          active: boolean
          code: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          fiscal_document_id: string | null
          id: string
          item_description: string
          location_id: string | null
          moved_at: string
          movement_type: string
          notes: string | null
          pallet_count: number | null
          quantity: number
          tenant_id: string
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_id?: string | null
          id?: string
          item_description: string
          location_id?: string | null
          moved_at?: string
          movement_type?: string
          notes?: string | null
          pallet_count?: number | null
          quantity?: number
          tenant_id: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_id?: string | null
          id?: string
          item_description?: string
          location_id?: string | null
          moved_at?: string
          movement_type?: string
          notes?: string | null
          pallet_count?: number | null
          quantity?: number
          tenant_id?: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      load_documents: {
        Row: {
          created_at: string
          fiscal_document_id: string
          id: string
          load_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          fiscal_document_id: string
          id?: string
          load_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          fiscal_document_id?: string
          id?: string
          load_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_documents_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      load_orders: {
        Row: {
          created_at: string
          id: string
          load_id: string
          order_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          load_id: string
          order_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          load_id?: string
          order_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_orders_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          created_at: string
          created_by: string | null
          destination: string | null
          driver_id: string | null
          id: string
          load_number: string
          notes: string | null
          origin: string | null
          status: string
          tenant_id: string
          total_pallet_count: number | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          trip_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          destination?: string | null
          driver_id?: string | null
          id?: string
          load_number: string
          notes?: string | null
          origin?: string | null
          status?: string
          tenant_id: string
          total_pallet_count?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          trip_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          destination?: string | null
          driver_id?: string | null
          id?: string
          load_number?: string
          notes?: string | null
          origin?: string | null
          status?: string
          tenant_id?: string
          total_pallet_count?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          trip_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_daily: {
        Row: {
          avg_speed_kmh: number | null
          day: string
          fuel_consumed: number | null
          fuel_drain_events: number | null
          fuel_end: number | null
          fuel_refuel_events: number | null
          fuel_start: number | null
          km_estimated: number | null
          max_speed_kmh: number | null
          moving_time_seconds: number | null
          offline_minutes: number | null
          overnight_stops_count: number | null
          overspeed_events: number | null
          overspeed_minutes: number | null
          route_deviation_events: number | null
          stopped_time_seconds: number | null
          stops_count: number | null
          tenant_id: string
          trips_count: number | null
          vehicle_id: string
        }
        Insert: {
          avg_speed_kmh?: number | null
          day: string
          fuel_consumed?: number | null
          fuel_drain_events?: number | null
          fuel_end?: number | null
          fuel_refuel_events?: number | null
          fuel_start?: number | null
          km_estimated?: number | null
          max_speed_kmh?: number | null
          moving_time_seconds?: number | null
          offline_minutes?: number | null
          overnight_stops_count?: number | null
          overspeed_events?: number | null
          overspeed_minutes?: number | null
          route_deviation_events?: number | null
          stopped_time_seconds?: number | null
          stops_count?: number | null
          tenant_id: string
          trips_count?: number | null
          vehicle_id: string
        }
        Update: {
          avg_speed_kmh?: number | null
          day?: string
          fuel_consumed?: number | null
          fuel_drain_events?: number | null
          fuel_end?: number | null
          fuel_refuel_events?: number | null
          fuel_start?: number | null
          km_estimated?: number | null
          max_speed_kmh?: number | null
          moving_time_seconds?: number | null
          offline_minutes?: number | null
          overnight_stops_count?: number | null
          overspeed_events?: number | null
          overspeed_minutes?: number | null
          route_deviation_events?: number | null
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
      orders: {
        Row: {
          cargo_type: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          id: string
          notes: string | null
          order_number: string
          origin: string | null
          pallet_count: number | null
          promised_date: string | null
          quantity: number | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          cargo_type?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          notes?: string | null
          order_number: string
          origin?: string | null
          pallet_count?: number | null
          promised_date?: string | null
          quantity?: number | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          cargo_type?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          origin?: string | null
          pallet_count?: number | null
          promised_date?: string | null
          quantity?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pois: {
        Row: {
          category: string | null
          confidence_score: number | null
          created_at: string
          dedupe_key: string | null
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
          dedupe_key?: string | null
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
          dedupe_key?: string | null
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
          metadata: Json
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
          metadata?: Json
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
          metadata?: Json
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
      route_runs: {
        Row: {
          created_at: string
          id: string
          inside_ratio: number | null
          outside_minutes: number | null
          route_id: string
          status: string
          tenant_id: string
          trip_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inside_ratio?: number | null
          outside_minutes?: number | null
          route_id: string
          status?: string
          tenant_id: string
          trip_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inside_ratio?: number | null
          outside_minutes?: number | null
          route_id?: string
          status?: string
          tenant_id?: string
          trip_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_runs_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_runs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_runs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_templates: {
        Row: {
          allowed_outside_minutes: number | null
          corridor_geofence_id: string | null
          corridor_inside_ratio_threshold: number | null
          created_at: string
          enabled: boolean
          end_poi_id: string | null
          id: string
          name: string
          route_speed_limit_kmh: number | null
          start_poi_id: string | null
          tenant_id: string
        }
        Insert: {
          allowed_outside_minutes?: number | null
          corridor_geofence_id?: string | null
          corridor_inside_ratio_threshold?: number | null
          created_at?: string
          enabled?: boolean
          end_poi_id?: string | null
          id?: string
          name: string
          route_speed_limit_kmh?: number | null
          start_poi_id?: string | null
          tenant_id: string
        }
        Update: {
          allowed_outside_minutes?: number | null
          corridor_geofence_id?: string | null
          corridor_inside_ratio_threshold?: number | null
          created_at?: string
          enabled?: boolean
          end_poi_id?: string | null
          id?: string
          name?: string
          route_speed_limit_kmh?: number | null
          start_poi_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_templates_corridor_geofence_id_fkey"
            columns: ["corridor_geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_end_poi_id_fkey"
            columns: ["end_poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_start_poi_id_fkey"
            columns: ["start_poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_templates_tenant_id_fkey"
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
      vehicle_events: {
        Row: {
          created_at: string
          event_at: string
          event_type: string
          id: string
          lat: number | null
          lng: number | null
          metadata: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          event_at?: string
          event_type: string
          id?: string
          lat?: number | null
          lng?: number | null
          metadata?: Json | null
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          event_at?: string
          event_type?: string
          id?: string
          lat?: number | null
          lng?: number | null
          metadata?: Json | null
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_processing_queue: {
        Row: {
          attempts: number
          last_error: string | null
          last_position_at: string | null
          processed_at: string | null
          queued_at: string
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          attempts?: number
          last_error?: string | null
          last_position_at?: string | null
          processed_at?: string | null
          queued_at?: string
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          attempts?: number
          last_error?: string | null
          last_position_at?: string | null
          processed_at?: string | null
          queued_at?: string
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_processing_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_processing_queue_vehicle_id_fkey"
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
          base_consumption_estimate: number | null
          body_type: string | null
          created_at: string
          created_by: string | null
          expected_speed_penalty_loaded: number | null
          fuel_canonical_key: string | null
          id: string
          loaded_consumption_factor: number | null
          max_pallets: number | null
          max_volume_m3: number | null
          max_weight_kg: number | null
          nickname: string | null
          plate: string
          speed_limit_kmh: number | null
          tags: Json | null
          tank_capacity_liters: number | null
          tenant_id: string
          type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          base_consumption_estimate?: number | null
          body_type?: string | null
          created_at?: string
          created_by?: string | null
          expected_speed_penalty_loaded?: number | null
          fuel_canonical_key?: string | null
          id?: string
          loaded_consumption_factor?: number | null
          max_pallets?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          nickname?: string | null
          plate: string
          speed_limit_kmh?: number | null
          tags?: Json | null
          tank_capacity_liters?: number | null
          tenant_id: string
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          base_consumption_estimate?: number | null
          body_type?: string | null
          created_at?: string
          created_by?: string | null
          expected_speed_penalty_loaded?: number | null
          fuel_canonical_key?: string | null
          id?: string
          loaded_consumption_factor?: number | null
          max_pallets?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          nickname?: string | null
          plate?: string
          speed_limit_kmh?: number | null
          tags?: Json | null
          tank_capacity_liters?: number | null
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
      vehicles_state: {
        Row: {
          heading: number | null
          last_movement_at: string | null
          last_position_at: string | null
          last_position_id: string | null
          lat: number | null
          lng: number | null
          movement_state: string
          speed: number
          stopped_duration_seconds: number | null
          stopped_since: string | null
          tenant_id: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          heading?: number | null
          last_movement_at?: string | null
          last_position_at?: string | null
          last_position_id?: string | null
          lat?: number | null
          lng?: number | null
          movement_state?: string
          speed?: number
          stopped_duration_seconds?: number | null
          stopped_since?: string | null
          tenant_id: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          heading?: number | null
          last_movement_at?: string | null
          last_position_at?: string | null
          last_position_id?: string | null
          lat?: number | null
          lng?: number | null
          movement_state?: string
          speed?: number
          stopped_duration_seconds?: number | null
          stopped_since?: string | null
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_state_last_position_id_fkey"
            columns: ["last_position_id"]
            isOneToOne: false
            referencedRelation: "positions_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_state_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_points_in_geofence: {
        Args: { _geofence_id: string; _points: Json }
        Returns: Json
      }
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
      is_point_in_geofence: {
        Args: { _geofence_id: string; _lat: number; _lng: number }
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
