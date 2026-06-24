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
      client_portal_access: {
        Row: {
          access_type: string
          active: boolean
          can_download_documents: boolean
          can_open_occurrences: boolean
          can_request_pickup: boolean
          can_view_driver_contact: boolean
          can_view_financial: boolean
          can_view_vehicle_live: boolean
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_type?: string
          active?: boolean
          can_download_documents?: boolean
          can_open_occurrences?: boolean
          can_request_pickup?: boolean
          can_view_driver_contact?: boolean
          can_view_financial?: boolean
          can_view_vehicle_live?: boolean
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_type?: string
          active?: boolean
          can_download_documents?: boolean
          can_open_occurrences?: boolean
          can_request_pickup?: boolean
          can_view_driver_contact?: boolean
          can_view_financial?: boolean
          can_view_vehicle_live?: boolean
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_access_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          accounting_code_client: string | null
          accounting_code_supplier: string | null
          active: boolean
          address_city: string | null
          address_city_ibge_code: string | null
          address_complement: string | null
          address_country_code: string | null
          address_country_name: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          addresses: Json | null
          billed: boolean | null
          blocked: boolean
          budget_group_client: string | null
          budget_group_supplier: string | null
          category: string | null
          cfop_client_type: string | null
          client_type: string | null
          company_name: string
          contact_name: string | null
          contacts: Json | null
          country_code: string | null
          country_name: string | null
          created_at: string
          created_by: string | null
          cubage_factor: number | null
          email: string | null
          fax: string | null
          freight_calc_type: string | null
          id: string
          ie_indicator: string | null
          internal_code: string | null
          legal_name: string | null
          mobile: string | null
          municipal_registration: string | null
          notes: string | null
          payer: string | null
          payer_group: string | null
          payment_notes: string | null
          person_type: string | null
          phone: string | null
          provider_person_id: string | null
          provider_person_integration_account_id: string | null
          provider_person_sync_status: string | null
          provider_person_synced_at: string | null
          service_notes: string | null
          sigla: string | null
          state_registration: string | null
          tax_code: string | null
          tax_description: string | null
          tax_id: string | null
          tax_regime: string | null
          taxes_enabled: boolean | null
          tenant_id: string
          trade_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accounting_code_client?: string | null
          accounting_code_supplier?: string | null
          active?: boolean
          address_city?: string | null
          address_city_ibge_code?: string | null
          address_complement?: string | null
          address_country_code?: string | null
          address_country_name?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          addresses?: Json | null
          billed?: boolean | null
          blocked?: boolean
          budget_group_client?: string | null
          budget_group_supplier?: string | null
          category?: string | null
          cfop_client_type?: string | null
          client_type?: string | null
          company_name: string
          contact_name?: string | null
          contacts?: Json | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          cubage_factor?: number | null
          email?: string | null
          fax?: string | null
          freight_calc_type?: string | null
          id?: string
          ie_indicator?: string | null
          internal_code?: string | null
          legal_name?: string | null
          mobile?: string | null
          municipal_registration?: string | null
          notes?: string | null
          payer?: string | null
          payer_group?: string | null
          payment_notes?: string | null
          person_type?: string | null
          phone?: string | null
          provider_person_id?: string | null
          provider_person_integration_account_id?: string | null
          provider_person_sync_status?: string | null
          provider_person_synced_at?: string | null
          service_notes?: string | null
          sigla?: string | null
          state_registration?: string | null
          tax_code?: string | null
          tax_description?: string | null
          tax_id?: string | null
          tax_regime?: string | null
          taxes_enabled?: boolean | null
          tenant_id: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accounting_code_client?: string | null
          accounting_code_supplier?: string | null
          active?: boolean
          address_city?: string | null
          address_city_ibge_code?: string | null
          address_complement?: string | null
          address_country_code?: string | null
          address_country_name?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          addresses?: Json | null
          billed?: boolean | null
          blocked?: boolean
          budget_group_client?: string | null
          budget_group_supplier?: string | null
          category?: string | null
          cfop_client_type?: string | null
          client_type?: string | null
          company_name?: string
          contact_name?: string | null
          contacts?: Json | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          cubage_factor?: number | null
          email?: string | null
          fax?: string | null
          freight_calc_type?: string | null
          id?: string
          ie_indicator?: string | null
          internal_code?: string | null
          legal_name?: string | null
          mobile?: string | null
          municipal_registration?: string | null
          notes?: string | null
          payer?: string | null
          payer_group?: string | null
          payment_notes?: string | null
          person_type?: string | null
          phone?: string | null
          provider_person_id?: string | null
          provider_person_integration_account_id?: string | null
          provider_person_sync_status?: string | null
          provider_person_synced_at?: string | null
          service_notes?: string | null
          sigla?: string | null
          state_registration?: string | null
          tax_code?: string | null
          tax_description?: string | null
          tax_id?: string | null
          tax_regime?: string | null
          taxes_enabled?: boolean | null
          tenant_id?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_provider_person_integration_account_id_fkey"
            columns: ["provider_person_integration_account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
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
      cte_batches: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          fiscal_document_ids: string[] | null
          grouping_mode: number
          grouping_mode_label: string | null
          id: string
          load_ids: string[] | null
          notes: string | null
          period_end: string | null
          period_start: string | null
          source_type: string
          status: string
          tenant_id: string
          total_documents: number
          total_freight: number
          total_value: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_ids?: string[] | null
          grouping_mode: number
          grouping_mode_label?: string | null
          id?: string
          load_ids?: string[] | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          source_type?: string
          status?: string
          tenant_id: string
          total_documents?: number
          total_freight?: number
          total_value?: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_ids?: string[] | null
          grouping_mode?: number
          grouping_mode_label?: string | null
          id?: string
          load_ids?: string[] | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
          total_documents?: number
          total_freight?: number
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cte_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      cte_documents: {
        Row: {
          access_key: string | null
          autonomous_freight: boolean
          batch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cargo_value: number
          cbs_base: number | null
          cbs_rate: number | null
          cbs_value: number | null
          cfop: string | null
          client_id: string | null
          company_branch: string | null
          company_group: string | null
          complementary_doc: boolean
          consignee: string | null
          contract_number: string | null
          correction_letter: boolean
          correction_letter_payload: Json | null
          created_at: string
          created_by: string | null
          cte_number: string | null
          cte_series: string | null
          cte_type: string
          driver_name: string | null
          fiscal_document_ids: string[] | null
          freight_value: number
          grouping_keys: Json | null
          ibs_base: number | null
          ibs_rate: number | null
          ibs_value: number | null
          id: string
          insurance_company: string | null
          internal_number: string | null
          invoice_count: number
          invoice_numbers: string | null
          is_closed: boolean
          is_compensated: boolean
          is_voided: boolean
          issued_at: string | null
          last_sefaz_event: Json | null
          load_ids: string[] | null
          net_value: number | null
          notes: string | null
          pallet_count: number
          payer_cnpj: string | null
          payer_group: string | null
          payer_name: string | null
          pdf_url: string | null
          processed_at: string | null
          protocol_number: string | null
          receivable_id: string | null
          recipient: string | null
          recipient_city: string | null
          recipient_state: string | null
          reference_number: string | null
          remitter: string | null
          romexp_number: string | null
          sefaz_environment: string | null
          sefaz_status: string
          sefaz_status_at: string | null
          sefaz_status_code: string | null
          sefaz_status_reason: string | null
          sefaz_user: string | null
          sent_at: string | null
          status: string
          tenant_id: string
          trailer_plate: string | null
          trip_number: string | null
          updated_at: string
          vehicle_plate: string | null
          weight_kg: number
          xml_content: string | null
          xml_url: string | null
        }
        Insert: {
          access_key?: string | null
          autonomous_freight?: boolean
          batch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cargo_value?: number
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          cfop?: string | null
          client_id?: string | null
          company_branch?: string | null
          company_group?: string | null
          complementary_doc?: boolean
          consignee?: string | null
          contract_number?: string | null
          correction_letter?: boolean
          correction_letter_payload?: Json | null
          created_at?: string
          created_by?: string | null
          cte_number?: string | null
          cte_series?: string | null
          cte_type?: string
          driver_name?: string | null
          fiscal_document_ids?: string[] | null
          freight_value?: number
          grouping_keys?: Json | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          insurance_company?: string | null
          internal_number?: string | null
          invoice_count?: number
          invoice_numbers?: string | null
          is_closed?: boolean
          is_compensated?: boolean
          is_voided?: boolean
          issued_at?: string | null
          last_sefaz_event?: Json | null
          load_ids?: string[] | null
          net_value?: number | null
          notes?: string | null
          pallet_count?: number
          payer_cnpj?: string | null
          payer_group?: string | null
          payer_name?: string | null
          pdf_url?: string | null
          processed_at?: string | null
          protocol_number?: string | null
          receivable_id?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_state?: string | null
          reference_number?: string | null
          remitter?: string | null
          romexp_number?: string | null
          sefaz_environment?: string | null
          sefaz_status?: string
          sefaz_status_at?: string | null
          sefaz_status_code?: string | null
          sefaz_status_reason?: string | null
          sefaz_user?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
          trailer_plate?: string | null
          trip_number?: string | null
          updated_at?: string
          vehicle_plate?: string | null
          weight_kg?: number
          xml_content?: string | null
          xml_url?: string | null
        }
        Update: {
          access_key?: string | null
          autonomous_freight?: boolean
          batch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cargo_value?: number
          cbs_base?: number | null
          cbs_rate?: number | null
          cbs_value?: number | null
          cfop?: string | null
          client_id?: string | null
          company_branch?: string | null
          company_group?: string | null
          complementary_doc?: boolean
          consignee?: string | null
          contract_number?: string | null
          correction_letter?: boolean
          correction_letter_payload?: Json | null
          created_at?: string
          created_by?: string | null
          cte_number?: string | null
          cte_series?: string | null
          cte_type?: string
          driver_name?: string | null
          fiscal_document_ids?: string[] | null
          freight_value?: number
          grouping_keys?: Json | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          insurance_company?: string | null
          internal_number?: string | null
          invoice_count?: number
          invoice_numbers?: string | null
          is_closed?: boolean
          is_compensated?: boolean
          is_voided?: boolean
          issued_at?: string | null
          last_sefaz_event?: Json | null
          load_ids?: string[] | null
          net_value?: number | null
          notes?: string | null
          pallet_count?: number
          payer_cnpj?: string | null
          payer_group?: string | null
          payer_name?: string | null
          pdf_url?: string | null
          processed_at?: string | null
          protocol_number?: string | null
          receivable_id?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_state?: string | null
          reference_number?: string | null
          remitter?: string | null
          romexp_number?: string | null
          sefaz_environment?: string | null
          sefaz_status?: string
          sefaz_status_at?: string | null
          sefaz_status_code?: string | null
          sefaz_status_reason?: string | null
          sefaz_user?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
          trailer_plate?: string | null
          trip_number?: string | null
          updated_at?: string
          vehicle_plate?: string | null
          weight_kg?: number
          xml_content?: string | null
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cte_documents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "cte_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cte_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      cte_sefaz_events: {
        Row: {
          created_at: string
          cte_document_id: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json | null
          protocol_number: string | null
          reason: string | null
          source: string | null
          status: string | null
          status_code: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          cte_document_id: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          protocol_number?: string | null
          reason?: string | null
          source?: string | null
          status?: string | null
          status_code?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          cte_document_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          protocol_number?: string | null
          reason?: string | null
          source?: string | null
          status?: string | null
          status_code?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cte_sefaz_events_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_delivery_windows: {
        Row: {
          active: boolean | null
          client_id: string
          created_at: string | null
          end_time: string
          id: string
          notes: string | null
          start_time: string
          tenant_id: string
          updated_at: string | null
          weekday: number
        }
        Insert: {
          active?: boolean | null
          client_id: string
          created_at?: string | null
          end_time: string
          id?: string
          notes?: string | null
          start_time: string
          tenant_id: string
          updated_at?: string | null
          weekday: number
        }
        Update: {
          active?: boolean | null
          client_id?: string
          created_at?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          start_time?: string
          tenant_id?: string
          updated_at?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_delivery_windows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_delivery_windows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      dispatch_stop_documents: {
        Row: {
          created_at: string
          dispatch_stop_id: string
          fiscal_document_id: string
          id: string
          load_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dispatch_stop_id: string
          fiscal_document_id: string
          id?: string
          load_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          dispatch_stop_id?: string
          fiscal_document_id?: string
          id?: string
          load_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_stop_documents_dispatch_stop_id_fkey"
            columns: ["dispatch_stop_id"]
            isOneToOne: false
            referencedRelation: "dispatch_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_stop_documents_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_stop_documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_stop_documents_tenant_id_fkey"
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
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination: string | null
          dispatch_trip_id: string
          estimated_departure_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          planned_arrival_at: string | null
          risk_level: string | null
          risk_reason: string | null
          service_time_minutes: number | null
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
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination?: string | null
          dispatch_trip_id: string
          estimated_departure_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planned_arrival_at?: string | null
          risk_level?: string | null
          risk_reason?: string | null
          service_time_minutes?: number | null
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
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination?: string | null
          dispatch_trip_id?: string
          estimated_departure_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planned_arrival_at?: string | null
          risk_level?: string | null
          risk_reason?: string | null
          service_time_minutes?: number | null
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
      dispatch_trip_loads: {
        Row: {
          created_at: string
          dispatch_trip_id: string
          id: string
          load_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dispatch_trip_id: string
          id?: string
          load_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          dispatch_trip_id?: string
          id?: string
          load_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_trip_loads_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_trip_loads_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_trip_loads_tenant_id_fkey"
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
      driver_direct_messages: {
        Row: {
          attachment_url: string | null
          created_at: string
          driver_id: string
          id: string
          message: string
          sender_id: string | null
          sender_name: string | null
          sender_role: string
          tenant_id: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          driver_id: string
          id?: string
          message: string
          sender_id?: string | null
          sender_name?: string | null
          sender_role?: string
          tenant_id: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          message?: string
          sender_id?: string | null
          sender_name?: string | null
          sender_role?: string
          tenant_id?: string
        }
        Relationships: []
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
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          birth_date: string | null
          blocked: boolean | null
          card_number: string | null
          cnh_category: string | null
          cnh_expiry: string | null
          cnh_issued_at: string | null
          cnh_number: string | null
          cnh_security_code: string | null
          cnh_uf: string | null
          commissioned: boolean | null
          contact: string | null
          coop_number: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          ctps: string | null
          ctps_series: string | null
          current_vehicle_id: string | null
          distinguishing_marks: string | null
          doc: string | null
          driver_kind_code: string | null
          driver_type: string
          education: string | null
          email: string | null
          emit_contract: boolean | null
          eye_color: string | null
          father_name: string | null
          first_license_date: string | null
          fleet_type: string | null
          hair_color: string | null
          height_m: number | null
          id: string
          inps: string | null
          insc: string | null
          inss: string | null
          marital_status: string | null
          mechanic: boolean | null
          mobile: string | null
          mope_expiry: string | null
          mother_name: string | null
          nacionalidade: string | null
          name: string
          naturalidade: string | null
          naturalidade_uf: string | null
          notes: string | null
          pamcary_expiry: string | null
          pamcary_number: string | null
          phone: string | null
          phone_secondary: string | null
          pis: string | null
          prev_address_city: string | null
          prev_address_complement: string | null
          prev_address_neighborhood: string | null
          prev_address_number: string | null
          prev_address_state: string | null
          prev_address_street: string | null
          prev_address_zip: string | null
          prev_residence_duration: string | null
          prev_residence_type: string | null
          provider_person_id: string | null
          provider_person_sync_status: string | null
          registration_date: string | null
          renach: string | null
          residence_since: string | null
          residence_type: string | null
          rg: string | null
          rg_issuer: string | null
          rg_uf: string | null
          romaneio_monitor_responsible: boolean | null
          served_region: string | null
          sex: string | null
          sigla: string | null
          skin_color: string | null
          spouse_name: string | null
          supplier: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
          weight_kg: number | null
        }
        Insert: {
          active?: boolean
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          birth_date?: string | null
          blocked?: boolean | null
          card_number?: string | null
          cnh_category?: string | null
          cnh_expiry?: string | null
          cnh_issued_at?: string | null
          cnh_number?: string | null
          cnh_security_code?: string | null
          cnh_uf?: string | null
          commissioned?: boolean | null
          contact?: string | null
          coop_number?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          ctps?: string | null
          ctps_series?: string | null
          current_vehicle_id?: string | null
          distinguishing_marks?: string | null
          doc?: string | null
          driver_kind_code?: string | null
          driver_type?: string
          education?: string | null
          email?: string | null
          emit_contract?: boolean | null
          eye_color?: string | null
          father_name?: string | null
          first_license_date?: string | null
          fleet_type?: string | null
          hair_color?: string | null
          height_m?: number | null
          id?: string
          inps?: string | null
          insc?: string | null
          inss?: string | null
          marital_status?: string | null
          mechanic?: boolean | null
          mobile?: string | null
          mope_expiry?: string | null
          mother_name?: string | null
          nacionalidade?: string | null
          name: string
          naturalidade?: string | null
          naturalidade_uf?: string | null
          notes?: string | null
          pamcary_expiry?: string | null
          pamcary_number?: string | null
          phone?: string | null
          phone_secondary?: string | null
          pis?: string | null
          prev_address_city?: string | null
          prev_address_complement?: string | null
          prev_address_neighborhood?: string | null
          prev_address_number?: string | null
          prev_address_state?: string | null
          prev_address_street?: string | null
          prev_address_zip?: string | null
          prev_residence_duration?: string | null
          prev_residence_type?: string | null
          provider_person_id?: string | null
          provider_person_sync_status?: string | null
          registration_date?: string | null
          renach?: string | null
          residence_since?: string | null
          residence_type?: string | null
          rg?: string | null
          rg_issuer?: string | null
          rg_uf?: string | null
          romaneio_monitor_responsible?: boolean | null
          served_region?: string | null
          sex?: string | null
          sigla?: string | null
          skin_color?: string | null
          spouse_name?: string | null
          supplier?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          active?: boolean
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          birth_date?: string | null
          blocked?: boolean | null
          card_number?: string | null
          cnh_category?: string | null
          cnh_expiry?: string | null
          cnh_issued_at?: string | null
          cnh_number?: string | null
          cnh_security_code?: string | null
          cnh_uf?: string | null
          commissioned?: boolean | null
          contact?: string | null
          coop_number?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          ctps?: string | null
          ctps_series?: string | null
          current_vehicle_id?: string | null
          distinguishing_marks?: string | null
          doc?: string | null
          driver_kind_code?: string | null
          driver_type?: string
          education?: string | null
          email?: string | null
          emit_contract?: boolean | null
          eye_color?: string | null
          father_name?: string | null
          first_license_date?: string | null
          fleet_type?: string | null
          hair_color?: string | null
          height_m?: number | null
          id?: string
          inps?: string | null
          insc?: string | null
          inss?: string | null
          marital_status?: string | null
          mechanic?: boolean | null
          mobile?: string | null
          mope_expiry?: string | null
          mother_name?: string | null
          nacionalidade?: string | null
          name?: string
          naturalidade?: string | null
          naturalidade_uf?: string | null
          notes?: string | null
          pamcary_expiry?: string | null
          pamcary_number?: string | null
          phone?: string | null
          phone_secondary?: string | null
          pis?: string | null
          prev_address_city?: string | null
          prev_address_complement?: string | null
          prev_address_neighborhood?: string | null
          prev_address_number?: string | null
          prev_address_state?: string | null
          prev_address_street?: string | null
          prev_address_zip?: string | null
          prev_residence_duration?: string | null
          prev_residence_type?: string | null
          provider_person_id?: string | null
          provider_person_sync_status?: string | null
          registration_date?: string | null
          renach?: string | null
          residence_since?: string | null
          residence_type?: string | null
          rg?: string | null
          rg_issuer?: string | null
          rg_uf?: string | null
          romaneio_monitor_responsible?: boolean | null
          served_region?: string | null
          sex?: string | null
          sigla?: string | null
          skin_color?: string | null
          spouse_name?: string | null
          supplier?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          weight_kg?: number | null
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
      entity_audit_log: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_data: Json | null
          old_data: Json | null
          request_id: string | null
          source: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          request_id?: string | null
          source?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          request_id?: string | null
          source?: string | null
          tenant_id?: string
        }
        Relationships: []
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
          client_load_number: string | null
          client_load_source: Json | null
          created_at: string
          created_by: string | null
          delivery_meta: Json
          document_type: string
          freight_breakdown: Json | null
          freight_confirmed_at: string | null
          freight_confirmed_by: string | null
          freight_overridden: boolean
          freight_overridden_at: string | null
          freight_overridden_by: string | null
          freight_override_reason: string | null
          freight_table_id: string | null
          freight_value: number | null
          freight_value_original: number | null
          ibs_base: number | null
          ibs_rate: number | null
          ibs_value: number | null
          id: string
          invoice_number: string | null
          issue_date: string | null
          load_id: string | null
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          order_id: string | null
          pallet_count: number | null
          pickup_order_id: string | null
          product_summary: string | null
          recipient: string | null
          recipient_city: string | null
          recipient_cnpj: string | null
          recipient_neighborhood: string | null
          recipient_state: string | null
          reference_number: string | null
          remitter: string | null
          remitter_cnpj: string | null
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
          client_load_number?: string | null
          client_load_source?: Json | null
          created_at?: string
          created_by?: string | null
          delivery_meta?: Json
          document_type?: string
          freight_breakdown?: Json | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_overridden?: boolean
          freight_overridden_at?: string | null
          freight_overridden_by?: string | null
          freight_override_reason?: string | null
          freight_table_id?: string | null
          freight_value?: number | null
          freight_value_original?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          order_id?: string | null
          pallet_count?: number | null
          pickup_order_id?: string | null
          product_summary?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_cnpj?: string | null
          recipient_neighborhood?: string | null
          recipient_state?: string | null
          reference_number?: string | null
          remitter?: string | null
          remitter_cnpj?: string | null
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
          client_load_number?: string | null
          client_load_source?: Json | null
          created_at?: string
          created_by?: string | null
          delivery_meta?: Json
          document_type?: string
          freight_breakdown?: Json | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_overridden?: boolean
          freight_overridden_at?: string | null
          freight_overridden_by?: string | null
          freight_override_reason?: string | null
          freight_table_id?: string | null
          freight_value?: number | null
          freight_value_original?: number | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          load_id?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          order_id?: string | null
          pallet_count?: number | null
          pickup_order_id?: string | null
          product_summary?: string | null
          recipient?: string | null
          recipient_city?: string | null
          recipient_cnpj?: string | null
          recipient_neighborhood?: string | null
          recipient_state?: string | null
          reference_number?: string | null
          remitter?: string | null
          remitter_cnpj?: string | null
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
            foreignKeyName: "fiscal_documents_pickup_order_id_fkey"
            columns: ["pickup_order_id"]
            isOneToOne: false
            referencedRelation: "pickup_orders"
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
      freight_auto_rules: {
        Row: {
          active: boolean
          calculation_basis: string
          cargo_type: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          fixed_value: number | null
          id: string
          min_value: number | null
          notes: string | null
          pallet_max: number | null
          pallet_min: number | null
          payer_group: string | null
          percent_value: number | null
          priority: number
          region_id: string | null
          region_name: string | null
          tenant_id: string
          unit_value: number | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          vehicle_type: string | null
          weight_max: number | null
          weight_min: number | null
        }
        Insert: {
          active?: boolean
          calculation_basis?: string
          cargo_type?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fixed_value?: number | null
          id?: string
          min_value?: number | null
          notes?: string | null
          pallet_max?: number | null
          pallet_min?: number | null
          payer_group?: string | null
          percent_value?: number | null
          priority?: number
          region_id?: string | null
          region_name?: string | null
          tenant_id: string
          unit_value?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          vehicle_type?: string | null
          weight_max?: number | null
          weight_min?: number | null
        }
        Update: {
          active?: boolean
          calculation_basis?: string
          cargo_type?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          fixed_value?: number | null
          id?: string
          min_value?: number | null
          notes?: string | null
          pallet_max?: number | null
          pallet_min?: number | null
          payer_group?: string | null
          percent_value?: number | null
          priority?: number
          region_id?: string | null
          region_name?: string | null
          tenant_id?: string
          unit_value?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          vehicle_type?: string | null
          weight_max?: number | null
          weight_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "freight_auto_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_auto_rules_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "client_regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freight_auto_rules_tenant_id_fkey"
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
      freight_override_log: {
        Row: {
          changed_by: string | null
          created_at: string
          fiscal_document_id: string
          freight_breakdown_snapshot: Json | null
          id: string
          new_value: number
          previous_value: number | null
          reason: string
          tenant_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          fiscal_document_id: string
          freight_breakdown_snapshot?: Json | null
          id?: string
          new_value: number
          previous_value?: number | null
          reason: string
          tenant_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          fiscal_document_id?: string
          freight_breakdown_snapshot?: Json | null
          id?: string
          new_value?: number
          previous_value?: number | null
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "freight_override_log_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      freight_tables: {
        Row: {
          blocked: boolean
          body_type: string | null
          cargo_type: string | null
          client_id: string | null
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
          client_id?: string | null
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
          client_id?: string | null
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
            foreignKeyName: "freight_tables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
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
      hub_fiscal_emissions: {
        Row: {
          access_key: string | null
          authorization_protocol: string | null
          c_stat: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          cte_document_id: string | null
          doc_type: string
          emitter_cnpj: string | null
          environment: string
          external_id: string | null
          fiscal_document_id: string | null
          hub_document_id: string | null
          id: string
          id_integracao: string | null
          last_callback: Json | null
          last_response: Json | null
          last_synced_at: string | null
          message: string | null
          nfse_document_id: string | null
          number: string | null
          pdf_url: string | null
          plugnotas_id: string | null
          plugnotas_status: string | null
          request_payload: Json | null
          series: string | null
          status: string
          sync_attempts: number
          tenant_id: string
          updated_at: string
          xml_url: string | null
        }
        Insert: {
          access_key?: string | null
          authorization_protocol?: string | null
          c_stat?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          doc_type: string
          emitter_cnpj?: string | null
          environment?: string
          external_id?: string | null
          fiscal_document_id?: string | null
          hub_document_id?: string | null
          id?: string
          id_integracao?: string | null
          last_callback?: Json | null
          last_response?: Json | null
          last_synced_at?: string | null
          message?: string | null
          nfse_document_id?: string | null
          number?: string | null
          pdf_url?: string | null
          plugnotas_id?: string | null
          plugnotas_status?: string | null
          request_payload?: Json | null
          series?: string | null
          status?: string
          sync_attempts?: number
          tenant_id: string
          updated_at?: string
          xml_url?: string | null
        }
        Update: {
          access_key?: string | null
          authorization_protocol?: string | null
          c_stat?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          doc_type?: string
          emitter_cnpj?: string | null
          environment?: string
          external_id?: string | null
          fiscal_document_id?: string | null
          hub_document_id?: string | null
          id?: string
          id_integracao?: string | null
          last_callback?: Json | null
          last_response?: Json | null
          last_synced_at?: string | null
          message?: string | null
          nfse_document_id?: string | null
          number?: string | null
          pdf_url?: string | null
          plugnotas_id?: string | null
          plugnotas_status?: string | null
          request_payload?: Json | null
          series?: string | null
          status?: string
          sync_attempts?: number
          tenant_id?: string
          updated_at?: string
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_fiscal_emissions_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_fiscal_emissions_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_fiscal_emissions_nfse_document_id_fkey"
            columns: ["nfse_document_id"]
            isOneToOne: false
            referencedRelation: "nfse_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_fiscal_emissions_tenant_id_fkey"
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
      ingestion_reports: {
        Row: {
          batch_id: string
          clients_auto_created: number
          clients_matched: number
          clients_unresolved: number
          created_at: string
          created_by: string | null
          error_docs: number
          field_coverage: Json
          id: string
          needs_review_docs: number
          report: Json
          review_items: Json
          saved_docs: number
          source_label: string | null
          tenant_id: string
          total_docs: number
        }
        Insert: {
          batch_id: string
          clients_auto_created?: number
          clients_matched?: number
          clients_unresolved?: number
          created_at?: string
          created_by?: string | null
          error_docs?: number
          field_coverage?: Json
          id?: string
          needs_review_docs?: number
          report?: Json
          review_items?: Json
          saved_docs?: number
          source_label?: string | null
          tenant_id: string
          total_docs?: number
        }
        Update: {
          batch_id?: string
          clients_auto_created?: number
          clients_matched?: number
          clients_unresolved?: number
          created_at?: string
          created_by?: string | null
          error_docs?: number
          field_coverage?: Json
          id?: string
          needs_review_docs?: number
          report?: Json
          review_items?: Json
          saved_docs?: number
          source_label?: string | null
          tenant_id?: string
          total_docs?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_reports_tenant_id_fkey"
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
      load_manifests: {
        Row: {
          created_at: string
          created_by: string | null
          cte_document_ids: string[]
          destination: string | null
          fiscal_document_ids: string[]
          id: string
          load_id: string
          manifest_number: string
          observations: string | null
          origin: string | null
          receipt_number: string | null
          responsible_address: string | null
          responsible_city: string | null
          responsible_cnpj: string | null
          responsible_ie: string | null
          responsible_name: string | null
          responsible_neighborhood: string | null
          status: string
          tenant_id: string
          toll_value: number | null
          uf_route: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cte_document_ids?: string[]
          destination?: string | null
          fiscal_document_ids?: string[]
          id?: string
          load_id: string
          manifest_number: string
          observations?: string | null
          origin?: string | null
          receipt_number?: string | null
          responsible_address?: string | null
          responsible_city?: string | null
          responsible_cnpj?: string | null
          responsible_ie?: string | null
          responsible_name?: string | null
          responsible_neighborhood?: string | null
          status?: string
          tenant_id: string
          toll_value?: number | null
          uf_route?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cte_document_ids?: string[]
          destination?: string | null
          fiscal_document_ids?: string[]
          id?: string
          load_id?: string
          manifest_number?: string
          observations?: string | null
          origin?: string | null
          receipt_number?: string | null
          responsible_address?: string | null
          responsible_city?: string | null
          responsible_cnpj?: string | null
          responsible_ie?: string | null
          responsible_name?: string | null
          responsible_neighborhood?: string | null
          status?: string
          tenant_id?: string
          toll_value?: number | null
          uf_route?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      load_note_audit_events: {
        Row: {
          action_type: string
          client_name: string | null
          created_at: string
          created_by: string | null
          details: Json
          fiscal_document_id: string | null
          id: string
          invoice_number: string | null
          load_id: string
          neighborhood: string | null
          previous_load_id: string | null
          route_destination: string | null
          supplier_name: string | null
          tenant_id: string
        }
        Insert: {
          action_type?: string
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          load_id: string
          neighborhood?: string | null
          previous_load_id?: string | null
          route_destination?: string | null
          supplier_name?: string | null
          tenant_id: string
        }
        Update: {
          action_type?: string
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          load_id?: string
          neighborhood?: string | null
          previous_load_id?: string | null
          route_destination?: string | null
          supplier_name?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_note_audit_events_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_note_audit_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_note_audit_events_previous_load_id_fkey"
            columns: ["previous_load_id"]
            isOneToOne: false
            referencedRelation: "loads"
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
          actual_load_at: string | null
          arrival_at: string | null
          cash_to_receive: number
          ciot: string | null
          created_at: string
          created_by: string | null
          dedicated_vehicle: boolean
          destination: string | null
          distribution_manifest: string | null
          driver_id: string | null
          driver_type: string | null
          estimated_arrival_at: string | null
          gate_departure_at: string | null
          id: string
          load_number: string
          merchandise_value: number | null
          monitor_responsible: string | null
          monitored: boolean
          notes: string | null
          occurrence_at: string | null
          occurrence_notes: string | null
          occurrence_responsible: string | null
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          origin: string | null
          origin_manifest: string | null
          os_number: string | null
          payment_method: string | null
          pix_to_receive: number
          schedule_at: string | null
          scheduled_load_at: string | null
          shipment_manifest: string | null
          sm_manager: string | null
          sm_release: string | null
          status: string
          supplier_manifest: string | null
          tenant_id: string
          total_pallet_count: number | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          trailer_plate: string | null
          trip_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_load_at?: string | null
          arrival_at?: string | null
          cash_to_receive?: number
          ciot?: string | null
          created_at?: string
          created_by?: string | null
          dedicated_vehicle?: boolean
          destination?: string | null
          distribution_manifest?: string | null
          driver_id?: string | null
          driver_type?: string | null
          estimated_arrival_at?: string | null
          gate_departure_at?: string | null
          id?: string
          load_number: string
          merchandise_value?: number | null
          monitor_responsible?: string | null
          monitored?: boolean
          notes?: string | null
          occurrence_at?: string | null
          occurrence_notes?: string | null
          occurrence_responsible?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          origin?: string | null
          origin_manifest?: string | null
          os_number?: string | null
          payment_method?: string | null
          pix_to_receive?: number
          schedule_at?: string | null
          scheduled_load_at?: string | null
          shipment_manifest?: string | null
          sm_manager?: string | null
          sm_release?: string | null
          status?: string
          supplier_manifest?: string | null
          tenant_id: string
          total_pallet_count?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          trailer_plate?: string | null
          trip_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_load_at?: string | null
          arrival_at?: string | null
          cash_to_receive?: number
          ciot?: string | null
          created_at?: string
          created_by?: string | null
          dedicated_vehicle?: boolean
          destination?: string | null
          distribution_manifest?: string | null
          driver_id?: string | null
          driver_type?: string | null
          estimated_arrival_at?: string | null
          gate_departure_at?: string | null
          id?: string
          load_number?: string
          merchandise_value?: number | null
          monitor_responsible?: string | null
          monitored?: boolean
          notes?: string | null
          occurrence_at?: string | null
          occurrence_notes?: string | null
          occurrence_responsible?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          origin?: string | null
          origin_manifest?: string | null
          os_number?: string | null
          payment_method?: string | null
          pix_to_receive?: number
          schedule_at?: string | null
          scheduled_load_at?: string | null
          shipment_manifest?: string | null
          sm_manager?: string | null
          sm_release?: string | null
          status?: string
          supplier_manifest?: string | null
          tenant_id?: string
          total_pallet_count?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          trailer_plate?: string | null
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
            referencedRelation: "dispatch_trips"
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
      nfse_documents: {
        Row: {
          aliquota_iss: number
          authorization_date: string | null
          base_calculo: number
          branch_code: string
          cancellation_date: string | null
          cancellation_reason: string | null
          cancelled: boolean
          classe: string | null
          cliente_bairro: string | null
          cliente_cep: string | null
          cliente_cnpj: string | null
          cliente_email: string | null
          cliente_endereco: string | null
          cliente_id: string | null
          cliente_ie: string | null
          cliente_municipio: string | null
          cliente_nome: string | null
          cliente_uf: string | null
          cnae: string | null
          cod_municipio_prestacao: string | null
          cod_servico: string | null
          cod_trib_municipal: string | null
          comissao_para: string | null
          cond_pagamento: string | null
          created_at: string
          created_by: string | null
          ctrc_complemento: string | null
          description: string | null
          doc_substituido: string | null
          doc_type: string
          fiscal_document_ids: string[] | null
          id: string
          internal_number: string | null
          invoice_number: string | null
          is_preview: boolean
          iss_retido: boolean
          issue_date: string
          items: Json
          load_id: string | null
          nat_operacao: string | null
          nfse_number: string | null
          notes: string | null
          outras_retencoes: number
          pagador_bairro: string | null
          pagador_cnpj: string | null
          pagador_endereco: string | null
          pagador_ie: string | null
          pagador_municipio: string | null
          pagador_nome: string | null
          pagador_uf: string | null
          pdf_url: string | null
          pedido: string | null
          prestador_cnpj: string | null
          prestador_inscricao_municipal: string | null
          prestador_municipio: string | null
          protocol_number: string | null
          provider: string | null
          provider_request_id: string | null
          quantity: number | null
          raw_response: Json | null
          reference_number: string | null
          rejection_messages: Json | null
          related_cte_ids: string[] | null
          rps_number: string | null
          series: string | null
          situacao_doc: string | null
          status: string
          tenant_id: string
          tipo_ctrc: string | null
          trip_id: string | null
          updated_at: string
          valor_cofins: number
          valor_csll: number
          valor_deducoes: number
          valor_inss: number
          valor_ir: number
          valor_iss: number
          valor_liquido: number
          valor_pis: number
          valor_servicos: number
          valor_total: number
          verification_code: string | null
          xml_url: string | null
        }
        Insert: {
          aliquota_iss?: number
          authorization_date?: string | null
          base_calculo?: number
          branch_code?: string
          cancellation_date?: string | null
          cancellation_reason?: string | null
          cancelled?: boolean
          classe?: string | null
          cliente_bairro?: string | null
          cliente_cep?: string | null
          cliente_cnpj?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: string | null
          cliente_ie?: string | null
          cliente_municipio?: string | null
          cliente_nome?: string | null
          cliente_uf?: string | null
          cnae?: string | null
          cod_municipio_prestacao?: string | null
          cod_servico?: string | null
          cod_trib_municipal?: string | null
          comissao_para?: string | null
          cond_pagamento?: string | null
          created_at?: string
          created_by?: string | null
          ctrc_complemento?: string | null
          description?: string | null
          doc_substituido?: string | null
          doc_type?: string
          fiscal_document_ids?: string[] | null
          id?: string
          internal_number?: string | null
          invoice_number?: string | null
          is_preview?: boolean
          iss_retido?: boolean
          issue_date?: string
          items?: Json
          load_id?: string | null
          nat_operacao?: string | null
          nfse_number?: string | null
          notes?: string | null
          outras_retencoes?: number
          pagador_bairro?: string | null
          pagador_cnpj?: string | null
          pagador_endereco?: string | null
          pagador_ie?: string | null
          pagador_municipio?: string | null
          pagador_nome?: string | null
          pagador_uf?: string | null
          pdf_url?: string | null
          pedido?: string | null
          prestador_cnpj?: string | null
          prestador_inscricao_municipal?: string | null
          prestador_municipio?: string | null
          protocol_number?: string | null
          provider?: string | null
          provider_request_id?: string | null
          quantity?: number | null
          raw_response?: Json | null
          reference_number?: string | null
          rejection_messages?: Json | null
          related_cte_ids?: string[] | null
          rps_number?: string | null
          series?: string | null
          situacao_doc?: string | null
          status?: string
          tenant_id: string
          tipo_ctrc?: string | null
          trip_id?: string | null
          updated_at?: string
          valor_cofins?: number
          valor_csll?: number
          valor_deducoes?: number
          valor_inss?: number
          valor_ir?: number
          valor_iss?: number
          valor_liquido?: number
          valor_pis?: number
          valor_servicos?: number
          valor_total?: number
          verification_code?: string | null
          xml_url?: string | null
        }
        Update: {
          aliquota_iss?: number
          authorization_date?: string | null
          base_calculo?: number
          branch_code?: string
          cancellation_date?: string | null
          cancellation_reason?: string | null
          cancelled?: boolean
          classe?: string | null
          cliente_bairro?: string | null
          cliente_cep?: string | null
          cliente_cnpj?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: string | null
          cliente_ie?: string | null
          cliente_municipio?: string | null
          cliente_nome?: string | null
          cliente_uf?: string | null
          cnae?: string | null
          cod_municipio_prestacao?: string | null
          cod_servico?: string | null
          cod_trib_municipal?: string | null
          comissao_para?: string | null
          cond_pagamento?: string | null
          created_at?: string
          created_by?: string | null
          ctrc_complemento?: string | null
          description?: string | null
          doc_substituido?: string | null
          doc_type?: string
          fiscal_document_ids?: string[] | null
          id?: string
          internal_number?: string | null
          invoice_number?: string | null
          is_preview?: boolean
          iss_retido?: boolean
          issue_date?: string
          items?: Json
          load_id?: string | null
          nat_operacao?: string | null
          nfse_number?: string | null
          notes?: string | null
          outras_retencoes?: number
          pagador_bairro?: string | null
          pagador_cnpj?: string | null
          pagador_endereco?: string | null
          pagador_ie?: string | null
          pagador_municipio?: string | null
          pagador_nome?: string | null
          pagador_uf?: string | null
          pdf_url?: string | null
          pedido?: string | null
          prestador_cnpj?: string | null
          prestador_inscricao_municipal?: string | null
          prestador_municipio?: string | null
          protocol_number?: string | null
          provider?: string | null
          provider_request_id?: string | null
          quantity?: number | null
          raw_response?: Json | null
          reference_number?: string | null
          rejection_messages?: Json | null
          related_cte_ids?: string[] | null
          rps_number?: string | null
          series?: string | null
          situacao_doc?: string | null
          status?: string
          tenant_id?: string
          tipo_ctrc?: string | null
          trip_id?: string | null
          updated_at?: string
          valor_cofins?: number
          valor_csll?: number
          valor_deducoes?: number
          valor_inss?: number
          valor_ir?: number
          valor_iss?: number
          valor_liquido?: number
          valor_pis?: number
          valor_servicos?: number
          valor_total?: number
          verification_code?: string | null
          xml_url?: string | null
        }
        Relationships: []
      }
      nfse_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          message: string | null
          nfse_id: string
          payload: Json | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          message?: string | null
          nfse_id: string
          payload?: Json | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          message?: string | null
          nfse_id?: string
          payload?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfse_events_nfse_id_fkey"
            columns: ["nfse_id"]
            isOneToOne: false
            referencedRelation: "nfse_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      nfse_provider_configs: {
        Row: {
          branch_code: string
          city_code: string | null
          cnpj: string | null
          created_at: string
          credentials_encrypted: string | null
          credentials_iv: string | null
          enabled: boolean
          environment: string
          extra_settings: Json
          id: string
          inscricao_municipal: string | null
          provider: string
          regime_tributario: string | null
          rps_serie: string | null
          tenant_id: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          branch_code?: string
          city_code?: string | null
          cnpj?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_iv?: string | null
          enabled?: boolean
          environment?: string
          extra_settings?: Json
          id?: string
          inscricao_municipal?: string | null
          provider?: string
          regime_tributario?: string | null
          rps_serie?: string | null
          tenant_id: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          branch_code?: string
          city_code?: string | null
          cnpj?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_iv?: string | null
          enabled?: boolean
          environment?: string
          extra_settings?: Json
          id?: string
          inscricao_municipal?: string | null
          provider?: string
          regime_tributario?: string | null
          rps_serie?: string | null
          tenant_id?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      nfse_sequences: {
        Row: {
          branch_code: string
          created_at: string
          id: string
          next_number: number
          series: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_code?: string
          created_at?: string
          id?: string
          next_number?: number
          series?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_code?: string
          created_at?: string
          id?: string
          next_number?: number
          series?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
      operational_event_messages: {
        Row: {
          attachment_url: string | null
          created_at: string
          event_id: string
          id: string
          message: string
          sender_id: string | null
          sender_name: string | null
          sender_role: string
          tenant_id: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          event_id: string
          id?: string
          message: string
          sender_id?: string | null
          sender_name?: string | null
          sender_role?: string
          tenant_id: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          event_id?: string
          id?: string
          message?: string
          sender_id?: string | null
          sender_name?: string | null
          sender_role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_event_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "operational_events"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_events: {
        Row: {
          client_action_required: boolean
          client_id: string | null
          client_opened: boolean
          client_resolution_note: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dispatch_stop_id: string | null
          dispatch_trip_id: string | null
          driver_id: string | null
          event_type: string
          financial_impact: number | null
          fiscal_document_id: string | null
          id: string
          load_id: string | null
          order_id: string | null
          public_status: string | null
          report_details: Json | null
          resolution: string | null
          resolved_at: string | null
          severity: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
          visible_to_client: boolean
        }
        Insert: {
          client_action_required?: boolean
          client_id?: string | null
          client_opened?: boolean
          client_resolution_note?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          event_type: string
          financial_impact?: number | null
          fiscal_document_id?: string | null
          id?: string
          load_id?: string | null
          order_id?: string | null
          public_status?: string | null
          report_details?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
          visible_to_client?: boolean
        }
        Update: {
          client_action_required?: boolean
          client_id?: string | null
          client_opened?: boolean
          client_resolution_note?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id?: string | null
          driver_id?: string | null
          event_type?: string
          financial_impact?: number | null
          fiscal_document_id?: string | null
          id?: string
          load_id?: string | null
          order_id?: string | null
          public_status?: string | null
          report_details?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
          visible_to_client?: boolean
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
            foreignKeyName: "operational_events_dispatch_stop_id_fkey"
            columns: ["dispatch_stop_id"]
            isOneToOne: false
            referencedRelation: "dispatch_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_events_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
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
            foreignKeyName: "operational_events_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
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
      ort_extraction_audits: {
        Row: {
          changed_fields: string[]
          created_at: string
          created_by: string | null
          dedupe_key: string
          extracted_payload: Json
          field_confidences: Json
          fiscal_document_id: string | null
          id: string
          needs_review: boolean
          ort_number: string | null
          overall_confidence: number
          reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_payload: Json
          source_file_name: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          changed_fields?: string[]
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          extracted_payload?: Json
          field_confidences?: Json
          fiscal_document_id?: string | null
          id?: string
          needs_review?: boolean
          ort_number?: string | null
          overall_confidence?: number
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_payload?: Json
          source_file_name: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          changed_fields?: string[]
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          extracted_payload?: Json
          field_confidences?: Json
          fiscal_document_id?: string | null
          id?: string
          needs_review?: boolean
          ort_number?: string | null
          overall_confidence?: number
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_payload?: Json
          source_file_name?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ort_extraction_audits_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ort_extraction_audits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_orders: {
        Row: {
          created_at: string
          created_by: string | null
          driver_id: string | null
          driver_name_snapshot: string | null
          id: string
          manual_meta: Json | null
          notes: string | null
          pickup_at: string
          pickup_number: string
          recipient_name: string | null
          remitter_client_id: string | null
          remitter_cnpj: string | null
          remitter_name: string | null
          status: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
          vehicle_plate_snapshot: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          id?: string
          manual_meta?: Json | null
          notes?: string | null
          pickup_at?: string
          pickup_number: string
          recipient_name?: string | null
          remitter_client_id?: string | null
          remitter_cnpj?: string | null
          remitter_name?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          id?: string
          manual_meta?: Json | null
          notes?: string | null
          pickup_at?: string
          pickup_number?: string
          recipient_name?: string | null
          remitter_client_id?: string | null
          remitter_cnpj?: string | null
          remitter_name?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_orders_remitter_client_id_fkey"
            columns: ["remitter_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_orders_vehicle_id_fkey"
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
      proof_of_delivery: {
        Row: {
          created_at: string
          created_by: string | null
          dispatch_stop_id: string | null
          dispatch_trip_id: string | null
          fiscal_document_id: string
          id: string
          load_id: string | null
          metadata: Json
          proof_type: string
          received_at: string | null
          receiver_document: string | null
          receiver_name: string | null
          receiver_role: string | null
          rejection_reason: string | null
          status: string
          storage_bucket: string | null
          storage_path: string | null
          tenant_id: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id?: string | null
          fiscal_document_id: string
          id?: string
          load_id?: string | null
          metadata?: Json
          proof_type: string
          received_at?: string | null
          receiver_document?: string | null
          receiver_name?: string | null
          receiver_role?: string | null
          rejection_reason?: string | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          tenant_id: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dispatch_stop_id?: string | null
          dispatch_trip_id?: string | null
          fiscal_document_id?: string
          id?: string
          load_id?: string | null
          metadata?: Json
          proof_type?: string
          received_at?: string | null
          receiver_document?: string | null
          receiver_name?: string | null
          receiver_role?: string | null
          rejection_reason?: string | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          tenant_id?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_of_delivery_dispatch_stop_id_fkey"
            columns: ["dispatch_stop_id"]
            isOneToOne: false
            referencedRelation: "dispatch_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_of_delivery_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_of_delivery_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: true
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_of_delivery_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_of_delivery_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      reimport_batches: {
        Row: {
          cleanup_summary: Json
          created_by: string | null
          dedup_summary: Json
          error_count: number
          errors_summary: Json
          finished_at: string
          id: string
          ignored_count: number
          imported_count: number
          new_count: number
          period_end: string | null
          period_start: string | null
          started_at: string
          tenant_id: string
          total_files: number
          unchanged_count: number
          updated_count: number
        }
        Insert: {
          cleanup_summary?: Json
          created_by?: string | null
          dedup_summary?: Json
          error_count?: number
          errors_summary?: Json
          finished_at?: string
          id?: string
          ignored_count?: number
          imported_count?: number
          new_count?: number
          period_end?: string | null
          period_start?: string | null
          started_at?: string
          tenant_id: string
          total_files?: number
          unchanged_count?: number
          updated_count?: number
        }
        Update: {
          cleanup_summary?: Json
          created_by?: string | null
          dedup_summary?: Json
          error_count?: number
          errors_summary?: Json
          finished_at?: string
          id?: string
          ignored_count?: number
          imported_count?: number
          new_count?: number
          period_end?: string | null
          period_start?: string | null
          started_at?: string
          tenant_id?: string
          total_files?: number
          unchanged_count?: number
          updated_count?: number
        }
        Relationships: []
      }
      route_planning_drafts: {
        Row: {
          converted_load_id: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          load_ids: string[] | null
          name: string
          notes: string | null
          operational_route_id: string | null
          optimization_summary: Json | null
          order_ids: Json | null
          planned_date: string | null
          planned_start_at: string | null
          route_config: Json | null
          status: string
          tenant_id: string
          updated_at: string
          validation_summary: Json | null
          vehicle_id: string | null
        }
        Insert: {
          converted_load_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          load_ids?: string[] | null
          name: string
          notes?: string | null
          operational_route_id?: string | null
          optimization_summary?: Json | null
          order_ids?: Json | null
          planned_date?: string | null
          planned_start_at?: string | null
          route_config?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string
          validation_summary?: Json | null
          vehicle_id?: string | null
        }
        Update: {
          converted_load_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          load_ids?: string[] | null
          name?: string
          notes?: string | null
          operational_route_id?: string | null
          optimization_summary?: Json | null
          order_ids?: Json | null
          planned_date?: string | null
          planned_start_at?: string | null
          route_config?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string
          validation_summary?: Json | null
          vehicle_id?: string | null
        }
        Relationships: []
      }
      route_planning_stop_drafts: {
        Row: {
          city: string | null
          client_id: string | null
          created_at: string | null
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination: string | null
          estimated_departure_at: string | null
          fiscal_document_ids: string[]
          id: string
          invoice_numbers: string[]
          load_ids: string[]
          manual_order: number | null
          neighborhood: string | null
          notes: string | null
          optimized_order: number | null
          original_order: number | null
          planned_arrival_at: string | null
          planning_draft_id: string | null
          priority: number | null
          recipient_name: string | null
          risk_level: string | null
          risk_reason: string | null
          service_time_minutes: number | null
          state: string | null
          status: string | null
          tenant_id: string
          total_pallet_count: number | null
          total_value: number | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination?: string | null
          estimated_departure_at?: string | null
          fiscal_document_ids?: string[]
          id?: string
          invoice_numbers?: string[]
          load_ids?: string[]
          manual_order?: number | null
          neighborhood?: string | null
          notes?: string | null
          optimized_order?: number | null
          original_order?: number | null
          planned_arrival_at?: string | null
          planning_draft_id?: string | null
          priority?: number | null
          recipient_name?: string | null
          risk_level?: string | null
          risk_reason?: string | null
          service_time_minutes?: number | null
          state?: string | null
          status?: string | null
          tenant_id: string
          total_pallet_count?: number | null
          total_value?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination?: string | null
          estimated_departure_at?: string | null
          fiscal_document_ids?: string[]
          id?: string
          invoice_numbers?: string[]
          load_ids?: string[]
          manual_order?: number | null
          neighborhood?: string | null
          notes?: string | null
          optimized_order?: number | null
          original_order?: number | null
          planned_arrival_at?: string | null
          planning_draft_id?: string | null
          priority?: number | null
          recipient_name?: string | null
          risk_level?: string | null
          risk_reason?: string | null
          service_time_minutes?: number | null
          state?: string | null
          status?: string | null
          tenant_id?: string
          total_pallet_count?: number | null
          total_value?: number | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "route_planning_stop_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_planning_stop_drafts_planning_draft_id_fkey"
            columns: ["planning_draft_id"]
            isOneToOne: false
            referencedRelation: "route_planning_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_planning_stop_drafts_tenant_id_fkey"
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
      trip_alerts: {
        Row: {
          acknowledged_at: string | null
          closed_at: string | null
          id: string
          message: string | null
          metadata: Json | null
          opened_at: string
          severity: string
          status: string
          tenant_id: string
          title: string
          trip_id: string | null
          type: string
          vehicle_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          closed_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          opened_at?: string
          severity?: string
          status?: string
          tenant_id: string
          title: string
          trip_id?: string | null
          type: string
          vehicle_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          closed_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          opened_at?: string
          severity?: string
          status?: string
          tenant_id?: string
          title?: string
          trip_id?: string | null
          type?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_alerts_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_live_status: {
        Row: {
          average_speed_kmh: number | null
          current_stop_id: string | null
          delay_minutes: number | null
          distance_from_route_meters: number | null
          eta_next_stop_at: string | null
          last_signal_age_seconds: number | null
          last_signal_at: string | null
          message: string | null
          metadata: Json | null
          next_stop_id: string | null
          severity: string
          state: string
          stopped_minutes: number | null
          tenant_id: string
          trip_id: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          average_speed_kmh?: number | null
          current_stop_id?: string | null
          delay_minutes?: number | null
          distance_from_route_meters?: number | null
          eta_next_stop_at?: string | null
          last_signal_age_seconds?: number | null
          last_signal_at?: string | null
          message?: string | null
          metadata?: Json | null
          next_stop_id?: string | null
          severity?: string
          state?: string
          stopped_minutes?: number | null
          tenant_id: string
          trip_id: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          average_speed_kmh?: number | null
          current_stop_id?: string | null
          delay_minutes?: number | null
          distance_from_route_meters?: number | null
          eta_next_stop_at?: string | null
          last_signal_age_seconds?: number | null
          last_signal_at?: string | null
          message?: string | null
          metadata?: Json | null
          next_stop_id?: string | null
          severity?: string
          state?: string
          stopped_minutes?: number | null
          tenant_id?: string
          trip_id?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_live_status_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_routes: {
        Row: {
          calculated_at: string
          created_at: string
          destination_lat: number | null
          destination_lng: number | null
          distance_meters: number | null
          duration_seconds: number | null
          encoded_polyline: string | null
          geometry_geojson: Json
          id: string
          origin_lat: number | null
          origin_lng: number | null
          provider: string
          tenant_id: string
          trip_id: string
          updated_at: string
          waypoints: Json | null
        }
        Insert: {
          calculated_at?: string
          created_at?: string
          destination_lat?: number | null
          destination_lng?: number | null
          distance_meters?: number | null
          duration_seconds?: number | null
          encoded_polyline?: string | null
          geometry_geojson: Json
          id?: string
          origin_lat?: number | null
          origin_lng?: number | null
          provider?: string
          tenant_id: string
          trip_id: string
          updated_at?: string
          waypoints?: Json | null
        }
        Update: {
          calculated_at?: string
          created_at?: string
          destination_lat?: number | null
          destination_lng?: number | null
          distance_meters?: number | null
          duration_seconds?: number | null
          encoded_polyline?: string | null
          geometry_geojson?: Json
          id?: string
          origin_lat?: number | null
          origin_lng?: number | null
          provider?: string
          tenant_id?: string
          trip_id?: string
          updated_at?: string
          waypoints?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_routes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
        ]
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
      user_ui_preferences: {
        Row: {
          created_at: string
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preference_key: string
          preference_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          avg_km_per_liter: number | null
          axle_structure: string | null
          base_consumption_estimate: number | null
          blocked: boolean | null
          body_type: string | null
          body_type_code: string | null
          brand: string | null
          business_unit: string | null
          capacity_ton: number | null
          category: string | null
          chassis: string | null
          city: string | null
          color: string | null
          created_at: string
          created_by: string | null
          current_driver_id: string | null
          expected_speed_penalty_loaded: number | null
          fleet_type_code: string | null
          fuel_canonical_key: string | null
          id: string
          in_maintenance: boolean | null
          loaded_consumption_factor: number | null
          max_pallets: number | null
          max_volume_m3: number | null
          max_weight_kg: number | null
          model: string | null
          nickname: string | null
          odometer_km: number | null
          owner_mobile: string | null
          owner_name: string | null
          owner_neighborhood: string | null
          owner_notes: string | null
          owner_phone: string | null
          plate: string
          renavam: string | null
          result_area: string | null
          result_center: string | null
          situation_code: string | null
          speed_limit_kmh: number | null
          tags: Json | null
          tank_capacity_liters: number | null
          tenant_id: string
          tracker_login: string | null
          tracker_name: string | null
          tracker_password: string | null
          type: string | null
          uf: string | null
          updated_at: string
          updated_by: string | null
          vehicle_type_code: string | null
          year_of_manufacture: number | null
        }
        Insert: {
          active?: boolean
          avg_km_per_liter?: number | null
          axle_structure?: string | null
          base_consumption_estimate?: number | null
          blocked?: boolean | null
          body_type?: string | null
          body_type_code?: string | null
          brand?: string | null
          business_unit?: string | null
          capacity_ton?: number | null
          category?: string | null
          chassis?: string | null
          city?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          current_driver_id?: string | null
          expected_speed_penalty_loaded?: number | null
          fleet_type_code?: string | null
          fuel_canonical_key?: string | null
          id?: string
          in_maintenance?: boolean | null
          loaded_consumption_factor?: number | null
          max_pallets?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          model?: string | null
          nickname?: string | null
          odometer_km?: number | null
          owner_mobile?: string | null
          owner_name?: string | null
          owner_neighborhood?: string | null
          owner_notes?: string | null
          owner_phone?: string | null
          plate: string
          renavam?: string | null
          result_area?: string | null
          result_center?: string | null
          situation_code?: string | null
          speed_limit_kmh?: number | null
          tags?: Json | null
          tank_capacity_liters?: number | null
          tenant_id: string
          tracker_login?: string | null
          tracker_name?: string | null
          tracker_password?: string | null
          type?: string | null
          uf?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_type_code?: string | null
          year_of_manufacture?: number | null
        }
        Update: {
          active?: boolean
          avg_km_per_liter?: number | null
          axle_structure?: string | null
          base_consumption_estimate?: number | null
          blocked?: boolean | null
          body_type?: string | null
          body_type_code?: string | null
          brand?: string | null
          business_unit?: string | null
          capacity_ton?: number | null
          category?: string | null
          chassis?: string | null
          city?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          current_driver_id?: string | null
          expected_speed_penalty_loaded?: number | null
          fleet_type_code?: string | null
          fuel_canonical_key?: string | null
          id?: string
          in_maintenance?: boolean | null
          loaded_consumption_factor?: number | null
          max_pallets?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          model?: string | null
          nickname?: string | null
          odometer_km?: number | null
          owner_mobile?: string | null
          owner_name?: string | null
          owner_neighborhood?: string | null
          owner_notes?: string | null
          owner_phone?: string | null
          plate?: string
          renavam?: string | null
          result_area?: string | null
          result_center?: string | null
          situation_code?: string | null
          speed_limit_kmh?: number | null
          tags?: Json | null
          tank_capacity_liters?: number | null
          tenant_id?: string
          tracker_login?: string | null
          tracker_name?: string | null
          tracker_password?: string | null
          type?: string | null
          uf?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_type_code?: string | null
          year_of_manufacture?: number | null
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
      _assert_driver_owns_trip: {
        Args: { _trip_id: string }
        Returns: {
          driver_id: string
          status: string
          tenant_id: string
        }[]
      }
      _driver_client_ids: { Args: never; Returns: string[] }
      _driver_fiscal_document_ids: { Args: never; Returns: string[] }
      _driver_load_ids: { Args: never; Returns: string[] }
      _driver_order_ids: { Args: never; Returns: string[] }
      _driver_pickup_order_ids: { Args: never; Returns: string[] }
      _driver_trip_ids: { Args: never; Returns: string[] }
      _load_is_locked: { Args: { _load_id: string }; Returns: boolean }
      _log_entity_audit: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _new?: Json
          _old?: Json
          _source?: string
          _tenant_id: string
        }
        Returns: undefined
      }
      _portal_user_client_ids: {
        Args: { _tenant_id: string }
        Returns: string[]
      }
      _portal_user_has_perm: {
        Args: { _client_id: string; _perm: string; _tenant_id: string }
        Returns: boolean
      }
      assign_fiscal_documents_to_load: {
        Args: { _document_ids: string[]; _load_id: string; _tenant_id: string }
        Returns: Json
      }
      audit_data_consistency: {
        Args: { _tenant_id: string }
        Returns: {
          category: string
          entity_id: string
          entity_type: string
          message: string
          severity: string
        }[]
      }
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
      create_client_occurrence: {
        Args: {
          _client_id: string
          _description: string
          _event_type: string
          _load_id?: string
          _order_id?: string
          _severity?: string
          _tenant_id: string
        }
        Returns: string
      }
      create_load_with_next_number: {
        Args: {
          _destination?: string
          _driver_id?: string
          _notes?: string
          _origin?: string
          _tenant_id: string
          _trip_id?: string
          _vehicle_id?: string
        }
        Returns: {
          actual_load_at: string | null
          arrival_at: string | null
          cash_to_receive: number
          ciot: string | null
          created_at: string
          created_by: string | null
          dedicated_vehicle: boolean
          destination: string | null
          distribution_manifest: string | null
          driver_id: string | null
          driver_type: string | null
          estimated_arrival_at: string | null
          gate_departure_at: string | null
          id: string
          load_number: string
          merchandise_value: number | null
          monitor_responsible: string | null
          monitored: boolean
          notes: string | null
          occurrence_at: string | null
          occurrence_notes: string | null
          occurrence_responsible: string | null
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          origin: string | null
          origin_manifest: string | null
          os_number: string | null
          payment_method: string | null
          pix_to_receive: number
          schedule_at: string | null
          scheduled_load_at: string | null
          shipment_manifest: string | null
          sm_manager: string | null
          sm_release: string | null
          status: string
          supplier_manifest: string | null
          tenant_id: string
          total_pallet_count: number | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          trailer_plate: string | null
          trip_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "loads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_tenant_with_owner: {
        Args: { _tenant_name: string }
        Returns: string
      }
      current_driver_id: { Args: { _tenant_id: string }; Returns: string }
      delete_load_safely: {
        Args: { _load_id: string; _tenant_id: string }
        Returns: Json
      }
      delete_loads_safely: {
        Args: { _load_ids: string[]; _tenant_id: string }
        Returns: Json
      }
      detect_payment_method: { Args: { p_text: string }; Returns: string }
      dispatch_planned_route: { Args: { _payload: Json }; Returns: string }
      driver_can_access_vehicle: {
        Args: { _vehicle_id: string }
        Returns: boolean
      }
      driver_create_event: {
        Args: {
          _event_type: string
          _notes?: string
          _payload?: Json
          _stop_id?: string
          _trip_id: string
        }
        Returns: string
      }
      driver_create_expense: {
        Args: {
          _amount: number
          _category: string
          _expense_at?: string
          _notes?: string
          _receipt_path?: string
          _trip_id: string
        }
        Returns: string
      }
      driver_create_operational_occurrence: {
        Args: {
          _client_id?: string
          _description: string
          _event_type: string
          _severity?: string
          _stop_id?: string
          _trip_id: string
        }
        Returns: string
      }
      driver_finalize_delivery: {
        Args: {
          _notes?: string
          _photo_paths?: string[]
          _receiver_document?: string
          _receiver_name: string
          _receiver_role?: string
          _signature_path?: string
          _stop_id: string
        }
        Returns: Json
      }
      driver_mark_arrival: { Args: { _stop_id: string }; Returns: string }
      driver_owns_stop: { Args: { _stop_id: string }; Returns: boolean }
      driver_owns_trip: { Args: { _trip_id: string }; Returns: boolean }
      driver_register_departure: {
        Args: { _notes?: string; _stop_id: string }
        Returns: string
      }
      driver_save_checklist: {
        Args: { _kind: string; _payload: Json; _trip_id: string }
        Returns: string
      }
      driver_update_stop_status: {
        Args: { _new_status: string; _reason?: string; _stop_id: string }
        Returns: Json
      }
      finalize_driver_delivery: {
        Args: {
          _fiscal_document_id?: string
          _photo_paths?: string[]
          _receiver_name: string
          _signature_path?: string
          _stop_id: string
        }
        Returns: Json
      }
      get_active_trips_live: { Args: { _tenant_id: string }; Returns: Json }
      get_client_document_download_url: {
        Args: { _proof_id: string }
        Returns: Json
      }
      get_client_pod_metadata: {
        Args: { _pod_id: string; _tenant_id: string }
        Returns: {
          storage_bucket: string
          storage_path: string
        }[]
      }
      get_client_portal_shipment_detail: {
        Args: { _fiscal_document_id: string }
        Returns: Json
      }
      get_client_portal_summary: {
        Args: { _end_date?: string; _start_date?: string; _tenant_id: string }
        Returns: Json
      }
      get_open_trip_alerts: {
        Args: { _tenant_id: string }
        Returns: {
          acknowledged_at: string | null
          closed_at: string | null
          id: string
          message: string | null
          metadata: Json | null
          opened_at: string
          severity: string
          status: string
          tenant_id: string
          title: string
          trip_id: string | null
          type: string
          vehicle_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "trip_alerts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_shipment_status: {
        Args: { _fiscal_document_id: string }
        Returns: string
      }
      get_user_client_access: {
        Args: { _tenant_id: string }
        Returns: {
          access_type: string
          can_download_documents: boolean
          can_open_occurrences: boolean
          can_request_pickup: boolean
          can_view_driver_contact: boolean
          can_view_financial: boolean
          can_view_vehicle_live: boolean
          client_id: string
        }[]
      }
      get_user_portal_tenants: {
        Args: never
        Returns: {
          id: string
          name: string
          plan_key: string
          timezone: string
        }[]
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
      is_tenant_operator_or_admin: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      is_user_internal_role: { Args: { _tenant_id: string }; Returns: boolean }
      list_client_documents: {
        Args: {
          _document_type?: string
          _end_date?: string
          _limit?: number
          _offset?: number
          _search?: string
          _start_date?: string
          _tenant_id: string
        }
        Returns: {
          access_key: string
          client_id: string
          document_type: string
          has_pod: boolean
          id: string
          invoice_number: string
          issue_date: string
          load_id: string
          recipient: string
          recipient_city: string
          recipient_state: string
          remitter: string
          status: string
          value: number
          weight_kg: number
        }[]
      }
      list_client_occurrences: {
        Args: {
          _limit?: number
          _offset?: number
          _resolved?: boolean
          _severity?: string
          _tenant_id: string
        }
        Returns: {
          client_action_required: boolean
          client_opened: boolean
          client_resolution_note: string
          created_at: string
          description: string
          event_type: string
          id: string
          load_id: string
          order_id: string
          public_status: string
          resolution: string
          resolved_at: string
          severity: string
        }[]
      }
      list_client_pickups: {
        Args: {
          _end_date?: string
          _limit?: number
          _offset?: number
          _start_date?: string
          _status?: string
          _tenant_id: string
        }
        Returns: {
          id: string
          linked_docs_count: number
          notes: string
          pickup_at: string
          pickup_number: string
          recipient_name: string
          remitter_cnpj: string
          remitter_name: string
          status: string
        }[]
      }
      list_client_pods: {
        Args: {
          _end_date?: string
          _limit?: number
          _offset?: number
          _start_date?: string
          _status?: string
          _tenant_id: string
        }
        Returns: {
          fiscal_document_id: string
          has_file: boolean
          id: string
          invoice_number: string
          load_id: string
          proof_type: string
          received_at: string
          receiver_document: string
          receiver_name: string
          receiver_role: string
          status: string
          validated_at: string
        }[]
      }
      log_pod_access: {
        Args: {
          _fiscal_document_id: string
          _pod_id: string
          _source?: string
          _success: boolean
          _tenant_id: string
        }
        Returns: undefined
      }
      move_load_items_between_loads: {
        Args: {
          _item_ids: string[]
          _source_load_id: string
          _target_load_id: string
          _tenant_id: string
        }
        Returns: Json
      }
      next_nfse_number: {
        Args: { _branch_code?: string; _series?: string; _tenant_id: string }
        Returns: number
      }
      peek_next_load_number: { Args: { _tenant_id: string }; Returns: string }
      peek_next_pickup_number: { Args: { _tenant_id: string }; Returns: string }
      portal_user_can_access_fiscal_document: {
        Args: { _fiscal_document_id: string; _tenant_id: string }
        Returns: boolean
      }
      portal_user_can_access_operational_event: {
        Args: { _event_id: string; _tenant_id: string }
        Returns: boolean
      }
      portal_user_can_access_pickup_order: {
        Args: { _pickup_order_id: string; _tenant_id: string }
        Returns: boolean
      }
      portal_user_can_download_fiscal_document: {
        Args: { _fiscal_document_id: string; _tenant_id: string }
        Returns: boolean
      }
      portal_user_can_view_financial: {
        Args: { _fiscal_document_id: string; _tenant_id: string }
        Returns: boolean
      }
      preview_reimport_cleanup_counts: {
        Args: { _end_date?: string; _start_date?: string; _tenant_id: string }
        Returns: Json
      }
      record_operational_event_with_status: {
        Args: {
          _description: string
          _entity_id: string
          _entity_type: string
          _event_type: string
          _new_status?: string
          _severity?: string
          _tenant_id: string
          _visible_to_client?: boolean
        }
        Returns: string
      }
      remove_fiscal_documents_from_load: {
        Args: { _document_ids: string[]; _load_id: string; _tenant_id: string }
        Returns: Json
      }
      request_client_pickup: {
        Args: {
          _client_id: string
          _notes?: string
          _pickup_at: string
          _recipient_name?: string
          _tenant_id: string
        }
        Returns: string
      }
      revert_xml_loads_to_available: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      search_client_portal_shipments: {
        Args: {
          _city?: string
          _end_date?: string
          _has_occurrence?: boolean
          _has_pod?: boolean
          _limit?: number
          _offset?: number
          _search?: string
          _start_date?: string
          _state?: string
          _status?: string[]
          _tenant_id: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stop_terminal_statuses: { Args: never; Returns: string[] }
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
      user_has_client_access: { Args: { _client_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "admin" | "operator" | "client" | "driver"
      operation_type:
        | "filial"
        | "armazenagem"
        | "frota"
        | "viagem_direta"
        | "retira"
        | "transferencia"
        | "devolucao"
        | "redespacho"
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
      operation_type: [
        "filial",
        "armazenagem",
        "frota",
        "viagem_direta",
        "retira",
        "transferencia",
        "devolucao",
        "redespacho",
      ],
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
