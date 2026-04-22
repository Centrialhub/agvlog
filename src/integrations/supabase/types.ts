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
      asset_movements: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          from_employee_id: string | null
          from_location: string | null
          id: string
          moved_at: string
          movement_type: string
          notes: string | null
          reason: string | null
          tenant_id: string
          to_employee_id: string | null
          to_location: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          from_employee_id?: string | null
          from_location?: string | null
          id?: string
          moved_at?: string
          movement_type: string
          notes?: string | null
          reason?: string | null
          tenant_id: string
          to_employee_id?: string | null
          to_location?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          from_employee_id?: string | null
          from_location?: string | null
          id?: string
          moved_at?: string
          movement_type?: string
          notes?: string | null
          reason?: string | null
          tenant_id?: string
          to_employee_id?: string | null
          to_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_movements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_movements_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_movements_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          acquisition_cost: number | null
          acquisition_date: string | null
          asset_code: string
          branch: string | null
          brand: string | null
          category: string
          chassis_number: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          current_location: string | null
          current_value: number | null
          depreciation_rate: number | null
          description: string | null
          documents: Json | null
          id: string
          model: string | null
          name: string
          notes: string | null
          plate: string | null
          responsible_employee_id: string | null
          serial_number: string | null
          status: string
          supplier: string | null
          tags: Json | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
          year: number | null
        }
        Insert: {
          acquisition_cost?: number | null
          acquisition_date?: string | null
          asset_code: string
          branch?: string | null
          brand?: string | null
          category: string
          chassis_number?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          current_value?: number | null
          depreciation_rate?: number | null
          description?: string | null
          documents?: Json | null
          id?: string
          model?: string | null
          name: string
          notes?: string | null
          plate?: string | null
          responsible_employee_id?: string | null
          serial_number?: string | null
          status?: string
          supplier?: string | null
          tags?: Json | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          year?: number | null
        }
        Update: {
          acquisition_cost?: number | null
          acquisition_date?: string | null
          asset_code?: string
          branch?: string | null
          brand?: string | null
          category?: string
          chassis_number?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          current_value?: number | null
          depreciation_rate?: number | null
          description?: string | null
          documents?: Json | null
          id?: string
          model?: string | null
          name?: string
          notes?: string | null
          plate?: string | null
          responsible_employee_id?: string | null
          serial_number?: string | null
          status?: string
          supplier?: string | null
          tags?: Json | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_responsible_employee_id_fkey"
            columns: ["responsible_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_executions: {
        Row: {
          blocked_operation: boolean | null
          checked_items: Json
          checklist_id: string
          created_at: string
          dispatch_trip_id: string | null
          employee_id: string | null
          executed_at: string
          executed_by: string | null
          execution_type: string | null
          failed_items: number | null
          generated_incident_id: string | null
          generated_maintenance_id: string | null
          id: string
          notes: string | null
          passed_items: number | null
          status: string
          tenant_id: string
          total_items: number | null
          vehicle_id: string | null
        }
        Insert: {
          blocked_operation?: boolean | null
          checked_items?: Json
          checklist_id: string
          created_at?: string
          dispatch_trip_id?: string | null
          employee_id?: string | null
          executed_at?: string
          executed_by?: string | null
          execution_type?: string | null
          failed_items?: number | null
          generated_incident_id?: string | null
          generated_maintenance_id?: string | null
          id?: string
          notes?: string | null
          passed_items?: number | null
          status?: string
          tenant_id: string
          total_items?: number | null
          vehicle_id?: string | null
        }
        Update: {
          blocked_operation?: boolean | null
          checked_items?: Json
          checklist_id?: string
          created_at?: string
          dispatch_trip_id?: string | null
          employee_id?: string | null
          executed_at?: string
          executed_by?: string | null
          execution_type?: string | null
          failed_items?: number | null
          generated_incident_id?: string | null
          generated_maintenance_id?: string | null
          id?: string
          notes?: string | null
          passed_items?: number | null
          status?: string
          tenant_id?: string
          total_items?: number | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_executions_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "operational_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_executions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_executions_generated_incident_id_fkey"
            columns: ["generated_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_executions_generated_maintenance_id_fkey"
            columns: ["generated_maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      client_regions: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          municipality: string
          payer_group: string | null
          region_name: string
          state_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          municipality: string
          payer_group?: string | null
          region_name: string
          state_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          municipality?: string
          payer_group?: string | null
          region_name?: string
          state_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_regions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_regions_tenant_id_fkey"
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
      consumption_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_value: number | null
          alert_type: string
          created_at: string
          deviation_percent: number | null
          expected_value: number | null
          id: string
          message: string
          related_fueling_id: string | null
          severity: string
          status: string
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value?: number | null
          alert_type: string
          created_at?: string
          deviation_percent?: number | null
          expected_value?: number | null
          id?: string
          message: string
          related_fueling_id?: string | null
          severity?: string
          status?: string
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value?: number | null
          alert_type?: string
          created_at?: string
          deviation_percent?: number | null
          expected_value?: number | null
          id?: string
          message?: string
          related_fueling_id?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      dispatch_events: {
        Row: {
          created_at: string
          created_by: string | null
          dispatch_stop_id: string | null
          dispatch_trip_id: string
          event_at: string
          event_type: string
          id: string
          notes: string | null
          payload: Json | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id: string
          event_at?: string
          event_type: string
          id?: string
          notes?: string | null
          payload?: Json | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id?: string
          event_at?: string
          event_type?: string
          id?: string
          notes?: string | null
          payload?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_events_dispatch_stop_id_fkey"
            columns: ["dispatch_stop_id"]
            isOneToOne: false
            referencedRelation: "dispatch_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_events_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_stops: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
          client_id: string | null
          created_at: string
          destination: string | null
          dispatch_trip_id: string
          id: string
          notes: string | null
          planned_arrival_at: string | null
          status: string
          stop_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          client_id?: string | null
          created_at?: string
          destination?: string | null
          dispatch_trip_id: string
          id?: string
          notes?: string | null
          planned_arrival_at?: string | null
          status?: string
          stop_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          client_id?: string | null
          created_at?: string
          destination?: string | null
          dispatch_trip_id?: string
          id?: string
          notes?: string | null
          planned_arrival_at?: string | null
          status?: string
          stop_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_stops_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_stops_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_stops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_trips: {
        Row: {
          actual_end_at: string | null
          actual_start_at: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          load_id: string | null
          notes: string | null
          planned_end_at: string | null
          planned_start_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          load_id?: string | null
          notes?: string | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          load_id?: string | null
          notes?: string | null
          planned_end_at?: string | null
          planned_start_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_trips_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_trips_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_expenses: {
        Row: {
          amount: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          category: string
          created_at: string
          dispatch_trip_id: string | null
          driver_id: string | null
          expense_at: string
          id: string
          notes: string | null
          receipt_url: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          dispatch_trip_id?: string | null
          driver_id?: string | null
          expense_at?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          dispatch_trip_id?: string | null
          driver_id?: string | null
          expense_at?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_expenses_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_expenses_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_expenses_tenant_id_fkey"
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
          current_vehicle_id: string | null
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
          current_vehicle_id?: string | null
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
          current_vehicle_id?: string | null
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
            foreignKeyName: "drivers_current_vehicle_id_fkey"
            columns: ["current_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          attachment_url: string | null
          created_at: string
          created_by: string | null
          document_name: string
          document_number: string | null
          document_type: string
          employee_id: string
          expiry_date: string | null
          id: string
          issue_date: string | null
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          created_by?: string | null
          document_name: string
          document_number?: string | null
          document_type: string
          employee_id: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          created_by?: string | null
          document_name?: string
          document_number?: string | null
          document_type?: string
          employee_id?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: Json | null
          branch: string | null
          cnh_category: string | null
          cnh_expiry: string | null
          cnh_number: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          department: string | null
          doc_cpf: string | null
          doc_rg: string | null
          driver_id: string | null
          email: string | null
          hire_date: string | null
          id: string
          manager_id: string | null
          medical_exam_expiry: string | null
          name: string
          notes: string | null
          phone: string | null
          role_title: string | null
          status: string
          tags: Json | null
          tenant_id: string
          termination_date: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          address?: Json | null
          branch?: string | null
          cnh_category?: string | null
          cnh_expiry?: string | null
          cnh_number?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          doc_cpf?: string | null
          doc_rg?: string | null
          driver_id?: string | null
          email?: string | null
          hire_date?: string | null
          id?: string
          manager_id?: string | null
          medical_exam_expiry?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          role_title?: string | null
          status?: string
          tags?: Json | null
          tenant_id: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          address?: Json | null
          branch?: string | null
          cnh_category?: string | null
          cnh_expiry?: string | null
          cnh_number?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          doc_cpf?: string | null
          doc_rg?: string | null
          driver_id?: string | null
          email?: string | null
          hire_date?: string | null
          id?: string
          manager_id?: string | null
          medical_exam_expiry?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          role_title?: string | null
          status?: string
          tags?: Json | null
          tenant_id?: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
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
          cbs_base: number | null
          cbs_rate: number | null
          cbs_value: number | null
          client_id: string | null
          created_at: string
          created_by: string | null
          document_type: string
          freight_breakdown: Json | null
          freight_table_id: string | null
          freight_value: number | null
          ibs_base: number | null
          ibs_rate: number | null
          ibs_value: number | null
          id: string
          invoice_number: string | null
          issue_date: string | null
          load_id: string | null
          order_id: string | null
          pallet_count: number | null
          product_summary: string | null
          recipient: string | null
          recipient_city: string | null
          recipient_neighborhood: string | null
          recipient_state: string | null
          remitter: string | null
          status: string
          tenant_id: string
          updated_at: string
          value: number | null
          weight_kg: number | null
        }
        Insert: {
          access_key?: string | null
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string
          freight_breakdown?: Json | null
          freight_table_id?: string | null
          freight_value?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          order_id?: string | null
          pallet_count?: number | null
          product_summary?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_neighborhood?: string | null
          recipient_state?: string | null
          remitter?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          value?: number | null
          weight_kg?: number | null
        }
        Update: {
          access_key?: string | null
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string
          freight_breakdown?: Json | null
          freight_table_id?: string | null
          freight_value?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          order_id?: string | null
          pallet_count?: number | null
          product_summary?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_neighborhood?: string | null
          recipient_state?: string | null
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
      freight_calculation_log: {
        Row: {
          base_value: number | null
          components: Json | null
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          fallback_reason: string | null
          fallback_used: boolean | null
          final_value: number | null
          freight_table_id: string | null
          freight_table_name: string | null
          id: string
          ignored_criteria: Json | null
          is_override: boolean | null
          matched_criteria: Json | null
          override_by: string | null
          override_reason: string | null
          region_id: string | null
          region_name: string | null
          tenant_id: string
        }
        Insert: {
          base_value?: number | null
          components?: Json | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          fallback_reason?: string | null
          fallback_used?: boolean | null
          final_value?: number | null
          freight_table_id?: string | null
          freight_table_name?: string | null
          id?: string
          ignored_criteria?: Json | null
          is_override?: boolean | null
          matched_criteria?: Json | null
          override_by?: string | null
          override_reason?: string | null
          region_id?: string | null
          region_name?: string | null
          tenant_id: string
        }
        Update: {
          base_value?: number | null
          components?: Json | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          fallback_reason?: string | null
          fallback_used?: boolean | null
          final_value?: number | null
          freight_table_id?: string | null
          freight_table_name?: string | null
          id?: string
          ignored_criteria?: Json | null
          is_override?: boolean | null
          matched_criteria?: Json | null
          override_by?: string | null
          override_reason?: string | null
          region_id?: string | null
          region_name?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      freight_tables: {
        Row: {
          blocked: boolean
          body_type: string | null
          cargo_type: string | null
          created_at: string
          ctrc_type: string | null
          destination_municipality: string | null
          destination_region: string | null
          destination_state: string | null
          dispatch_value: number | null
          distribution_type: string | null
          fixed_value: number | null
          gris_value: number | null
          id: string
          insurance_percent: number | null
          loading_value: number | null
          min_value: number | null
          notes: string | null
          origin_municipality: string | null
          origin_region: string | null
          origin_state: string | null
          payer: string | null
          payer_group: string | null
          per_kg_value: number | null
          per_pallet_value: number | null
          rate_percent: number | null
          route: string | null
          specificity_score: number | null
          table_code: number
          table_name: string
          tenant_id: string
          toll_value: number | null
          tracking_value: number | null
          updated_at: string
          valid_from: string
          valid_until: string | null
          vehicle_type: string | null
        }
        Insert: {
          blocked?: boolean
          body_type?: string | null
          cargo_type?: string | null
          created_at?: string
          ctrc_type?: string | null
          destination_municipality?: string | null
          destination_region?: string | null
          destination_state?: string | null
          dispatch_value?: number | null
          distribution_type?: string | null
          fixed_value?: number | null
          gris_value?: number | null
          id?: string
          insurance_percent?: number | null
          loading_value?: number | null
          min_value?: number | null
          notes?: string | null
          origin_municipality?: string | null
          origin_region?: string | null
          origin_state?: string | null
          payer?: string | null
          payer_group?: string | null
          per_kg_value?: number | null
          per_pallet_value?: number | null
          rate_percent?: number | null
          route?: string | null
          specificity_score?: number | null
          table_code?: number
          table_name: string
          tenant_id: string
          toll_value?: number | null
          tracking_value?: number | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          vehicle_type?: string | null
        }
        Update: {
          blocked?: boolean
          body_type?: string | null
          cargo_type?: string | null
          created_at?: string
          ctrc_type?: string | null
          destination_municipality?: string | null
          destination_region?: string | null
          destination_state?: string | null
          dispatch_value?: number | null
          distribution_type?: string | null
          fixed_value?: number | null
          gris_value?: number | null
          id?: string
          insurance_percent?: number | null
          loading_value?: number | null
          min_value?: number | null
          notes?: string | null
          origin_municipality?: string | null
          origin_region?: string | null
          origin_state?: string | null
          payer?: string | null
          payer_group?: string | null
          per_kg_value?: number | null
          per_pallet_value?: number | null
          rate_percent?: number | null
          route?: string | null
          specificity_score?: number | null
          table_code?: number
          table_name?: string
          tenant_id?: string
          toll_value?: number | null
          tracking_value?: number | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_tables_tenant_id_fkey"
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
      incident_attachments: {
        Row: {
          created_at: string
          description: string | null
          file_name: string | null
          file_type: string | null
          file_url: string
          id: string
          incident_id: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url: string
          id?: string
          incident_id: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string
          id?: string
          incident_id?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_attachments_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_responsible: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          cost_assigned: number | null
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string | null
          final_opinion: string | null
          id: string
          incident_id: string
          responsibility_type: string
          tenant_id: string
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          cost_assigned?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string | null
          final_opinion?: string | null
          id?: string
          incident_id: string
          responsibility_type?: string
          tenant_id: string
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          cost_assigned?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string | null
          final_opinion?: string | null
          id?: string
          incident_id?: string
          responsibility_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_responsible_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_responsible_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          action_plan: string | null
          actual_cost: number | null
          asset_id: string | null
          category: string | null
          client_id: string | null
          closed_at: string | null
          closed_by: string | null
          conclusion: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dispatch_trip_id: string | null
          driver_id: string | null
          employee_id: string | null
          estimated_cost: number | null
          fiscal_document_id: string | null
          id: string
          incident_number: string
          incident_type: string
          insurance_claim: boolean | null
          insurance_value: number | null
          load_id: string | null
          occurred_at: string
          opened_by: string | null
          order_id: string | null
          origin_type: string | null
          probable_cause: string | null
          reported_at: string
          resolved_at: string | null
          root_cause: string | null
          route_id: string | null
          severity: string
          sla_deadline: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
          validated_at: string | null
          validated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          action_plan?: string | null
          actual_cost?: number | null
          asset_id?: string | null
          category?: string | null
          client_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          employee_id?: string | null
          estimated_cost?: number | null
          fiscal_document_id?: string | null
          id?: string
          incident_number: string
          incident_type: string
          insurance_claim?: boolean | null
          insurance_value?: number | null
          load_id?: string | null
          occurred_at?: string
          opened_by?: string | null
          order_id?: string | null
          origin_type?: string | null
          probable_cause?: string | null
          reported_at?: string
          resolved_at?: string | null
          root_cause?: string | null
          route_id?: string | null
          severity?: string
          sla_deadline?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          validated_at?: string | null
          validated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          action_plan?: string | null
          actual_cost?: number | null
          asset_id?: string | null
          category?: string | null
          client_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          employee_id?: string | null
          estimated_cost?: number | null
          fiscal_document_id?: string | null
          id?: string
          incident_number?: string
          incident_type?: string
          insurance_claim?: boolean | null
          insurance_value?: number | null
          load_id?: string | null
          occurred_at?: string
          opened_by?: string | null
          order_id?: string | null
          origin_type?: string | null
          probable_cause?: string | null
          reported_at?: string
          resolved_at?: string | null
          root_cause?: string | null
          route_id?: string | null
          severity?: string
          sla_deadline?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          validated_at?: string | null
          validated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
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
      load_items: {
        Row: {
          created_at: string
          fiscal_document_id: string | null
          id: string
          item_description: string
          load_id: string
          notes: string | null
          order_id: string | null
          pallet_count: number
          quantity: number
          status: string
          tenant_id: string
          updated_at: string
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          fiscal_document_id?: string | null
          id?: string
          item_description?: string
          load_id: string
          notes?: string | null
          order_id?: string | null
          pallet_count?: number
          quantity?: number
          status?: string
          tenant_id: string
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          fiscal_document_id?: string | null
          id?: string
          item_description?: string
          load_id?: string
          notes?: string | null
          order_id?: string | null
          pallet_count?: number
          quantity?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "load_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_items_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_items_tenant_id_fkey"
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
      maintenance_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          asset_id: string | null
          checklist_results: Json | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          diagnosis: string | null
          downtime_hours: number | null
          horimeter_hours: number | null
          id: string
          incident_id: string | null
          labor_cost: number | null
          maintenance_type: string
          notes: string | null
          odometer_km: number | null
          opened_at: string
          order_number: string
          parts_cost: number | null
          priority: string
          reported_problem: string | null
          responsible_employee_id: string | null
          schedule_id: string | null
          scheduled_at: string | null
          services_performed: string | null
          started_at: string | null
          status: string
          supplier_vendor: string | null
          tenant_id: string
          total_cost: number | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          asset_id?: string | null
          checklist_results?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          downtime_hours?: number | null
          horimeter_hours?: number | null
          id?: string
          incident_id?: string | null
          labor_cost?: number | null
          maintenance_type?: string
          notes?: string | null
          odometer_km?: number | null
          opened_at?: string
          order_number: string
          parts_cost?: number | null
          priority?: string
          reported_problem?: string | null
          responsible_employee_id?: string | null
          schedule_id?: string | null
          scheduled_at?: string | null
          services_performed?: string | null
          started_at?: string | null
          status?: string
          supplier_vendor?: string | null
          tenant_id: string
          total_cost?: number | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          asset_id?: string | null
          checklist_results?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          downtime_hours?: number | null
          horimeter_hours?: number | null
          id?: string
          incident_id?: string | null
          labor_cost?: number | null
          maintenance_type?: string
          notes?: string | null
          odometer_km?: number | null
          opened_at?: string
          order_number?: string
          parts_cost?: number | null
          priority?: string
          reported_problem?: string | null
          responsible_employee_id?: string | null
          schedule_id?: string | null
          scheduled_at?: string | null
          services_performed?: string | null
          started_at?: string | null
          status?: string
          supplier_vendor?: string | null
          tenant_id?: string
          total_cost?: number | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_responsible_employee_id_fkey"
            columns: ["responsible_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "maintenance_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_parts: {
        Row: {
          created_at: string
          id: string
          item_description: string
          maintenance_order_id: string
          notes: string | null
          quantity: number
          stock_item_id: string | null
          stock_movement_id: string | null
          tenant_id: string
          total_cost: number | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_description: string
          maintenance_order_id: string
          notes?: string | null
          quantity?: number
          stock_item_id?: string | null
          stock_movement_id?: string | null
          tenant_id: string
          total_cost?: number | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          item_description?: string
          maintenance_order_id?: string
          notes?: string | null
          quantity?: number
          stock_item_id?: string | null
          stock_movement_id?: string | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_parts_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_parts_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_parts_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          active: boolean | null
          asset_id: string | null
          auto_create_order: boolean | null
          created_at: string
          created_by: string | null
          id: string
          interval_days: number | null
          interval_hours: number | null
          interval_km: number | null
          last_date: string | null
          last_hours: number | null
          last_km: number | null
          maintenance_type: string
          next_date: string | null
          next_hours: number | null
          next_km: number | null
          notes: string | null
          schedule_name: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          active?: boolean | null
          asset_id?: string | null
          auto_create_order?: boolean | null
          created_at?: string
          created_by?: string | null
          id?: string
          interval_days?: number | null
          interval_hours?: number | null
          interval_km?: number | null
          last_date?: string | null
          last_hours?: number | null
          last_km?: number | null
          maintenance_type?: string
          next_date?: string | null
          next_hours?: number | null
          next_km?: number | null
          notes?: string | null
          schedule_name: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          active?: boolean | null
          asset_id?: string | null
          auto_create_order?: boolean | null
          created_at?: string
          created_by?: string | null
          id?: string
          interval_days?: number | null
          interval_hours?: number | null
          interval_km?: number | null
          last_date?: string | null
          last_hours?: number | null
          last_km?: number | null
          maintenance_type?: string
          next_date?: string | null
          next_hours?: number | null
          next_km?: number | null
          notes?: string | null
          schedule_name?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
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
      operational_checklists: {
        Row: {
          active: boolean | null
          can_block_operation: boolean | null
          can_generate_incident: boolean | null
          can_generate_maintenance: boolean | null
          checklist_type: string
          created_at: string
          created_by: string | null
          id: string
          items: Json
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          can_block_operation?: boolean | null
          can_generate_incident?: boolean | null
          can_generate_maintenance?: boolean | null
          checklist_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          can_block_operation?: boolean | null
          can_generate_incident?: boolean | null
          can_generate_maintenance?: boolean | null
          checklist_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      operational_events: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          driver_id: string | null
          event_type: string
          financial_impact: number | null
          id: string
          load_id: string | null
          order_id: string | null
          resolution: string | null
          resolved_at: string | null
          severity: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id?: string | null
          event_type: string
          financial_impact?: number | null
          id?: string
          load_id?: string | null
          order_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          driver_id?: string | null
          event_type?: string
          financial_impact?: number | null
          id?: string
          load_id?: string | null
          order_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operational_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_routes: {
        Row: {
          active: boolean | null
          classification: string | null
          created_at: string
          created_by: string | null
          description: string | null
          destinations: Json | null
          id: string
          name: string
          periodicity_default: string | null
          region_name: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean | null
          classification?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          destinations?: Json | null
          id?: string
          name: string
          periodicity_default?: string | null
          region_name?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean | null
          classification?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          destinations?: Json | null
          id?: string
          name?: string
          periodicity_default?: string | null
          region_name?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          cargo_type: string | null
          cbs_base: number | null
          cbs_rate: number | null
          cbs_value: number | null
          city: string | null
          client_id: string | null
          cofins_rate: number | null
          cofins_value: number | null
          created_at: string
          created_by: string | null
          destination: string | null
          discount_value: number | null
          financial_value: number | null
          freight_breakdown: Json | null
          freight_delivery_value: number | null
          freight_region_id: string | null
          freight_table_id: string | null
          freight_weight_value: number | null
          gris_value: number | null
          ibs_base: number | null
          ibs_rate: number | null
          ibs_value: number | null
          icms_base: number | null
          icms_rate: number | null
          icms_value: number | null
          id: string
          insurance_percent: number | null
          insurance_value: number | null
          issue_date: string | null
          loading_value: number | null
          neighborhood: string | null
          nf_series: string | null
          notes: string | null
          order_number: string
          origin: string | null
          other_costs: number | null
          pallet_count: number | null
          payer_type: string | null
          payment_plan: string | null
          pis_rate: number | null
          pis_value: number | null
          promised_date: string | null
          quantity: number | null
          recipient: string | null
          remitter: string | null
          status: string
          subtotal: number | null
          tenant_id: string
          toll_value: number | null
          total_freight: number | null
          tracking_value: number | null
          updated_at: string
          updated_by: string | null
          value: number | null
          volume_m3: number | null
          weight_kg: number | null
        }
        Insert: {
          cargo_type?: string | null
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          city?: string | null
          client_id?: string | null
          cofins_rate?: number | null
          cofins_value?: number | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          discount_value?: number | null
          financial_value?: number | null
          freight_breakdown?: Json | null
          freight_delivery_value?: number | null
          freight_region_id?: string | null
          freight_table_id?: string | null
          freight_weight_value?: number | null
          gris_value?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          icms_base?: number | null
          icms_rate?: number | null
          icms_value?: number | null
          id?: string
          insurance_percent?: number | null
          insurance_value?: number | null
          issue_date?: string | null
          loading_value?: number | null
          neighborhood?: string | null
          nf_series?: string | null
          notes?: string | null
          order_number: string
          origin?: string | null
          other_costs?: number | null
          pallet_count?: number | null
          payer_type?: string | null
          payment_plan?: string | null
          pis_rate?: number | null
          pis_value?: number | null
          promised_date?: string | null
          quantity?: number | null
          recipient?: string | null
          remitter?: string | null
          status?: string
          subtotal?: number | null
          tenant_id: string
          toll_value?: number | null
          total_freight?: number | null
          tracking_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value?: number | null
          volume_m3?: number | null
          weight_kg?: number | null
        }
        Update: {
          cargo_type?: string | null
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          city?: string | null
          client_id?: string | null
          cofins_rate?: number | null
          cofins_value?: number | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          discount_value?: number | null
          financial_value?: number | null
          freight_breakdown?: Json | null
          freight_delivery_value?: number | null
          freight_region_id?: string | null
          freight_table_id?: string | null
          freight_weight_value?: number | null
          gris_value?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          icms_base?: number | null
          icms_rate?: number | null
          icms_value?: number | null
          id?: string
          insurance_percent?: number | null
          insurance_value?: number | null
          issue_date?: string | null
          loading_value?: number | null
          neighborhood?: string | null
          nf_series?: string | null
          notes?: string | null
          order_number?: string
          origin?: string | null
          other_costs?: number | null
          pallet_count?: number | null
          payer_type?: string | null
          payment_plan?: string | null
          pis_rate?: number | null
          pis_value?: number | null
          promised_date?: string | null
          quantity?: number | null
          recipient?: string | null
          remitter?: string | null
          status?: string
          subtotal?: number | null
          tenant_id?: string
          toll_value?: number | null
          total_freight?: number | null
          tracking_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value?: number | null
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
      receivables: {
        Row: {
          amount: number
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          fiscal_document_id: string | null
          id: string
          invoice_number: string | null
          load_id: string | null
          notes: string | null
          order_id: string | null
          received_amount: number | null
          received_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          load_id?: string | null
          notes?: string | null
          order_id?: string | null
          received_amount?: number | null
          received_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          load_id?: string | null
          notes?: string | null
          order_id?: string | null
          received_amount?: number | null
          received_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      route_planning_drafts: {
        Row: {
          converted_load_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          operational_route_id: string | null
          order_ids: Json | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          converted_load_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          operational_route_id?: string | null
          order_ids?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          converted_load_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          operational_route_id?: string | null
          order_ids?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: []
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
      route_waypoints: {
        Row: {
          address: string | null
          created_at: string
          estimated_duration_min: number | null
          geofence_id: string | null
          id: string
          label: string | null
          lat: number | null
          lng: number | null
          notes: string | null
          poi_id: string | null
          route_id: string
          tenant_id: string
          updated_at: string
          waypoint_order: number
          waypoint_type: Database["public"]["Enums"]["waypoint_type"]
        }
        Insert: {
          address?: string | null
          created_at?: string
          estimated_duration_min?: number | null
          geofence_id?: string | null
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          poi_id?: string | null
          route_id: string
          tenant_id: string
          updated_at?: string
          waypoint_order?: number
          waypoint_type?: Database["public"]["Enums"]["waypoint_type"]
        }
        Update: {
          address?: string | null
          created_at?: string
          estimated_duration_min?: number | null
          geofence_id?: string | null
          id?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          poi_id?: string | null
          route_id?: string
          tenant_id?: string
          updated_at?: string
          waypoint_order?: number
          waypoint_type?: Database["public"]["Enums"]["waypoint_type"]
        }
        Relationships: [
          {
            foreignKeyName: "route_waypoints_geofence_id_fkey"
            columns: ["geofence_id"]
            isOneToOne: false
            referencedRelation: "geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_waypoints_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_waypoints_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_waypoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          active: boolean | null
          branch: string | null
          category: string
          code: string | null
          created_at: string
          created_by: string | null
          current_quantity: number | null
          id: string
          location: string | null
          max_quantity: number | null
          min_quantity: number | null
          name: string
          notes: string | null
          supplier: string | null
          tenant_id: string
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          branch?: string | null
          category?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number | null
          id?: string
          location?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          name: string
          notes?: string | null
          supplier?: string | null
          tenant_id: string
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          branch?: string | null
          category?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number | null
          id?: string
          location?: string | null
          max_quantity?: number | null
          min_quantity?: number | null
          name?: string
          notes?: string | null
          supplier?: string | null
          tenant_id?: string
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          approved_by: string | null
          asset_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          employee_id: string | null
          from_branch: string | null
          id: string
          incident_id: string | null
          justification: string | null
          maintenance_order_id: string | null
          moved_at: string
          movement_type: string
          quantity: number
          reason: string
          responsible_employee_id: string | null
          stock_item_id: string
          tenant_id: string
          to_branch: string | null
          total_cost: number | null
          unit_cost: number | null
          vehicle_id: string | null
        }
        Insert: {
          approved_by?: string | null
          asset_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          from_branch?: string | null
          id?: string
          incident_id?: string | null
          justification?: string | null
          maintenance_order_id?: string | null
          moved_at?: string
          movement_type: string
          quantity: number
          reason: string
          responsible_employee_id?: string | null
          stock_item_id: string
          tenant_id: string
          to_branch?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          vehicle_id?: string | null
        }
        Update: {
          approved_by?: string | null
          asset_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          from_branch?: string | null
          id?: string
          incident_id?: string | null
          justification?: string | null
          maintenance_order_id?: string | null
          moved_at?: string
          movement_type?: string
          quantity?: number
          reason?: string
          responsible_employee_id?: string | null
          stock_item_id?: string
          tenant_id?: string
          to_branch?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_maintenance_order_id_fkey"
            columns: ["maintenance_order_id"]
            isOneToOne: false
            referencedRelation: "maintenance_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_responsible_employee_id_fkey"
            columns: ["responsible_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
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
      vehicle_fueling: {
        Row: {
          created_at: string
          created_by: string | null
          dispatch_trip_id: string | null
          driver_id: string | null
          employee_id: string | null
          fuel_type: string | null
          fueled_at: string
          id: string
          is_full_tank: boolean | null
          liters: number
          notes: string | null
          odometer_km: number | null
          price_per_liter: number | null
          route_trip_id: string | null
          station_address: string | null
          station_name: string | null
          tenant_id: string
          total_cost: number | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          employee_id?: string | null
          fuel_type?: string | null
          fueled_at?: string
          id?: string
          is_full_tank?: boolean | null
          liters?: number
          notes?: string | null
          odometer_km?: number | null
          price_per_liter?: number | null
          route_trip_id?: string | null
          station_address?: string | null
          station_name?: string | null
          tenant_id: string
          total_cost?: number | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          employee_id?: string | null
          fuel_type?: string | null
          fueled_at?: string
          id?: string
          is_full_tank?: boolean | null
          liters?: number
          notes?: string | null
          odometer_km?: number | null
          price_per_liter?: number | null
          route_trip_id?: string | null
          station_address?: string | null
          station_name?: string | null
          tenant_id?: string
          total_cost?: number | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_fueling_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fueling_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fueling_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fueling_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fueling_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance: {
        Row: {
          asset_id: string | null
          category: string
          completed_date: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          description: string
          downtime_hours: number | null
          employee_id: string | null
          id: string
          incident_id: string | null
          labor_cost: number | null
          maintenance_type: string
          next_date: string | null
          next_odometer: number | null
          notes: string | null
          odometer_at_service: number | null
          parts_cost: number | null
          priority: string | null
          scheduled_date: string | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string
          vendor: string | null
        }
        Insert: {
          asset_id?: string | null
          category?: string
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          downtime_hours?: number | null
          employee_id?: string | null
          id?: string
          incident_id?: string | null
          labor_cost?: number | null
          maintenance_type?: string
          next_date?: string | null
          next_odometer?: number | null
          notes?: string | null
          odometer_at_service?: number | null
          parts_cost?: number | null
          priority?: string | null
          scheduled_date?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id: string
          vendor?: string | null
        }
        Update: {
          asset_id?: string | null
          category?: string
          completed_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          downtime_hours?: number | null
          employee_id?: string | null
          id?: string
          incident_id?: string | null
          labor_cost?: number | null
          maintenance_type?: string
          next_date?: string | null
          next_odometer?: number | null
          notes?: string | null
          odometer_at_service?: number | null
          parts_cost?: number | null
          priority?: string | null
          scheduled_date?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_odometer: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reading_km: number
          recorded_at: string
          source: string
          tenant_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reading_km: number
          recorded_at?: string
          source?: string
          tenant_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reading_km?: number
          recorded_at?: string
          source?: string
          tenant_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_odometer_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_odometer_vehicle_id_fkey"
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
          current_driver_id: string | null
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
          current_driver_id?: string | null
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
          current_driver_id?: string | null
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
            foreignKeyName: "vehicles_current_driver_id_fkey"
            columns: ["current_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
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
      clear_reimport_batch_data:
        | { Args: { _tenant_id: string }; Returns: Json }
        | {
            Args: {
              _end_date?: string
              _start_date?: string
              _tenant_id: string
            }
            Returns: Json
          }
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
      preview_reimport_cleanup_counts: {
        Args: { _end_date?: string; _start_date?: string; _tenant_id: string }
        Returns: Json
      }
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
      app_role: "owner" | "admin" | "operator" | "client" | "driver"
      waypoint_type:
        | "origin"
        | "destination"
        | "fueling"
        | "overnight"
        | "meal"
        | "client"
        | "checkpoint"
        | "other"
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
      app_role: ["owner", "admin", "operator", "client", "driver"],
      waypoint_type: [
        "origin",
        "destination",
        "fueling",
        "overnight",
        "meal",
        "client",
        "checkpoint",
        "other",
      ],
    },
  },
} as const
