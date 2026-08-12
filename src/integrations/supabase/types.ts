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
      bank_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          active: boolean
          bank_code: string | null
          bank_name: string | null
          branch_number: string | null
          created_at: string
          created_by: string | null
          id: string
          initial_balance: number
          name: string
          pix_key: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string
          active?: boolean
          bank_code?: string | null
          bank_name?: string | null
          branch_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          name: string
          pix_key?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          active?: boolean
          bank_code?: string | null
          bank_name?: string | null
          branch_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          initial_balance?: number
          name?: string
          pix_key?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliation_audit: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_table: string | null
          id: string
          payload: Json
          reason: string | null
          session_id: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_table?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          session_id?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_table?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          session_id?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliation_sessions: {
        Row: {
          bank_account_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          period_end: string
          period_start: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          status: string
          tenant_id: string
          total_bank_inflow: number
          total_bank_outflow: number
          total_matched: number
          total_unmatched: number
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_end: string
          period_start: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          tenant_id: string
          total_bank_inflow?: number
          total_bank_outflow?: number
          total_matched?: number
          total_unmatched?: number
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_end?: string
          period_start?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          tenant_id?: string
          total_bank_inflow?: number
          total_bank_outflow?: number
          total_matched?: number
          total_unmatched?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliation_sessions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliation_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          bank_account_id: string
          created_at: string
          file_hash: string
          file_name: string | null
          id: string
          imported_at: string
          imported_by: string | null
          period_end: string | null
          period_start: string | null
          raw_metadata: Json
          rows_count: number
          status: string
          tenant_id: string
          total_inflow: number
          total_outflow: number
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          created_at?: string
          file_hash: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          period_end?: string | null
          period_start?: string | null
          raw_metadata?: Json
          rows_count?: number
          status?: string
          tenant_id: string
          total_inflow?: number
          total_outflow?: number
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          created_at?: string
          file_hash?: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          period_end?: string | null
          period_start?: string | null
          raw_metadata?: Json
          rows_count?: number
          status?: string
          tenant_id?: string
          total_inflow?: number
          total_outflow?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          bank_account_id: string
          cost_center: string | null
          counterparty_name: string | null
          created_at: string
          description: string | null
          document_number: string | null
          external_id: string | null
          id: string
          import_id: string | null
          normalized_description: string | null
          normalized_key: string | null
          posted_at: string
          raw_payload: Json
          reconciliation_status: string
          tenant_id: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          bank_account_id: string
          cost_center?: string | null
          counterparty_name?: string | null
          created_at?: string
          description?: string | null
          document_number?: string | null
          external_id?: string | null
          id?: string
          import_id?: string | null
          normalized_description?: string | null
          normalized_key?: string | null
          posted_at: string
          raw_payload?: Json
          reconciliation_status?: string
          tenant_id: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          bank_account_id?: string
          cost_center?: string | null
          counterparty_name?: string | null
          created_at?: string
          description?: string | null
          document_number?: string | null
          external_id?: string | null
          id?: string
          import_id?: string | null
          normalized_description?: string | null
          normalized_key?: string | null
          posted_at?: string
          raw_payload?: Json
          reconciliation_status?: string
          tenant_id?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_edi_export_items: {
        Row: {
          amount: number
          client_invoice_id: string
          created_at: string
          due_date: string | null
          export_id: string
          id: string
          invoice_number: string | null
          issue_date: string | null
          receivable_id: string | null
          status: string
          tenant_id: string
          validation_messages: Json
          validation_status: string
        }
        Insert: {
          amount?: number
          client_invoice_id: string
          created_at?: string
          due_date?: string | null
          export_id: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          receivable_id?: string | null
          status?: string
          tenant_id: string
          validation_messages?: Json
          validation_status?: string
        }
        Update: {
          amount?: number
          client_invoice_id?: string
          created_at?: string
          due_date?: string | null
          export_id?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          receivable_id?: string | null
          status?: string
          tenant_id?: string
          validation_messages?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_edi_export_items_client_invoice_id_fkey"
            columns: ["client_invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_edi_export_items_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "billing_edi_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_edi_export_items_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_edi_exports: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          charge_count: number
          client_id: string | null
          content_hash: string | null
          created_at: string
          detail_count: number
          downloaded_at: string | null
          error_message: string | null
          file_date: string
          file_name: string
          format: string
          generated_at: string
          generated_by: string | null
          generated_content: string | null
          id: string
          invoice_count: number
          profile_id: string | null
          record_count: number
          reprocess_reason: string | null
          sent_at: string | null
          sent_channel: string | null
          sent_to: string | null
          status: string
          storage_path: string | null
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          charge_count?: number
          client_id?: string | null
          content_hash?: string | null
          created_at?: string
          detail_count?: number
          downloaded_at?: string | null
          error_message?: string | null
          file_date?: string
          file_name: string
          format?: string
          generated_at?: string
          generated_by?: string | null
          generated_content?: string | null
          id?: string
          invoice_count?: number
          profile_id?: string | null
          record_count?: number
          reprocess_reason?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          status?: string
          storage_path?: string | null
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          charge_count?: number
          client_id?: string | null
          content_hash?: string | null
          created_at?: string
          detail_count?: number
          downloaded_at?: string | null
          error_message?: string | null
          file_date?: string
          file_name?: string
          format?: string
          generated_at?: string
          generated_by?: string | null
          generated_content?: string | null
          id?: string
          invoice_count?: number
          profile_id?: string | null
          record_count?: number
          reprocess_reason?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          status?: string
          storage_path?: string | null
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_edi_exports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_edi_exports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "billing_edi_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_edi_profiles: {
        Row: {
          api_integration_id: string | null
          bank_account: string | null
          bank_account_id: string | null
          bank_agency: string | null
          bank_name: string | null
          branch_code: string | null
          client_id: string | null
          company_code: string | null
          created_at: string
          created_by: string | null
          destination_name: string | null
          document_type: string | null
          enabled: boolean
          file_name_pattern: string | null
          format: string
          id: string
          layout_version: string | null
          metadata: Json
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_integration_id?: string | null
          bank_account?: string | null
          bank_account_id?: string | null
          bank_agency?: string | null
          bank_name?: string | null
          branch_code?: string | null
          client_id?: string | null
          company_code?: string | null
          created_at?: string
          created_by?: string | null
          destination_name?: string | null
          document_type?: string | null
          enabled?: boolean
          file_name_pattern?: string | null
          format?: string
          id?: string
          layout_version?: string | null
          metadata?: Json
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_integration_id?: string | null
          bank_account?: string | null
          bank_account_id?: string | null
          bank_agency?: string | null
          bank_name?: string | null
          branch_code?: string | null
          client_id?: string | null
          company_code?: string | null
          created_at?: string
          created_by?: string | null
          destination_name?: string | null
          document_type?: string | null
          enabled?: boolean
          file_name_pattern?: string | null
          format?: string
          id?: string
          layout_version?: string | null
          metadata?: Json
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_edi_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      client_invoice_charges: {
        Row: {
          cancelled_at: string | null
          created_at: string
          description: string | null
          discount_amount: number
          gross_amount: number
          id: string
          interest_amount: number
          invoice_id: string
          ir_amount: number
          issue_date: string | null
          metadata: Json
          net_amount: number
          reference_number: string | null
          sort_order: number
          source_id: string | null
          source_number: string | null
          source_series: string | null
          source_type: string
          tenant_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          description?: string | null
          discount_amount?: number
          gross_amount?: number
          id?: string
          interest_amount?: number
          invoice_id: string
          ir_amount?: number
          issue_date?: string | null
          metadata?: Json
          net_amount?: number
          reference_number?: string | null
          sort_order?: number
          source_id?: string | null
          source_number?: string | null
          source_series?: string | null
          source_type: string
          tenant_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          description?: string | null
          discount_amount?: number
          gross_amount?: number
          id?: string
          interest_amount?: number
          invoice_id?: string
          ir_amount?: number
          issue_date?: string | null
          metadata?: Json
          net_amount?: number
          reference_number?: string | null
          sort_order?: number
          source_id?: string | null
          source_number?: string | null
          source_series?: string | null
          source_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invoice_charges_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invoice_details: {
        Row: {
          cargo_value: number | null
          charge_id: string
          created_at: string
          destination: string | null
          displayed_freight_value: number | null
          document_label: string | null
          document_number: string | null
          emission_date: string | null
          id: string
          invoice_id: string
          metadata: Json
          notes: string | null
          ort_number: string | null
          recipient: string | null
          remitter: string | null
          sort_order: number
          source_id: string | null
          source_type: string | null
          tenant_id: string
          weight_kg: number | null
        }
        Insert: {
          cargo_value?: number | null
          charge_id: string
          created_at?: string
          destination?: string | null
          displayed_freight_value?: number | null
          document_label?: string | null
          document_number?: string | null
          emission_date?: string | null
          id?: string
          invoice_id: string
          metadata?: Json
          notes?: string | null
          ort_number?: string | null
          recipient?: string | null
          remitter?: string | null
          sort_order?: number
          source_id?: string | null
          source_type?: string | null
          tenant_id: string
          weight_kg?: number | null
        }
        Update: {
          cargo_value?: number | null
          charge_id?: string
          created_at?: string
          destination?: string | null
          displayed_freight_value?: number | null
          document_label?: string | null
          document_number?: string | null
          emission_date?: string | null
          id?: string
          invoice_id?: string
          metadata?: Json
          notes?: string | null
          ort_number?: string | null
          recipient?: string | null
          remitter?: string | null
          sort_order?: number
          source_id?: string | null
          source_type?: string | null
          tenant_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_invoice_details_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "client_invoice_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoice_details_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invoice_sequences: {
        Row: {
          next_number: number
          sequence_year: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          sequence_year: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          sequence_year?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_invoices: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string
          company_snapshot: Json
          created_at: string
          created_by: string | null
          discount_amount: number
          due_date: string | null
          edi_generated_at: string | null
          edi_sent_at: string | null
          edi_status: string
          gross_amount: number
          id: string
          installment_number: number
          interest_amount: number
          invoice_number: string
          issue_date: string
          last_edi_export_id: string | null
          notes: string | null
          payer_snapshot: Json
          pdf_url: string | null
          receivable_id: string | null
          sent_at: string | null
          sent_channel: string | null
          sent_to: string | null
          sequence_number: number | null
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id: string
          company_snapshot?: Json
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          due_date?: string | null
          edi_generated_at?: string | null
          edi_sent_at?: string | null
          edi_status?: string
          gross_amount?: number
          id?: string
          installment_number?: number
          interest_amount?: number
          invoice_number: string
          issue_date?: string
          last_edi_export_id?: string | null
          notes?: string | null
          payer_snapshot?: Json
          pdf_url?: string | null
          receivable_id?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          sequence_number?: number | null
          status?: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string
          company_snapshot?: Json
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          due_date?: string | null
          edi_generated_at?: string | null
          edi_sent_at?: string | null
          edi_status?: string
          gross_amount?: number
          id?: string
          installment_number?: number
          interest_amount?: number
          invoice_number?: string
          issue_date?: string
          last_edi_export_id?: string | null
          notes?: string | null
          payer_snapshot?: Json
          pdf_url?: string | null
          receivable_id?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          sequence_number?: number | null
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_occurrence_messages: {
        Row: {
          author_role: string
          author_user_id: string | null
          created_at: string
          id: string
          message: string
          occurrence_id: string
          tenant_id: string
        }
        Insert: {
          author_role: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          message: string
          occurrence_id: string
          tenant_id: string
        }
        Update: {
          author_role?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          message?: string
          occurrence_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_occurrence_messages_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "operational_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_occurrence_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      client_rural_delivery_profile_history: {
        Row: {
          action: string
          client_id: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          profile_id: string
          reason: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          profile_id: string
          reason?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          profile_id?: string
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_rural_delivery_profile_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_rural_delivery_profile_history_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_rural_delivery_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_rural_delivery_profiles: {
        Row: {
          access_type: string | null
          active: boolean
          can_deliver_in_city: boolean
          city: string | null
          city_delivery_instructions: string | null
          client_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          delivery_mode: string
          driver_instructions: string | null
          id: string
          internal_notes: string | null
          last_used_at: string | null
          locality: string | null
          neighborhood: string | null
          origin_city: string | null
          origin_state: string | null
          recipient_name_snapshot: string | null
          related_remitter_id: string | null
          requires_contact_before_delivery: boolean
          round_trip_km: number | null
          source_reference: string | null
          source_type: string
          state: string | null
          supplier_name_snapshot: string | null
          taxi_contact_name: string | null
          taxi_contact_phone: string | null
          taxi_estimated_cost: number | null
          taxi_required: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_type?: string | null
          active?: boolean
          can_deliver_in_city?: boolean
          city?: string | null
          city_delivery_instructions?: string | null
          client_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          delivery_mode?: string
          driver_instructions?: string | null
          id?: string
          internal_notes?: string | null
          last_used_at?: string | null
          locality?: string | null
          neighborhood?: string | null
          origin_city?: string | null
          origin_state?: string | null
          recipient_name_snapshot?: string | null
          related_remitter_id?: string | null
          requires_contact_before_delivery?: boolean
          round_trip_km?: number | null
          source_reference?: string | null
          source_type?: string
          state?: string | null
          supplier_name_snapshot?: string | null
          taxi_contact_name?: string | null
          taxi_contact_phone?: string | null
          taxi_estimated_cost?: number | null
          taxi_required?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_type?: string | null
          active?: boolean
          can_deliver_in_city?: boolean
          city?: string | null
          city_delivery_instructions?: string | null
          client_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          delivery_mode?: string
          driver_instructions?: string | null
          id?: string
          internal_notes?: string | null
          last_used_at?: string | null
          locality?: string | null
          neighborhood?: string | null
          origin_city?: string | null
          origin_state?: string | null
          recipient_name_snapshot?: string | null
          related_remitter_id?: string | null
          requires_contact_before_delivery?: boolean
          round_trip_km?: number | null
          source_reference?: string | null
          source_type?: string
          state?: string | null
          supplier_name_snapshot?: string | null
          taxi_contact_name?: string | null
          taxi_contact_phone?: string | null
          taxi_estimated_cost?: number | null
          taxi_required?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_rural_delivery_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_rural_delivery_profiles_related_remitter_id_fkey"
            columns: ["related_remitter_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          is_client: boolean
          is_rural: boolean
          is_supplier: boolean
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
          rural_access_type: string | null
          rural_contact_name: string | null
          rural_contact_phone: string | null
          rural_delivery_difficulty: string | null
          rural_driver_instructions: string | null
          rural_notes: string | null
          rural_requires_contact: boolean
          rural_updated_at: string | null
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
          is_client?: boolean
          is_rural?: boolean
          is_supplier?: boolean
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
          rural_access_type?: string | null
          rural_contact_name?: string | null
          rural_contact_phone?: string | null
          rural_delivery_difficulty?: string | null
          rural_driver_instructions?: string | null
          rural_notes?: string | null
          rural_requires_contact?: boolean
          rural_updated_at?: string | null
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
          is_client?: boolean
          is_rural?: boolean
          is_supplier?: boolean
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
          rural_access_type?: string | null
          rural_contact_name?: string | null
          rural_contact_phone?: string | null
          rural_delivery_difficulty?: string | null
          rural_driver_instructions?: string | null
          rural_notes?: string | null
          rural_requires_contact?: boolean
          rural_updated_at?: string | null
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
      closing_report_history: {
        Row: {
          action: string
          closing_report_id: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          metadata: Json
          new_value: string | null
          old_value: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          closing_report_id: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          closing_report_id?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_report_history_closing_report_id_fkey"
            columns: ["closing_report_id"]
            isOneToOne: false
            referencedRelation: "closing_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_report_items: {
        Row: {
          arrival_at_ts: string | null
          arrival_date: string | null
          closing_report_id: string
          consumption_km_l: number | null
          created_at: string
          cte_document_id: string | null
          cte_key: string | null
          cte_number: string | null
          days_count: number | null
          delivery_date: string | null
          delivery_status: string | null
          departure_at: string | null
          destination_city: string | null
          destination_state: string | null
          driver_id: string | null
          driver_name: string | null
          fiscal_document_id: string | null
          freight_cif_value: number
          freight_fob_value: number
          freight_value: number
          fuel_liters: number | null
          fuel_total: number | null
          fuel_unit_price: number | null
          id: string
          invoice_key: string | null
          invoice_number: string | null
          invoice_value: number
          issue_date: string | null
          km_driven: number | null
          km_final: number | null
          km_initial: number | null
          legacy_status_text: string | null
          load_document_id: string | null
          load_id: string | null
          load_number: string | null
          metadata: Json
          observation: string | null
          origin_city: string | null
          origin_state: string | null
          payment_status: string | null
          recipient_cnpj: string | null
          recipient_name: string | null
          remitter_cnpj: string | null
          remitter_name: string | null
          route_complement: string | null
          route_label: string | null
          sort_order: number
          source_type: string
          tenant_id: string
          vehicle_id: string | null
          vehicle_plate: string | null
          volume_count: number
          weight_kg: number
        }
        Insert: {
          arrival_at_ts?: string | null
          arrival_date?: string | null
          closing_report_id: string
          consumption_km_l?: number | null
          created_at?: string
          cte_document_id?: string | null
          cte_key?: string | null
          cte_number?: string | null
          days_count?: number | null
          delivery_date?: string | null
          delivery_status?: string | null
          departure_at?: string | null
          destination_city?: string | null
          destination_state?: string | null
          driver_id?: string | null
          driver_name?: string | null
          fiscal_document_id?: string | null
          freight_cif_value?: number
          freight_fob_value?: number
          freight_value?: number
          fuel_liters?: number | null
          fuel_total?: number | null
          fuel_unit_price?: number | null
          id?: string
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_value?: number
          issue_date?: string | null
          km_driven?: number | null
          km_final?: number | null
          km_initial?: number | null
          legacy_status_text?: string | null
          load_document_id?: string | null
          load_id?: string | null
          load_number?: string | null
          metadata?: Json
          observation?: string | null
          origin_city?: string | null
          origin_state?: string | null
          payment_status?: string | null
          recipient_cnpj?: string | null
          recipient_name?: string | null
          remitter_cnpj?: string | null
          remitter_name?: string | null
          route_complement?: string | null
          route_label?: string | null
          sort_order?: number
          source_type?: string
          tenant_id: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
          volume_count?: number
          weight_kg?: number
        }
        Update: {
          arrival_at_ts?: string | null
          arrival_date?: string | null
          closing_report_id?: string
          consumption_km_l?: number | null
          created_at?: string
          cte_document_id?: string | null
          cte_key?: string | null
          cte_number?: string | null
          days_count?: number | null
          delivery_date?: string | null
          delivery_status?: string | null
          departure_at?: string | null
          destination_city?: string | null
          destination_state?: string | null
          driver_id?: string | null
          driver_name?: string | null
          fiscal_document_id?: string | null
          freight_cif_value?: number
          freight_fob_value?: number
          freight_value?: number
          fuel_liters?: number | null
          fuel_total?: number | null
          fuel_unit_price?: number | null
          id?: string
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_value?: number
          issue_date?: string | null
          km_driven?: number | null
          km_final?: number | null
          km_initial?: number | null
          legacy_status_text?: string | null
          load_document_id?: string | null
          load_id?: string | null
          load_number?: string | null
          metadata?: Json
          observation?: string | null
          origin_city?: string | null
          origin_state?: string | null
          payment_status?: string | null
          recipient_cnpj?: string | null
          recipient_name?: string | null
          remitter_cnpj?: string | null
          remitter_name?: string | null
          route_complement?: string | null
          route_label?: string | null
          sort_order?: number
          source_type?: string
          tenant_id?: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
          volume_count?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "closing_report_items_closing_report_id_fkey"
            columns: ["closing_report_id"]
            isOneToOne: false
            referencedRelation: "closing_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_report_items_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_report_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_report_items_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_report_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          closing_report_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          receivable_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          closing_report_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
          receivable_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          closing_report_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          receivable_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_report_payments_closing_report_id_fkey"
            columns: ["closing_report_id"]
            isOneToOne: false
            referencedRelation: "closing_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_report_payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_report_sequences: {
        Row: {
          next_number: number
          sequence_year: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          sequence_year: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          sequence_year?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      closing_report_summary_lines: {
        Row: {
          arrival_date: string | null
          billing_period_label: string | null
          closing_report_id: string
          created_at: string
          cte_count: number
          fiscal_document_count: number
          group_label: string
          group_type: string
          id: string
          load_count: number
          notes: string | null
          sort_order: number
          tenant_id: string
          total_freight_value: number
          total_invoice_value: number
          total_volume: number
          total_weight_kg: number
        }
        Insert: {
          arrival_date?: string | null
          billing_period_label?: string | null
          closing_report_id: string
          created_at?: string
          cte_count?: number
          fiscal_document_count?: number
          group_label: string
          group_type: string
          id?: string
          load_count?: number
          notes?: string | null
          sort_order?: number
          tenant_id: string
          total_freight_value?: number
          total_invoice_value?: number
          total_volume?: number
          total_weight_kg?: number
        }
        Update: {
          arrival_date?: string | null
          billing_period_label?: string | null
          closing_report_id?: string
          created_at?: string
          cte_count?: number
          fiscal_document_count?: number
          group_label?: string
          group_type?: string
          id?: string
          load_count?: number
          notes?: string | null
          sort_order?: number
          tenant_id?: string
          total_freight_value?: number
          total_invoice_value?: number
          total_volume?: number
          total_weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "closing_report_summary_lines_closing_report_id_fkey"
            columns: ["closing_report_id"]
            isOneToOne: false
            referencedRelation: "closing_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_reports: {
        Row: {
          arrival_date_end: string | null
          arrival_date_start: string | null
          avg_consumption_km_l: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          client_invoice_id: string | null
          client_snapshot: Json
          closed_at: string | null
          closed_by: string | null
          closing_number: string
          company_snapshot: Json
          created_at: string
          created_by: string | null
          csv_url: string | null
          cte_count: number
          delivery_date_end: string | null
          delivery_date_start: string | null
          discount_amount: number
          doccob_export_id: string | null
          driver_names_snapshot: string[] | null
          excel_url: string | null
          expected_payment_date: string | null
          filters_snapshot: Json
          fiscal_document_count: number
          gross_amount: number
          id: string
          interest_amount: number
          invoice_status: string
          issue_date_end: string | null
          issue_date_start: string | null
          load_count: number
          notes: string | null
          open_amount: number
          payer_client_id: string | null
          payment_date: string | null
          payment_status: string
          pdf_url: string | null
          period_end: string
          period_start: string
          receivable_id: string | null
          received_amount: number
          report_model: string
          report_type: string
          sent_at: string | null
          sent_channel: string | null
          sent_to: string | null
          status: string
          tenant_id: string
          title: string
          total_amount: number
          total_freight_value: number
          total_fuel_cost: number | null
          total_invoice_value: number
          total_km_driven: number | null
          total_liters: number | null
          total_volume: number
          total_weight_kg: number
          totals_snapshot: Json
          updated_at: string
          updated_by: string | null
          vehicle_plates_snapshot: string[] | null
        }
        Insert: {
          arrival_date_end?: string | null
          arrival_date_start?: string | null
          avg_consumption_km_l?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          client_invoice_id?: string | null
          client_snapshot?: Json
          closed_at?: string | null
          closed_by?: string | null
          closing_number: string
          company_snapshot?: Json
          created_at?: string
          created_by?: string | null
          csv_url?: string | null
          cte_count?: number
          delivery_date_end?: string | null
          delivery_date_start?: string | null
          discount_amount?: number
          doccob_export_id?: string | null
          driver_names_snapshot?: string[] | null
          excel_url?: string | null
          expected_payment_date?: string | null
          filters_snapshot?: Json
          fiscal_document_count?: number
          gross_amount?: number
          id?: string
          interest_amount?: number
          invoice_status?: string
          issue_date_end?: string | null
          issue_date_start?: string | null
          load_count?: number
          notes?: string | null
          open_amount?: number
          payer_client_id?: string | null
          payment_date?: string | null
          payment_status?: string
          pdf_url?: string | null
          period_end: string
          period_start: string
          receivable_id?: string | null
          received_amount?: number
          report_model?: string
          report_type: string
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          status?: string
          tenant_id: string
          title: string
          total_amount?: number
          total_freight_value?: number
          total_fuel_cost?: number | null
          total_invoice_value?: number
          total_km_driven?: number | null
          total_liters?: number | null
          total_volume?: number
          total_weight_kg?: number
          totals_snapshot?: Json
          updated_at?: string
          updated_by?: string | null
          vehicle_plates_snapshot?: string[] | null
        }
        Update: {
          arrival_date_end?: string | null
          arrival_date_start?: string | null
          avg_consumption_km_l?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          client_invoice_id?: string | null
          client_snapshot?: Json
          closed_at?: string | null
          closed_by?: string | null
          closing_number?: string
          company_snapshot?: Json
          created_at?: string
          created_by?: string | null
          csv_url?: string | null
          cte_count?: number
          delivery_date_end?: string | null
          delivery_date_start?: string | null
          discount_amount?: number
          doccob_export_id?: string | null
          driver_names_snapshot?: string[] | null
          excel_url?: string | null
          expected_payment_date?: string | null
          filters_snapshot?: Json
          fiscal_document_count?: number
          gross_amount?: number
          id?: string
          interest_amount?: number
          invoice_status?: string
          issue_date_end?: string | null
          issue_date_start?: string | null
          load_count?: number
          notes?: string | null
          open_amount?: number
          payer_client_id?: string | null
          payment_date?: string | null
          payment_status?: string
          pdf_url?: string | null
          period_end?: string
          period_start?: string
          receivable_id?: string | null
          received_amount?: number
          report_model?: string
          report_type?: string
          sent_at?: string | null
          sent_channel?: string | null
          sent_to?: string | null
          status?: string
          tenant_id?: string
          title?: string
          total_amount?: number
          total_freight_value?: number
          total_fuel_cost?: number | null
          total_invoice_value?: number
          total_km_driven?: number | null
          total_liters?: number | null
          total_volume?: number
          total_weight_kg?: number
          totals_snapshot?: Json
          updated_at?: string
          updated_by?: string | null
          vehicle_plates_snapshot?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "closing_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_reports_payer_client_id_fkey"
            columns: ["payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      cost_centers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cte_batches: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          emitter_id: string | null
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
          emitter_id?: string | null
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
          emitter_id?: string | null
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
          {
            foreignKeyName: "cte_batches_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
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
          emitter_id: string | null
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
          remitter_cnpj: string | null
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
          emitter_id?: string | null
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
          remitter_cnpj?: string | null
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
          emitter_id?: string | null
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
          remitter_cnpj?: string | null
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
          {
            foreignKeyName: "cte_documents_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
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
      delivery_occurrence_items: {
        Row: {
          created_at: string
          fiscal_document_id: string | null
          id: string
          invoice_number: string | null
          item_value: number | null
          metadata: Json
          notes: string | null
          occurrence_id: string
          product_code: string | null
          product_description: string | null
          quantity: number | null
          quantity_text: string | null
          reason: string | null
          return_type: string | null
          tenant_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          item_value?: number | null
          metadata?: Json
          notes?: string | null
          occurrence_id: string
          product_code?: string | null
          product_description?: string | null
          quantity?: number | null
          quantity_text?: string | null
          reason?: string | null
          return_type?: string | null
          tenant_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          item_value?: number | null
          metadata?: Json
          notes?: string | null
          occurrence_id?: string
          product_code?: string | null
          product_description?: string | null
          quantity?: number | null
          quantity_text?: string | null
          reason?: string | null
          return_type?: string | null
          tenant_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_occurrence_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrence_items_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "delivery_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_occurrences: {
        Row: {
          city: string | null
          client_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          cte_document_id: string | null
          cte_number: string | null
          customer_name: string | null
          driver_id: string | null
          fiscal_document_id: string | null
          id: string
          invoice_number: string | null
          legacy_status_text: string | null
          load_id: string | null
          metadata: Json
          occurrence_date: string | null
          occurrence_description: string | null
          occurrence_number: string | null
          occurrence_reason: string | null
          occurrence_time: string | null
          occurrence_type: string
          password_or_authorization: string | null
          resolution_notes: string | null
          resolution_type: string | null
          resolved_at: string | null
          responsible_user_id: string | null
          state: string | null
          status: string
          supplier_id: string | null
          supplier_name: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city?: string | null
          client_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          cte_number?: string | null
          customer_name?: string | null
          driver_id?: string | null
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          legacy_status_text?: string | null
          load_id?: string | null
          metadata?: Json
          occurrence_date?: string | null
          occurrence_description?: string | null
          occurrence_number?: string | null
          occurrence_reason?: string | null
          occurrence_time?: string | null
          occurrence_type: string
          password_or_authorization?: string | null
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          responsible_user_id?: string | null
          state?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city?: string | null
          client_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          cte_number?: string | null
          customer_name?: string | null
          driver_id?: string | null
          fiscal_document_id?: string | null
          id?: string
          invoice_number?: string | null
          legacy_status_text?: string | null
          load_id?: string | null
          metadata?: Json
          occurrence_date?: string | null
          occurrence_description?: string | null
          occurrence_number?: string | null
          occurrence_reason?: string | null
          occurrence_time?: string | null
          occurrence_type?: string
          password_or_authorization?: string | null
          resolution_notes?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          responsible_user_id?: string | null
          state?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_occurrences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrences_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrences_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrences_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrences_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_occurrences_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      driver_arrival_forecasts: {
        Row: {
          created_at: string
          created_by: string | null
          current_city: string | null
          current_state: string | null
          driver_id: string | null
          forecast_arrival_at: string | null
          forecast_date: string
          forecast_text: string | null
          forecast_time: string | null
          id: string
          monitor_id: string
          observation: string | null
          remaining_cities: Json
          remaining_cities_text: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_city?: string | null
          current_state?: string | null
          driver_id?: string | null
          forecast_arrival_at?: string | null
          forecast_date: string
          forecast_text?: string | null
          forecast_time?: string | null
          id?: string
          monitor_id: string
          observation?: string | null
          remaining_cities?: Json
          remaining_cities_text?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_city?: string | null
          current_state?: string | null
          driver_id?: string | null
          forecast_arrival_at?: string | null
          forecast_date?: string
          forecast_text?: string | null
          forecast_time?: string | null
          id?: string
          monitor_id?: string
          observation?: string | null
          remaining_cities?: Json
          remaining_cities_text?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_arrival_forecasts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_arrival_forecasts_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "driver_route_monitors"
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
          city: string | null
          cost_center: string | null
          created_at: string
          dispatch_trip_id: string | null
          document_number: string | null
          driver_id: string | null
          expense_at: string
          id: string
          no_receipt: boolean
          no_receipt_reason: string | null
          notes: string | null
          odometer: number | null
          paid_with_advance: boolean
          payment_source: string
          receipt_url: string | null
          reimbursable: boolean
          state: string | null
          supplier_name: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          city?: string | null
          cost_center?: string | null
          created_at?: string
          dispatch_trip_id?: string | null
          document_number?: string | null
          driver_id?: string | null
          expense_at?: string
          id?: string
          no_receipt?: boolean
          no_receipt_reason?: string | null
          notes?: string | null
          odometer?: number | null
          paid_with_advance?: boolean
          payment_source?: string
          receipt_url?: string | null
          reimbursable?: boolean
          state?: string | null
          supplier_name?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          city?: string | null
          cost_center?: string | null
          created_at?: string
          dispatch_trip_id?: string | null
          document_number?: string | null
          driver_id?: string | null
          expense_at?: string
          id?: string
          no_receipt?: boolean
          no_receipt_reason?: string | null
          notes?: string | null
          odometer?: number | null
          paid_with_advance?: boolean
          payment_source?: string
          receipt_url?: string | null
          reimbursable?: boolean
          state?: string | null
          supplier_name?: string | null
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
      driver_monitoring_history: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          metadata: Json
          monitor_id: string
          new_value: string | null
          old_value: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          monitor_id: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          monitor_id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_monitoring_history_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "driver_route_monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_monitoring_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          duplicated_count: number
          error_count: number
          errors: Json
          file_name: string | null
          id: string
          imported_forecasts: number
          imported_monitors: number
          imported_updates: number
          metadata: Json
          row_count: number
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duplicated_count?: number
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_forecasts?: number
          imported_monitors?: number
          imported_updates?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duplicated_count?: number
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_forecasts?: number
          imported_monitors?: number
          imported_updates?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      driver_route_monitors: {
        Row: {
          actual_returned_at: string | null
          arrival_forecast_at: string | null
          arrival_forecast_text: string | null
          completed_deliveries: number
          created_at: string
          created_by: string | null
          current_city: string | null
          current_state: string | null
          driver_id: string | null
          driver_name_snapshot: string | null
          expected_return_date: string | null
          id: string
          import_batch_id: string | null
          last_update_at: string | null
          load_id: string | null
          monitor_number: string
          next_city: string | null
          next_state: string | null
          notes: string | null
          planned_cities: Json
          planned_route_text: string | null
          remaining_cities: Json
          remaining_deliveries: number
          return_deadline_days: number | null
          route_id: string | null
          source_type: string
          started_at: string | null
          status: string
          tenant_id: string
          total_deliveries: number
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
          vehicle_plate_snapshot: string | null
        }
        Insert: {
          actual_returned_at?: string | null
          arrival_forecast_at?: string | null
          arrival_forecast_text?: string | null
          completed_deliveries?: number
          created_at?: string
          created_by?: string | null
          current_city?: string | null
          current_state?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          expected_return_date?: string | null
          id?: string
          import_batch_id?: string | null
          last_update_at?: string | null
          load_id?: string | null
          monitor_number: string
          next_city?: string | null
          next_state?: string | null
          notes?: string | null
          planned_cities?: Json
          planned_route_text?: string | null
          remaining_cities?: Json
          remaining_deliveries?: number
          return_deadline_days?: number | null
          route_id?: string | null
          source_type?: string
          started_at?: string | null
          status?: string
          tenant_id: string
          total_deliveries?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Update: {
          actual_returned_at?: string | null
          arrival_forecast_at?: string | null
          arrival_forecast_text?: string | null
          completed_deliveries?: number
          created_at?: string
          created_by?: string | null
          current_city?: string | null
          current_state?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          expected_return_date?: string | null
          id?: string
          import_batch_id?: string | null
          last_update_at?: string | null
          load_id?: string | null
          monitor_number?: string
          next_city?: string | null
          next_state?: string | null
          notes?: string | null
          planned_cities?: Json
          planned_route_text?: string | null
          remaining_cities?: Json
          remaining_deliveries?: number
          return_deadline_days?: number | null
          route_id?: string | null
          source_type?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
          total_deliveries?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_route_monitors_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_route_monitors_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_route_monitors_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_route_progress_updates: {
        Row: {
          city: string | null
          city_finished_at: string | null
          city_total_deliveries: number | null
          created_at: string
          created_by: string | null
          deadline_to_finish: string | null
          deliveries_completed_in_city: number
          driver_id: string | null
          id: string
          load_id: string | null
          monitor_id: string
          next_city: string | null
          next_city_deliveries: number | null
          next_city_finished_at: string | null
          next_deadline_to_finish: string | null
          next_state: string | null
          observation: string | null
          source_type: string
          state: string | null
          status: string | null
          tenant_id: string
          update_date: string
          update_time: string | null
        }
        Insert: {
          city?: string | null
          city_finished_at?: string | null
          city_total_deliveries?: number | null
          created_at?: string
          created_by?: string | null
          deadline_to_finish?: string | null
          deliveries_completed_in_city?: number
          driver_id?: string | null
          id?: string
          load_id?: string | null
          monitor_id: string
          next_city?: string | null
          next_city_deliveries?: number | null
          next_city_finished_at?: string | null
          next_deadline_to_finish?: string | null
          next_state?: string | null
          observation?: string | null
          source_type?: string
          state?: string | null
          status?: string | null
          tenant_id: string
          update_date: string
          update_time?: string | null
        }
        Update: {
          city?: string | null
          city_finished_at?: string | null
          city_total_deliveries?: number | null
          created_at?: string
          created_by?: string | null
          deadline_to_finish?: string | null
          deliveries_completed_in_city?: number
          driver_id?: string | null
          id?: string
          load_id?: string | null
          monitor_id?: string
          next_city?: string | null
          next_city_deliveries?: number | null
          next_city_finished_at?: string | null
          next_deadline_to_finish?: string | null
          next_state?: string | null
          observation?: string | null
          source_type?: string
          state?: string | null
          status?: string | null
          tenant_id?: string
          update_date?: string
          update_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_route_progress_updates_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_route_progress_updates_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_route_progress_updates_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "driver_route_monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlement_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          from_status: string | null
          id: string
          payload: Json
          reason: string | null
          settlement_id: string
          tenant_id: string
          to_status: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          settlement_id: string
          tenant_id: string
          to_status?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          settlement_id?: string
          tenant_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlement_events_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlement_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlement_items: {
        Row: {
          amount: number | null
          created_at: string
          description: string | null
          id: string
          item_type: string
          metadata: Json
          nature: string | null
          quantity: number | null
          settlement_id: string
          source_id: string | null
          source_table: string | null
          tenant_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          description?: string | null
          id?: string
          item_type: string
          metadata?: Json
          nature?: string | null
          quantity?: number | null
          settlement_id: string
          source_id?: string | null
          source_table?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          description?: string | null
          id?: string
          item_type?: string
          metadata?: Json
          nature?: string | null
          quantity?: number | null
          settlement_id?: string
          source_id?: string | null
          source_table?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlement_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlement_loads: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          load_id: string
          settlement_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          load_id: string
          settlement_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          load_id?: string
          settlement_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlement_loads_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: true
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlement_loads_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlement_loads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlement_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string
          paid_by: string | null
          payment_account: string | null
          payment_method: string | null
          payment_reference: string | null
          receipt_url: string | null
          settlement_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payment_account?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          receipt_url?: string | null
          settlement_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          paid_by?: string | null
          payment_account?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          receipt_url?: string | null
          settlement_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlement_payments_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "driver_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlement_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_expenses_total: number | null
          approved_with_exception: boolean
          audited_end_location: string | null
          audited_km: number | null
          audited_start_location: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          dispatch_trip_id: string | null
          documents_count: number | null
          driver_credits_total: number
          driver_debits_total: number
          driver_id: string | null
          driver_payable_amount: number
          driver_reimbursement_total: number
          estimated_km: number | null
          exception_reason: string | null
          expenses_total: number | null
          final_amount: number | null
          id: string
          invoice_balance: number | null
          is_manual: boolean
          km_end: number | null
          km_review_notes: string | null
          km_review_status: string | null
          km_start: number | null
          last_recalculated_at: string | null
          loads_count: number | null
          manual_adjustments_total: number | null
          manual_reference_date: string | null
          needs_recalculation: boolean
          operational_balance: number | null
          paid_at: string | null
          paid_by: string | null
          payment_balance: number
          pending_expenses_total: number | null
          recalculation_reason: string | null
          rejected_expenses_total: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          route_destination: string | null
          route_name: string | null
          route_origin: string | null
          route_result: number
          snapshot_json: Json
          source_updated_at: string | null
          status: string
          stops_count: number | null
          tenant_id: string
          total_freight_revenue: number
          total_freight_value: number | null
          total_goods_value: number
          total_invoice_value: number | null
          total_paid_amount: number
          total_weight_kg: number | null
          trip_completed_at: string | null
          trip_started_at: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_expenses_total?: number | null
          approved_with_exception?: boolean
          audited_end_location?: string | null
          audited_km?: number | null
          audited_start_location?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          documents_count?: number | null
          driver_credits_total?: number
          driver_debits_total?: number
          driver_id?: string | null
          driver_payable_amount?: number
          driver_reimbursement_total?: number
          estimated_km?: number | null
          exception_reason?: string | null
          expenses_total?: number | null
          final_amount?: number | null
          id?: string
          invoice_balance?: number | null
          is_manual?: boolean
          km_end?: number | null
          km_review_notes?: string | null
          km_review_status?: string | null
          km_start?: number | null
          last_recalculated_at?: string | null
          loads_count?: number | null
          manual_adjustments_total?: number | null
          manual_reference_date?: string | null
          needs_recalculation?: boolean
          operational_balance?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_balance?: number
          pending_expenses_total?: number | null
          recalculation_reason?: string | null
          rejected_expenses_total?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_destination?: string | null
          route_name?: string | null
          route_origin?: string | null
          route_result?: number
          snapshot_json?: Json
          source_updated_at?: string | null
          status?: string
          stops_count?: number | null
          tenant_id: string
          total_freight_revenue?: number
          total_freight_value?: number | null
          total_goods_value?: number
          total_invoice_value?: number | null
          total_paid_amount?: number
          total_weight_kg?: number | null
          trip_completed_at?: string | null
          trip_started_at?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_expenses_total?: number | null
          approved_with_exception?: boolean
          audited_end_location?: string | null
          audited_km?: number | null
          audited_start_location?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_trip_id?: string | null
          documents_count?: number | null
          driver_credits_total?: number
          driver_debits_total?: number
          driver_id?: string | null
          driver_payable_amount?: number
          driver_reimbursement_total?: number
          estimated_km?: number | null
          exception_reason?: string | null
          expenses_total?: number | null
          final_amount?: number | null
          id?: string
          invoice_balance?: number | null
          is_manual?: boolean
          km_end?: number | null
          km_review_notes?: string | null
          km_review_status?: string | null
          km_start?: number | null
          last_recalculated_at?: string | null
          loads_count?: number | null
          manual_adjustments_total?: number | null
          manual_reference_date?: string | null
          needs_recalculation?: boolean
          operational_balance?: number | null
          paid_at?: string | null
          paid_by?: string | null
          payment_balance?: number
          pending_expenses_total?: number | null
          recalculation_reason?: string | null
          rejected_expenses_total?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_destination?: string | null
          route_name?: string | null
          route_origin?: string | null
          route_result?: number
          snapshot_json?: Json
          source_updated_at?: string | null
          status?: string
          stops_count?: number | null
          tenant_id?: string
          total_freight_revenue?: number
          total_freight_value?: number | null
          total_goods_value?: number
          total_invoice_value?: number | null
          total_paid_amount?: number
          total_weight_kg?: number | null
          trip_completed_at?: string | null
          trip_started_at?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
      employee_advances: {
        Row: {
          advance_date: string
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          employee_id: string
          financial_obligation_id: string | null
          id: string
          paid_at: string | null
          paid_by: string | null
          payable_id: string | null
          payment_method: string | null
          payment_reference: string | null
          reason: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          advance_date?: string
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          employee_id: string
          financial_obligation_id?: string | null
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payable_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          reason?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          advance_date?: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          employee_id?: string
          financial_obligation_id?: string | null
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payable_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          reason?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_advances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_advances_financial_obligation_id_fkey"
            columns: ["financial_obligation_id"]
            isOneToOne: false
            referencedRelation: "financial_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_advances_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_advances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_contracts: {
        Row: {
          active: boolean
          bank_info: Json
          base_salary: number
          branch: string | null
          commission_rate: number
          contract_type: string
          cost_center: string | null
          created_at: string
          created_by: string | null
          daily_rate: number
          department: string | null
          employee_id: string
          employment_regime: string | null
          end_date: string | null
          hourly_rate: number
          id: string
          notes: string | null
          payment_cycle: string
          payment_method: string | null
          position_title: string | null
          start_date: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          bank_info?: Json
          base_salary?: number
          branch?: string | null
          commission_rate?: number
          contract_type?: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          department?: string | null
          employee_id: string
          employment_regime?: string | null
          end_date?: string | null
          hourly_rate?: number
          id?: string
          notes?: string | null
          payment_cycle?: string
          payment_method?: string | null
          position_title?: string | null
          start_date: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          bank_info?: Json
          base_salary?: number
          branch?: string | null
          commission_rate?: number
          contract_type?: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          department?: string | null
          employee_id?: string
          employment_regime?: string | null
          end_date?: string | null
          hourly_rate?: number
          id?: string
          notes?: string | null
          payment_cycle?: string
          payment_method?: string | null
          position_title?: string | null
          start_date?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contracts_tenant_id_fkey"
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
      employee_incident_actions: {
        Row: {
          action_type: string
          amount: number
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          effective_date: string | null
          employee_id: string
          id: string
          incident_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          action_type: string
          amount?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_date?: string | null
          employee_id: string
          id?: string
          incident_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          action_type?: string
          amount?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_date?: string | null
          employee_id?: string
          id?: string
          incident_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_incident_actions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_incident_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_incident_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      financial_matches: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          amount_matched: number
          bank_transaction_id: string
          confidence_score: number | null
          created_at: string
          created_by: string | null
          financial_obligation_id: string
          id: string
          match_type: string
          reason: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          amount_matched: number
          bank_transaction_id: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          financial_obligation_id: string
          id?: string
          match_type?: string
          reason?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          amount_matched?: number
          bank_transaction_id?: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          financial_obligation_id?: string
          id?: string
          match_type?: string
          reason?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_matches_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_matches_financial_obligation_id_fkey"
            columns: ["financial_obligation_id"]
            isOneToOne: false
            referencedRelation: "financial_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_matches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_obligations: {
        Row: {
          amount_expected: number
          amount_matched: number
          bank_account_id: string | null
          competence_date: string | null
          counterparty_id: string | null
          counterparty_name: string | null
          counterparty_type: string | null
          created_at: string
          created_by: string | null
          description: string | null
          direction: string
          due_date: string | null
          expected_payment_date: string | null
          id: string
          matching_status: string
          metadata: Json
          obligation_type: string
          open_balance: number | null
          payment_method_expected: string | null
          source_id: string | null
          source_table: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_expected?: number
          amount_matched?: number
          bank_account_id?: string | null
          competence_date?: string | null
          counterparty_id?: string | null
          counterparty_name?: string | null
          counterparty_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction: string
          due_date?: string | null
          expected_payment_date?: string | null
          id?: string
          matching_status?: string
          metadata?: Json
          obligation_type: string
          open_balance?: number | null
          payment_method_expected?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_expected?: number
          amount_matched?: number
          bank_account_id?: string | null
          competence_date?: string | null
          counterparty_id?: string | null
          counterparty_name?: string | null
          counterparty_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction?: string
          due_date?: string | null
          expected_payment_date?: string | null
          id?: string
          matching_status?: string
          metadata?: Json
          obligation_type?: string
          open_balance?: number | null
          payment_method_expected?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_obligations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_obligations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          control_lot: string | null
          created_at: string
          created_by: string | null
          cte_consignee_client_id: string | null
          cte_driver_id: string | null
          cte_emitted_at: string | null
          cte_emitted_outbound_id: string | null
          cte_payload: Json | null
          cte_taker_role: string | null
          cte_vehicle_id: string | null
          delivery_meta: Json
          document_type: string
          dynamic_lot: string | null
          emission_id: string | null
          emitter_id: string | null
          fiscal_model: string | null
          freight_breakdown: Json | null
          freight_cif_value: number | null
          freight_confirmed_at: string | null
          freight_confirmed_by: string | null
          freight_fob_value: number | null
          freight_overridden: boolean
          freight_overridden_at: string | null
          freight_overridden_by: string | null
          freight_override_reason: string | null
          freight_table_id: string | null
          freight_value: number | null
          freight_value_original: number | null
          hub_document_id: string | null
          ibs_base: number | null
          ibs_rate: number | null
          ibs_value: number | null
          id: string
          import_batch_id: string | null
          imported_at: string | null
          imported_note_status: string | null
          insurance_premium: number | null
          insured_amount: number | null
          insurer_cnpj: string | null
          insurer_endorsement: string | null
          insurer_name: string | null
          insurer_policy: string | null
          invoice_number: string | null
          invoice_series: string | null
          issue_date: string | null
          load_id: string | null
          nfse_emitted_at: string | null
          nfse_emitted_document_id: string | null
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          order_id: string | null
          origin_city: string | null
          origin_state: string | null
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
          remitter_ie_indicator: string | null
          remitter_state_registration: string | null
          sefaz_message: string | null
          sefaz_protocol: string | null
          sefaz_status: string | null
          sefaz_status_code: string | null
          status: string
          supplier_id: string | null
          tenant_id: string
          updated_at: string
          value: number | null
          volume_count: number | null
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
          control_lot?: string | null
          created_at?: string
          created_by?: string | null
          cte_consignee_client_id?: string | null
          cte_driver_id?: string | null
          cte_emitted_at?: string | null
          cte_emitted_outbound_id?: string | null
          cte_payload?: Json | null
          cte_taker_role?: string | null
          cte_vehicle_id?: string | null
          delivery_meta?: Json
          document_type?: string
          dynamic_lot?: string | null
          emission_id?: string | null
          emitter_id?: string | null
          fiscal_model?: string | null
          freight_breakdown?: Json | null
          freight_cif_value?: number | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_fob_value?: number | null
          freight_overridden?: boolean
          freight_overridden_at?: string | null
          freight_overridden_by?: string | null
          freight_override_reason?: string | null
          freight_table_id?: string | null
          freight_value?: number | null
          freight_value_original?: number | null
          hub_document_id?: string | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          imported_note_status?: string | null
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
          invoice_number?: string | null
          invoice_series?: string | null
          issue_date?: string | null
          load_id?: string | null
          nfse_emitted_at?: string | null
          nfse_emitted_document_id?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          order_id?: string | null
          origin_city?: string | null
          origin_state?: string | null
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
          remitter_ie_indicator?: string | null
          remitter_state_registration?: string | null
          sefaz_message?: string | null
          sefaz_protocol?: string | null
          sefaz_status?: string | null
          sefaz_status_code?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id: string
          updated_at?: string
          value?: number | null
          volume_count?: number | null
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
          control_lot?: string | null
          created_at?: string
          created_by?: string | null
          cte_consignee_client_id?: string | null
          cte_driver_id?: string | null
          cte_emitted_at?: string | null
          cte_emitted_outbound_id?: string | null
          cte_payload?: Json | null
          cte_taker_role?: string | null
          cte_vehicle_id?: string | null
          delivery_meta?: Json
          document_type?: string
          dynamic_lot?: string | null
          emission_id?: string | null
          emitter_id?: string | null
          fiscal_model?: string | null
          freight_breakdown?: Json | null
          freight_cif_value?: number | null
          freight_confirmed_at?: string | null
          freight_confirmed_by?: string | null
          freight_fob_value?: number | null
          freight_overridden?: boolean
          freight_overridden_at?: string | null
          freight_overridden_by?: string | null
          freight_override_reason?: string | null
          freight_table_id?: string | null
          freight_value?: number | null
          freight_value_original?: number | null
          hub_document_id?: string | null
          ibs_base?: number | null
          ibs_rate?: number | null
          ibs_value?: number | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          imported_note_status?: string | null
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
          invoice_number?: string | null
          invoice_series?: string | null
          issue_date?: string | null
          load_id?: string | null
          nfse_emitted_at?: string | null
          nfse_emitted_document_id?: string | null
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          order_id?: string | null
          origin_city?: string | null
          origin_state?: string | null
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
          remitter_ie_indicator?: string | null
          remitter_state_registration?: string | null
          sefaz_message?: string | null
          sefaz_protocol?: string | null
          sefaz_status?: string | null
          sefaz_status_code?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          updated_at?: string
          value?: number | null
          volume_count?: number | null
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
            foreignKeyName: "fiscal_documents_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
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
            foreignKeyName: "fiscal_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      hub_fiscal_credentials: {
        Row: {
          created_at: string
          doc_scope: string
          emitter_id: string
          enabled: boolean
          environment: string
          id: string
          metadata: Json
          secret_ciphertext: string | null
          secret_hint: string | null
          secret_name: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_scope?: string
          emitter_id: string
          enabled?: boolean
          environment?: string
          id?: string
          metadata?: Json
          secret_ciphertext?: string | null
          secret_hint?: string | null
          secret_name?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_scope?: string
          emitter_id?: string
          enabled?: boolean
          environment?: string
          id?: string
          metadata?: Json
          secret_ciphertext?: string | null
          secret_hint?: string | null
          secret_name?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_fiscal_credentials_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_fiscal_credentials_tenant_id_fkey"
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
          emitter_id: string | null
          environment: string
          external_id: string | null
          fiscal_document_id: string | null
          hub_document_id: string | null
          id: string
          id_integracao: string | null
          insurance_premium: number | null
          insured_amount: number | null
          insurer_cnpj: string | null
          insurer_endorsement: string | null
          insurer_name: string | null
          insurer_policy: string | null
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
          emitter_id?: string | null
          environment?: string
          external_id?: string | null
          fiscal_document_id?: string | null
          hub_document_id?: string | null
          id?: string
          id_integracao?: string | null
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
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
          emitter_id?: string | null
          environment?: string
          external_id?: string | null
          fiscal_document_id?: string | null
          hub_document_id?: string | null
          id?: string
          id_integracao?: string | null
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
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
            foreignKeyName: "hub_fiscal_emissions_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
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
      imported_note_summary_reports: {
        Row: {
          created_at: string
          filters: Json
          generated_at: string
          generated_by: string | null
          grouped: boolean
          id: string
          pdf_snapshot: Json
          report_type: string
          row_count: number
          tenant_id: string
          total_invoice_value: number
          total_volume: number
          total_weight_kg: number
        }
        Insert: {
          created_at?: string
          filters?: Json
          generated_at?: string
          generated_by?: string | null
          grouped?: boolean
          id?: string
          pdf_snapshot?: Json
          report_type: string
          row_count?: number
          tenant_id: string
          total_invoice_value?: number
          total_volume?: number
          total_weight_kg?: number
        }
        Update: {
          created_at?: string
          filters?: Json
          generated_at?: string
          generated_by?: string | null
          grouped?: boolean
          id?: string
          pdf_snapshot?: Json
          report_type?: string
          row_count?: number
          tenant_id?: string
          total_invoice_value?: number
          total_volume?: number
          total_weight_kg?: number
        }
        Relationships: []
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
          access_key: string | null
          cargo_value: number
          created_at: string
          cte_document_id: string | null
          destination_city: string | null
          destination_state: string | null
          document_number: string | null
          document_type: string
          fiscal_document_id: string
          freight_value: number
          id: string
          issue_date: string | null
          issuer_cnpj: string | null
          issuer_name: string | null
          load_id: string
          metadata: Json
          origin_city: string | null
          origin_state: string | null
          recipient_cnpj: string | null
          recipient_name: string | null
          tenant_id: string
          volume_count: number
          weight_kg: number
        }
        Insert: {
          access_key?: string | null
          cargo_value?: number
          created_at?: string
          cte_document_id?: string | null
          destination_city?: string | null
          destination_state?: string | null
          document_number?: string | null
          document_type?: string
          fiscal_document_id: string
          freight_value?: number
          id?: string
          issue_date?: string | null
          issuer_cnpj?: string | null
          issuer_name?: string | null
          load_id: string
          metadata?: Json
          origin_city?: string | null
          origin_state?: string | null
          recipient_cnpj?: string | null
          recipient_name?: string | null
          tenant_id: string
          volume_count?: number
          weight_kg?: number
        }
        Update: {
          access_key?: string | null
          cargo_value?: number
          created_at?: string
          cte_document_id?: string | null
          destination_city?: string | null
          destination_state?: string | null
          document_number?: string | null
          document_type?: string
          fiscal_document_id?: string
          freight_value?: number
          id?: string
          issue_date?: string | null
          issuer_cnpj?: string | null
          issuer_name?: string | null
          load_id?: string
          metadata?: Json
          origin_city?: string | null
          origin_state?: string | null
          recipient_cnpj?: string | null
          recipient_name?: string | null
          tenant_id?: string
          volume_count?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "load_documents_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
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
      load_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          duplicated_count: number
          error_count: number
          errors: Json
          file_count: number
          file_name: string | null
          id: string
          imported_count: number
          metadata: Json
          parsed_count: number
          source_type: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duplicated_count?: number
          error_count?: number
          errors?: Json
          file_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          parsed_count?: number
          source_type: string
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duplicated_count?: number
          error_count?: number
          errors?: Json
          file_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          parsed_count?: number
          source_type?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
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
      load_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          created_at: string
          created_by: string | null
          id: string
          load_id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          receivable_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          load_id: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
          receivable_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          load_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          receivable_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_payments_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      load_status_history: {
        Row: {
          created_at: string
          created_by: string | null
          field_name: string
          id: string
          load_id: string
          new_value: string | null
          old_value: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_name: string
          id?: string
          load_id: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_name?: string
          id?: string
          load_id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_status_history_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      load_unloading_charges: {
        Row: {
          amount: number
          city: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          fiscal_document_id: string | null
          id: string
          import_batch_id: string | null
          invoice_number: string | null
          load_id: string | null
          metadata: Json
          service_date: string | null
          status: string
          supplier_name: string | null
          tenant_id: string
        }
        Insert: {
          amount?: number
          city?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_id?: string | null
          id?: string
          import_batch_id?: string | null
          invoice_number?: string | null
          load_id?: string | null
          metadata?: Json
          service_date?: string | null
          status?: string
          supplier_name?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          city?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_document_id?: string | null
          id?: string
          import_batch_id?: string | null
          invoice_number?: string | null
          load_id?: string | null
          metadata?: Json
          service_date?: string | null
          status?: string
          supplier_name?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_unloading_charges_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_unloading_charges_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "load_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_unloading_charges_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          actual_load_at: string | null
          arrival_at: string | null
          arrival_date: string | null
          billing_status: string | null
          cash_to_receive: number
          ciot: string | null
          client_invoice_id: string | null
          closed_at: string | null
          closing_report_id: string | null
          closing_report_number: string | null
          closing_status: string | null
          control_load_number: string | null
          created_at: string
          created_by: string | null
          cte_count: number
          dedicated_vehicle: boolean
          destination: string | null
          distribution_manifest: string | null
          doccob_export_id: string | null
          driver_id: string | null
          driver_type: string | null
          estimated_arrival_at: string | null
          expected_payment_date: string | null
          external_load_number: string | null
          freight_amount: number
          freight_percent: number | null
          gate_departure_at: string | null
          gross_cargo_value: number
          held_at: string | null
          held_by: string | null
          hold_reason: string | null
          id: string
          invoice_count: number
          last_import_batch_id: string | null
          legacy_status_text: string | null
          load_date: string | null
          load_number: string
          merchandise_value: number | null
          monitor_responsible: string | null
          monitored: boolean
          notes: string | null
          occurrence_at: string | null
          occurrence_notes: string | null
          occurrence_responsible: string | null
          on_hold: boolean
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          operational_status: string | null
          origin: string | null
          origin_manifest: string | null
          os_number: string | null
          payment_date: string | null
          payment_method: string | null
          payment_status: string
          pix_to_receive: number
          receivable_id: string | null
          received_amount: number
          schedule_at: string | null
          scheduled_load_at: string | null
          shipment_manifest: string | null
          sm_manager: string | null
          sm_release: string | null
          source_origin: string | null
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
          arrival_date?: string | null
          billing_status?: string | null
          cash_to_receive?: number
          ciot?: string | null
          client_invoice_id?: string | null
          closed_at?: string | null
          closing_report_id?: string | null
          closing_report_number?: string | null
          closing_status?: string | null
          control_load_number?: string | null
          created_at?: string
          created_by?: string | null
          cte_count?: number
          dedicated_vehicle?: boolean
          destination?: string | null
          distribution_manifest?: string | null
          doccob_export_id?: string | null
          driver_id?: string | null
          driver_type?: string | null
          estimated_arrival_at?: string | null
          expected_payment_date?: string | null
          external_load_number?: string | null
          freight_amount?: number
          freight_percent?: number | null
          gate_departure_at?: string | null
          gross_cargo_value?: number
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          invoice_count?: number
          last_import_batch_id?: string | null
          legacy_status_text?: string | null
          load_date?: string | null
          load_number: string
          merchandise_value?: number | null
          monitor_responsible?: string | null
          monitored?: boolean
          notes?: string | null
          occurrence_at?: string | null
          occurrence_notes?: string | null
          occurrence_responsible?: string | null
          on_hold?: boolean
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          operational_status?: string | null
          origin?: string | null
          origin_manifest?: string | null
          os_number?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string
          pix_to_receive?: number
          receivable_id?: string | null
          received_amount?: number
          schedule_at?: string | null
          scheduled_load_at?: string | null
          shipment_manifest?: string | null
          sm_manager?: string | null
          sm_release?: string | null
          source_origin?: string | null
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
          arrival_date?: string | null
          billing_status?: string | null
          cash_to_receive?: number
          ciot?: string | null
          client_invoice_id?: string | null
          closed_at?: string | null
          closing_report_id?: string | null
          closing_report_number?: string | null
          closing_status?: string | null
          control_load_number?: string | null
          created_at?: string
          created_by?: string | null
          cte_count?: number
          dedicated_vehicle?: boolean
          destination?: string | null
          distribution_manifest?: string | null
          doccob_export_id?: string | null
          driver_id?: string | null
          driver_type?: string | null
          estimated_arrival_at?: string | null
          expected_payment_date?: string | null
          external_load_number?: string | null
          freight_amount?: number
          freight_percent?: number | null
          gate_departure_at?: string | null
          gross_cargo_value?: number
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          invoice_count?: number
          last_import_batch_id?: string | null
          legacy_status_text?: string | null
          load_date?: string | null
          load_number?: string
          merchandise_value?: number | null
          monitor_responsible?: string | null
          monitored?: boolean
          notes?: string | null
          occurrence_at?: string | null
          occurrence_notes?: string | null
          occurrence_responsible?: string | null
          on_hold?: boolean
          operation_type?: Database["public"]["Enums"]["operation_type"] | null
          operational_status?: string | null
          origin?: string | null
          origin_manifest?: string | null
          os_number?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string
          pix_to_receive?: number
          receivable_id?: string | null
          received_amount?: number
          schedule_at?: string | null
          scheduled_load_at?: string | null
          shipment_manifest?: string | null
          sm_manager?: string | null
          sm_release?: string | null
          source_origin?: string | null
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
          cost_center: string | null
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
          cost_center?: string | null
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
          cost_center?: string | null
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
      merchandise_shortage_cases: {
        Row: {
          amount_reimbursed: number
          amount_to_charge: number
          amount_written_off: number
          cancellation_reason: string | null
          cancelled_at: string | null
          city: string | null
          closed_at: string | null
          company_client_id: string | null
          company_name_snapshot: string | null
          created_at: string
          created_by: string | null
          cte_document_id: string | null
          cte_number: string | null
          customer_id: string | null
          customer_name_snapshot: string | null
          driver_id: string | null
          driver_name_snapshot: string | null
          fiscal_document_id: string | null
          id: string
          import_batch_id: string | null
          investigation_notes: string | null
          invoice_number: string | null
          load_id: string | null
          load_number: string | null
          metadata: Json
          observation: string | null
          occurrence_date: string
          occurrence_id: string | null
          resolved_at: string | null
          responsibility_notes: string | null
          responsible_client_id: string | null
          responsible_driver_id: string | null
          responsible_party_type: string | null
          responsible_supplier_id: string | null
          shortage_number: string | null
          shortage_type: string | null
          source_type: string
          state: string | null
          status: string
          supplier_id: string | null
          supplier_name_snapshot: string | null
          tenant_id: string
          total_amount: number
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
          vehicle_plate_snapshot: string | null
        }
        Insert: {
          amount_reimbursed?: number
          amount_to_charge?: number
          amount_written_off?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          city?: string | null
          closed_at?: string | null
          company_client_id?: string | null
          company_name_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          cte_number?: string | null
          customer_id?: string | null
          customer_name_snapshot?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          fiscal_document_id?: string | null
          id?: string
          import_batch_id?: string | null
          investigation_notes?: string | null
          invoice_number?: string | null
          load_id?: string | null
          load_number?: string | null
          metadata?: Json
          observation?: string | null
          occurrence_date: string
          occurrence_id?: string | null
          resolved_at?: string | null
          responsibility_notes?: string | null
          responsible_client_id?: string | null
          responsible_driver_id?: string | null
          responsible_party_type?: string | null
          responsible_supplier_id?: string | null
          shortage_number?: string | null
          shortage_type?: string | null
          source_type?: string
          state?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          tenant_id: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Update: {
          amount_reimbursed?: number
          amount_to_charge?: number
          amount_written_off?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          city?: string | null
          closed_at?: string | null
          company_client_id?: string | null
          company_name_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          cte_document_id?: string | null
          cte_number?: string | null
          customer_id?: string | null
          customer_name_snapshot?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          fiscal_document_id?: string | null
          id?: string
          import_batch_id?: string | null
          investigation_notes?: string | null
          invoice_number?: string | null
          load_id?: string | null
          load_number?: string | null
          metadata?: Json
          observation?: string | null
          occurrence_date?: string
          occurrence_id?: string | null
          resolved_at?: string | null
          responsibility_notes?: string | null
          responsible_client_id?: string | null
          responsible_driver_id?: string | null
          responsible_party_type?: string | null
          responsible_supplier_id?: string | null
          shortage_number?: string | null
          shortage_type?: string | null
          source_type?: string
          state?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchandise_shortage_cases_company_client_id_fkey"
            columns: ["company_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_cte_document_id_fkey"
            columns: ["cte_document_id"]
            isOneToOne: false
            referencedRelation: "cte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "delivery_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_responsible_client_id_fkey"
            columns: ["responsible_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_responsible_driver_id_fkey"
            columns: ["responsible_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_responsible_supplier_id_fkey"
            columns: ["responsible_supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_cases_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchandise_shortage_history: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          metadata: Json
          new_value: string | null
          old_value: string | null
          reason: string | null
          shortage_case_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          shortage_case_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          shortage_case_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchandise_shortage_history_shortage_case_id_fkey"
            columns: ["shortage_case_id"]
            isOneToOne: false
            referencedRelation: "merchandise_shortage_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      merchandise_shortage_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          errors: Json
          file_name: string | null
          id: string
          imported_count: number
          metadata: Json
          row_count: number
          status: string
          tenant_id: string
          unmatched_count: number
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id: string
          unmatched_count?: number
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id?: string
          unmatched_count?: number
          updated_count?: number
        }
        Relationships: []
      }
      merchandise_shortage_items: {
        Row: {
          created_at: string
          id: string
          item_observation: string | null
          metadata: Json
          occurrence_item_id: string | null
          product_code: string | null
          product_description: string
          quantity: number | null
          quantity_text: string | null
          shortage_case_id: string
          sort_order: number
          tenant_id: string
          total_amount: number
          unit: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_observation?: string | null
          metadata?: Json
          occurrence_item_id?: string | null
          product_code?: string | null
          product_description: string
          quantity?: number | null
          quantity_text?: string | null
          shortage_case_id: string
          sort_order?: number
          tenant_id: string
          total_amount?: number
          unit?: string | null
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_observation?: string | null
          metadata?: Json
          occurrence_item_id?: string | null
          product_code?: string | null
          product_description?: string
          quantity?: number | null
          quantity_text?: string | null
          shortage_case_id?: string
          sort_order?: number
          tenant_id?: string
          total_amount?: number
          unit?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "merchandise_shortage_items_shortage_case_id_fkey"
            columns: ["shortage_case_id"]
            isOneToOne: false
            referencedRelation: "merchandise_shortage_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      merchandise_shortage_report_items: {
        Row: {
          city: string | null
          company_name: string | null
          created_at: string
          customer_name: string | null
          driver_name: string | null
          id: string
          invoice_number: string | null
          metadata: Json
          observation: string | null
          occurrence_date: string | null
          product_description: string | null
          quantity: number | null
          quantity_text: string | null
          report_id: string
          responsible_party_type: string | null
          shortage_case_id: string | null
          shortage_item_id: string | null
          sort_order: number
          status: string | null
          tenant_id: string
          total_amount: number | null
          unit: string | null
          unit_cost: number | null
        }
        Insert: {
          city?: string | null
          company_name?: string | null
          created_at?: string
          customer_name?: string | null
          driver_name?: string | null
          id?: string
          invoice_number?: string | null
          metadata?: Json
          observation?: string | null
          occurrence_date?: string | null
          product_description?: string | null
          quantity?: number | null
          quantity_text?: string | null
          report_id: string
          responsible_party_type?: string | null
          shortage_case_id?: string | null
          shortage_item_id?: string | null
          sort_order?: number
          status?: string | null
          tenant_id: string
          total_amount?: number | null
          unit?: string | null
          unit_cost?: number | null
        }
        Update: {
          city?: string | null
          company_name?: string | null
          created_at?: string
          customer_name?: string | null
          driver_name?: string | null
          id?: string
          invoice_number?: string | null
          metadata?: Json
          observation?: string | null
          occurrence_date?: string | null
          product_description?: string | null
          quantity?: number | null
          quantity_text?: string | null
          report_id?: string
          responsible_party_type?: string | null
          shortage_case_id?: string | null
          shortage_item_id?: string | null
          sort_order?: number
          status?: string | null
          tenant_id?: string
          total_amount?: number | null
          unit?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "merchandise_shortage_report_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "merchandise_shortage_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_report_items_shortage_case_id_fkey"
            columns: ["shortage_case_id"]
            isOneToOne: false
            referencedRelation: "merchandise_shortage_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchandise_shortage_report_items_shortage_item_id_fkey"
            columns: ["shortage_item_id"]
            isOneToOne: false
            referencedRelation: "merchandise_shortage_items"
            referencedColumns: ["id"]
          },
        ]
      }
      merchandise_shortage_reports: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          closed_at: string | null
          created_at: string
          csv_url: string | null
          excel_url: string | null
          filters_snapshot: Json
          generated_by: string | null
          generated_snapshot: Json
          id: string
          pdf_url: string | null
          period_end: string
          period_start: string
          report_month: number
          report_number: string
          report_year: number
          sent_at: string | null
          sent_channel: string | null
          sent_notes: string | null
          sent_to: string | null
          status: string
          tenant_id: string
          title: string
          total_amount: number
          total_cases: number
          total_items: number
          total_reimbursed: number
          total_to_charge: number
          total_written_off: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          csv_url?: string | null
          excel_url?: string | null
          filters_snapshot?: Json
          generated_by?: string | null
          generated_snapshot?: Json
          id?: string
          pdf_url?: string | null
          period_end: string
          period_start: string
          report_month: number
          report_number: string
          report_year: number
          sent_at?: string | null
          sent_channel?: string | null
          sent_notes?: string | null
          sent_to?: string | null
          status?: string
          tenant_id: string
          title: string
          total_amount?: number
          total_cases?: number
          total_items?: number
          total_reimbursed?: number
          total_to_charge?: number
          total_written_off?: number
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          csv_url?: string | null
          excel_url?: string | null
          filters_snapshot?: Json
          generated_by?: string | null
          generated_snapshot?: Json
          id?: string
          pdf_url?: string | null
          period_end?: string
          period_start?: string
          report_month?: number
          report_number?: string
          report_year?: number
          sent_at?: string | null
          sent_channel?: string | null
          sent_notes?: string | null
          sent_to?: string | null
          status?: string
          tenant_id?: string
          title?: string
          total_amount?: number
          total_cases?: number
          total_items?: number
          total_reimbursed?: number
          total_to_charge?: number
          total_written_off?: number
        }
        Relationships: []
      }
      merchandise_shortage_sequences: {
        Row: {
          next_number: number
          sequence_year: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          sequence_year: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          sequence_year?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
          cliente_cod_municipio: string | null
          cliente_complemento: string | null
          cliente_email: string | null
          cliente_endereco: string | null
          cliente_id: string | null
          cliente_ie: string | null
          cliente_im: string | null
          cliente_municipio: string | null
          cliente_nome: string | null
          cliente_numero: string | null
          cliente_telefone: string | null
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
          emitter_id: string | null
          fiscal_document_ids: string[] | null
          id: string
          insurance_premium: number | null
          insured_amount: number | null
          insurer_cnpj: string | null
          insurer_endorsement: string | null
          insurer_name: string | null
          insurer_policy: string | null
          internal_number: string | null
          invoice_number: string | null
          is_preview: boolean
          iss_retido: boolean
          issue_date: string
          items: Json
          last_status_check_at: string | null
          last_status_response: Json | null
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
          status_check_attempts: number
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
          cliente_cod_municipio?: string | null
          cliente_complemento?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: string | null
          cliente_ie?: string | null
          cliente_im?: string | null
          cliente_municipio?: string | null
          cliente_nome?: string | null
          cliente_numero?: string | null
          cliente_telefone?: string | null
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
          emitter_id?: string | null
          fiscal_document_ids?: string[] | null
          id?: string
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
          internal_number?: string | null
          invoice_number?: string | null
          is_preview?: boolean
          iss_retido?: boolean
          issue_date?: string
          items?: Json
          last_status_check_at?: string | null
          last_status_response?: Json | null
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
          status_check_attempts?: number
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
          cliente_cod_municipio?: string | null
          cliente_complemento?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: string | null
          cliente_ie?: string | null
          cliente_im?: string | null
          cliente_municipio?: string | null
          cliente_nome?: string | null
          cliente_numero?: string | null
          cliente_telefone?: string | null
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
          emitter_id?: string | null
          fiscal_document_ids?: string[] | null
          id?: string
          insurance_premium?: number | null
          insured_amount?: number | null
          insurer_cnpj?: string | null
          insurer_endorsement?: string | null
          insurer_name?: string | null
          insurer_policy?: string | null
          internal_number?: string | null
          invoice_number?: string | null
          is_preview?: boolean
          iss_retido?: boolean
          issue_date?: string
          items?: Json
          last_status_check_at?: string | null
          last_status_response?: Json | null
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
          status_check_attempts?: number
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
        Relationships: [
          {
            foreignKeyName: "nfse_documents_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
            referencedColumns: ["id"]
          },
        ]
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
          emitter_id: string | null
          id: string
          next_number: number
          series: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_code?: string
          created_at?: string
          emitter_id?: string | null
          id?: string
          next_number?: number
          series?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_code?: string
          created_at?: string
          emitter_id?: string | null
          id?: string
          next_number?: number
          series?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfse_sequences_emitter_id_fkey"
            columns: ["emitter_id"]
            isOneToOne: false
            referencedRelation: "tenant_emitters"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_report_export_items: {
        Row: {
          city: string | null
          created_at: string
          cte_number: string | null
          customer_name: string | null
          export_id: string
          fiscal_document_id: string | null
          id: string
          invoice_issue_date: string | null
          invoice_number: string | null
          invoice_value: number
          metadata: Json
          notes: string | null
          occurrence_date: string | null
          occurrence_id: string | null
          occurrence_number: string | null
          occurrence_type: string | null
          password_or_authorization: string | null
          product_description: string | null
          quantity_text: string | null
          reason: string | null
          resolution_type: string | null
          sort_order: number
          state: string | null
          supplier_name: string | null
          tenant_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          cte_number?: string | null
          customer_name?: string | null
          export_id: string
          fiscal_document_id?: string | null
          id?: string
          invoice_issue_date?: string | null
          invoice_number?: string | null
          invoice_value?: number
          metadata?: Json
          notes?: string | null
          occurrence_date?: string | null
          occurrence_id?: string | null
          occurrence_number?: string | null
          occurrence_type?: string | null
          password_or_authorization?: string | null
          product_description?: string | null
          quantity_text?: string | null
          reason?: string | null
          resolution_type?: string | null
          sort_order?: number
          state?: string | null
          supplier_name?: string | null
          tenant_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          cte_number?: string | null
          customer_name?: string | null
          export_id?: string
          fiscal_document_id?: string | null
          id?: string
          invoice_issue_date?: string | null
          invoice_number?: string | null
          invoice_value?: number
          metadata?: Json
          notes?: string | null
          occurrence_date?: string | null
          occurrence_id?: string | null
          occurrence_number?: string | null
          occurrence_type?: string | null
          password_or_authorization?: string | null
          product_description?: string | null
          quantity_text?: string | null
          reason?: string | null
          resolution_type?: string | null
          sort_order?: number
          state?: string | null
          supplier_name?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_report_export_items_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "occurrence_report_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_report_export_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_report_export_items_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "delivery_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_report_exports: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          client_id: string | null
          created_at: string
          csv_url: string | null
          excel_url: string | null
          filters_snapshot: Json
          generated_by: string | null
          generated_snapshot: Json
          id: string
          invoice_count: number
          occurrence_count: number
          pdf_url: string | null
          period_end: string | null
          period_start: string | null
          report_type: string
          row_count: number
          sent_at: string | null
          sent_channel: string | null
          sent_notes: string | null
          sent_to: string | null
          status: string
          supplier_id: string | null
          tenant_id: string
          title: string
          total_invoice_value: number
          total_quantity: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          created_at?: string
          csv_url?: string | null
          excel_url?: string | null
          filters_snapshot?: Json
          generated_by?: string | null
          generated_snapshot?: Json
          id?: string
          invoice_count?: number
          occurrence_count?: number
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type: string
          row_count?: number
          sent_at?: string | null
          sent_channel?: string | null
          sent_notes?: string | null
          sent_to?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id: string
          title: string
          total_invoice_value?: number
          total_quantity?: number
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          created_at?: string
          csv_url?: string | null
          excel_url?: string | null
          filters_snapshot?: Json
          generated_by?: string | null
          generated_snapshot?: Json
          id?: string
          invoice_count?: number
          occurrence_count?: number
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          report_type?: string
          row_count?: number
          sent_at?: string | null
          sent_channel?: string | null
          sent_notes?: string | null
          sent_to?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          title?: string
          total_invoice_value?: number
          total_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_report_exports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_report_exports_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_report_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          detected_model: string | null
          error_count: number
          errors: Json
          file_name: string | null
          id: string
          imported_count: number
          metadata: Json
          row_count: number
          source_type: string
          status: string
          tenant_id: string
          unmatched_count: number
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          detected_model?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          source_type?: string
          status?: string
          tenant_id: string
          unmatched_count?: number
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          detected_model?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          source_type?: string
          status?: string
          tenant_id?: string
          unmatched_count?: number
          updated_count?: number
        }
        Relationships: []
      }
      occurrence_return_sheet_history: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          metadata: Json
          new_value: string | null
          occurrence_id: string
          old_value: string | null
          reason: string | null
          return_sheet_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          occurrence_id: string
          old_value?: string | null
          reason?: string | null
          return_sheet_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          occurrence_id?: string
          old_value?: string | null
          reason?: string | null
          return_sheet_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_return_sheet_history_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "delivery_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_return_sheet_history_return_sheet_id_fkey"
            columns: ["return_sheet_id"]
            isOneToOne: false
            referencedRelation: "occurrence_return_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_return_sheet_sequences: {
        Row: {
          next_number: number
          sequence_year: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          sequence_year: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          sequence_year?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      occurrence_return_sheets: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          company_snapshot: Json
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          invoice_snapshot: Json
          occurrence_id: string
          occurrence_snapshot: Json
          pdf_url: string | null
          printed_at: string | null
          product_snapshot: Json
          receiver_document: string | null
          receiver_name: string | null
          sac_number: string | null
          sheet_number: string
          signed_at: string | null
          signed_proof_url: string | null
          status: string
          superseded_by: string | null
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_snapshot?: Json
          occurrence_id: string
          occurrence_snapshot?: Json
          pdf_url?: string | null
          printed_at?: string | null
          product_snapshot?: Json
          receiver_document?: string | null
          receiver_name?: string | null
          sac_number?: string | null
          sheet_number: string
          signed_at?: string | null
          signed_proof_url?: string | null
          status?: string
          superseded_by?: string | null
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_snapshot?: Json
          occurrence_id?: string
          occurrence_snapshot?: Json
          pdf_url?: string | null
          printed_at?: string | null
          product_snapshot?: Json
          receiver_document?: string | null
          receiver_name?: string | null
          sac_number?: string | null
          sheet_number?: string
          signed_at?: string | null
          signed_proof_url?: string | null
          status?: string
          superseded_by?: string | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_return_sheets_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "delivery_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_return_sheets_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "occurrence_return_sheets"
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
      pallet_return_history: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          field_name: string | null
          id: string
          metadata: Json
          new_value: string | null
          old_value: string | null
          protocol_id: string
          reason: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          protocol_id: string
          reason?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          protocol_id?: string
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pallet_return_history_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "pallet_return_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      pallet_return_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          errors: Json
          file_name: string | null
          id: string
          imported_count: number
          metadata: Json
          row_count: number
          status: string
          tenant_id: string
          unmatched_count: number
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id: string
          unmatched_count?: number
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id?: string
          unmatched_count?: number
          updated_count?: number
        }
        Relationships: []
      }
      pallet_return_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          pallet_color: string | null
          pallet_type_code: string
          pallet_type_id: string | null
          pallet_type_name: string
          protocol_id: string
          quantity: number
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          pallet_color?: string | null
          pallet_type_code: string
          pallet_type_id?: string | null
          pallet_type_name: string
          protocol_id: string
          quantity: number
          sort_order?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          pallet_color?: string | null
          pallet_type_code?: string
          pallet_type_id?: string | null
          pallet_type_name?: string
          protocol_id?: string
          quantity?: number
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pallet_return_items_pallet_type_id_fkey"
            columns: ["pallet_type_id"]
            isOneToOne: false
            referencedRelation: "pallet_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallet_return_items_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "pallet_return_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      pallet_return_protocols: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          company_snapshot: Json
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          driver_name_snapshot: string | null
          expected_return_date: string | null
          id: string
          issue_date: string
          load_id: string | null
          notes: string | null
          pdf_url: string | null
          protocol_number: string
          receiver_document: string | null
          receiver_name: string | null
          receiver_phone: string | null
          returned_at: string | null
          signature_date: string | null
          signed_proof_url: string | null
          status: string
          supplier_document_snapshot: string | null
          supplier_id: string | null
          supplier_name_snapshot: string
          tenant_id: string
          total_quantity: number
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
          vehicle_plate_snapshot: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          expected_return_date?: string | null
          id?: string
          issue_date?: string
          load_id?: string | null
          notes?: string | null
          pdf_url?: string | null
          protocol_number: string
          receiver_document?: string | null
          receiver_name?: string | null
          receiver_phone?: string | null
          returned_at?: string | null
          signature_date?: string | null
          signed_proof_url?: string | null
          status?: string
          supplier_document_snapshot?: string | null
          supplier_id?: string | null
          supplier_name_snapshot: string
          tenant_id: string
          total_quantity?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          driver_name_snapshot?: string | null
          expected_return_date?: string | null
          id?: string
          issue_date?: string
          load_id?: string | null
          notes?: string | null
          pdf_url?: string | null
          protocol_number?: string
          receiver_document?: string | null
          receiver_name?: string | null
          receiver_phone?: string | null
          returned_at?: string | null
          signature_date?: string | null
          signed_proof_url?: string | null
          status?: string
          supplier_document_snapshot?: string | null
          supplier_id?: string | null
          supplier_name_snapshot?: string
          tenant_id?: string
          total_quantity?: number
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          vehicle_plate_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pallet_return_protocols_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallet_return_protocols_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallet_return_protocols_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallet_return_protocols_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      pallet_return_sequences: {
        Row: {
          next_number: number
          sequence_year: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          sequence_year: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          sequence_year?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pallet_types: {
        Row: {
          code: string
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          metadata: Json
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payables: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          bank_account_id: string | null
          category: string
          competence_date: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dispatch_trip_id: string | null
          document_number: string | null
          driver_id: string | null
          due_date: string | null
          id: string
          load_id: string | null
          notes: string | null
          paid_amount: number
          paid_at: string | null
          receipt_url: string | null
          source: string
          source_id: string | null
          source_metadata: Json
          source_table: string | null
          status: string
          supplier_id: string | null
          supplier_name: string
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          category?: string
          competence_date?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_trip_id?: string | null
          document_number?: string | null
          driver_id?: string | null
          due_date?: string | null
          id?: string
          load_id?: string | null
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          receipt_url?: string | null
          source?: string
          source_id?: string | null
          source_metadata?: Json
          source_table?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name: string
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          category?: string
          competence_date?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dispatch_trip_id?: string | null
          document_number?: string | null
          driver_id?: string | null
          due_date?: string | null
          id?: string
          load_id?: string | null
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          receipt_url?: string | null
          source?: string
          source_id?: string | null
          source_metadata?: Json
          source_table?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_dispatch_trip_id_fkey"
            columns: ["dispatch_trip_id"]
            isOneToOne: false
            referencedRelation: "dispatch_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      payables_payments: {
        Row: {
          amount: number
          attachment_url: string | null
          bank_account_id: string
          bank_transaction_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          id: string
          method: string
          notes: string | null
          paid_at: string
          payable_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          bank_account_id: string
          bank_transaction_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          payable_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string
          bank_transaction_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          payable_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_payments_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          already_paid_amount: number
          amount_to_pay: number
          carryover_amount: number
          contract_id: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          driver_id: string | null
          employee_id: string
          entry_type: string
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          payment_status: string
          payroll_period_id: string
          source_summary: Json
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          already_paid_amount?: number
          amount_to_pay?: number
          carryover_amount?: number
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          driver_id?: string | null
          employee_id: string
          entry_type?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          payment_status?: string
          payroll_period_id: string
          source_summary?: Json
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          already_paid_amount?: number
          amount_to_pay?: number
          carryover_amount?: number
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          driver_id?: string | null
          employee_id?: string
          entry_type?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          payment_status?: string
          payroll_period_id?: string
          source_summary?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "employee_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_payroll_period_id_fkey"
            columns: ["payroll_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entry_items: {
        Row: {
          amount: number
          competence_date: string | null
          created_at: string
          created_by: string | null
          description: string
          driver_id: string | null
          employee_id: string
          id: string
          item_type: string
          locked: boolean
          nature: string
          occurred_at: string | null
          payroll_entry_id: string
          payroll_period_id: string
          quantity: number | null
          source_id: string | null
          source_metadata: Json
          source_table: string | null
          tenant_id: string
          unit_value: number | null
        }
        Insert: {
          amount?: number
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          driver_id?: string | null
          employee_id: string
          id?: string
          item_type: string
          locked?: boolean
          nature: string
          occurred_at?: string | null
          payroll_entry_id: string
          payroll_period_id: string
          quantity?: number | null
          source_id?: string | null
          source_metadata?: Json
          source_table?: string | null
          tenant_id: string
          unit_value?: number | null
        }
        Update: {
          amount?: number
          competence_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          driver_id?: string | null
          employee_id?: string
          id?: string
          item_type?: string
          locked?: boolean
          nature?: string
          occurred_at?: string | null
          payroll_entry_id?: string
          payroll_period_id?: string
          quantity?: number | null
          source_id?: string | null
          source_metadata?: Json
          source_table?: string | null
          tenant_id?: string
          unit_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entry_items_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_items_payroll_entry_id_fkey"
            columns: ["payroll_entry_id"]
            isOneToOne: false
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_items_payroll_period_id_fkey"
            columns: ["payroll_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_generation_issues: {
        Row: {
          created_at: string
          driver_id: string | null
          employee_id: string | null
          id: string
          issue_type: string
          message: string
          payroll_period_id: string | null
          resolved: boolean
          resolved_at: string | null
          severity: string
          source_id: string | null
          source_table: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          employee_id?: string | null
          id?: string
          issue_type: string
          message: string
          payroll_period_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          severity?: string
          source_id?: string | null
          source_table?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          employee_id?: string | null
          id?: string
          issue_type?: string
          message?: string
          payroll_period_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          severity?: string
          source_id?: string | null
          source_table?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          closed_by: string | null
          competence_month: string | null
          created_at: string
          created_by: string | null
          id: string
          include_drivers: boolean
          include_non_drivers: boolean
          notes: string | null
          payment_status: string
          period_end: string
          period_name: string
          period_start: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          competence_month?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          include_drivers?: boolean
          include_non_drivers?: boolean
          notes?: string | null
          payment_status?: string
          period_end: string
          period_name: string
          period_start: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          competence_month?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          include_drivers?: boolean
          include_non_drivers?: boolean
          notes?: string | null
          payment_status?: string
          period_end?: string
          period_name?: string
          period_start?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_tenant_id_fkey"
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
          client_invoice_id: string | null
          closing_report_id: string | null
          cost_center: string | null
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
          client_invoice_id?: string | null
          closing_report_id?: string | null
          cost_center?: string | null
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
          client_invoice_id?: string | null
          closing_report_id?: string | null
          cost_center?: string | null
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
      receivables_payments: {
        Row: {
          amount: number
          attachment_url: string | null
          bank_account_id: string
          bank_transaction_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          id: string
          method: string
          notes: string | null
          receivable_id: string
          received_at: string
          tenant_id: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          bank_account_id: string
          bank_transaction_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          receivable_id: string
          received_at?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string
          bank_transaction_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          notes?: string | null
          receivable_id?: string
          received_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_payments_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      rural_delivery_import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          errors: Json
          file_name: string | null
          id: string
          imported_count: number
          metadata: Json
          row_count: number
          status: string
          tenant_id: string
          unmatched_count: number
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id: string
          unmatched_count?: number
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          errors?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          metadata?: Json
          row_count?: number
          status?: string
          tenant_id?: string
          unmatched_count?: number
          updated_count?: number
        }
        Relationships: []
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
      tenant_emitters: {
        Row: {
          active: boolean
          branch_code: string
          city_code: string | null
          cnpj: string
          created_at: string
          endereco: Json
          id: string
          ie: string | null
          im: string | null
          is_default: boolean
          logo_url: string | null
          nome_fantasia: string | null
          razao_social: string
          regime_tributario: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_code?: string
          city_code?: string | null
          cnpj: string
          created_at?: string
          endereco?: Json
          id?: string
          ie?: string | null
          im?: string | null
          is_default?: boolean
          logo_url?: string | null
          nome_fantasia?: string | null
          razao_social: string
          regime_tributario?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_code?: string
          city_code?: string | null
          cnpj?: string
          created_at?: string
          endereco?: Json
          id?: string
          ie?: string | null
          im?: string | null
          is_default?: boolean
          logo_url?: string | null
          nome_fantasia?: string | null
          razao_social?: string
          regime_tributario?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_emitters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          plate_raw: string | null
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
          plate_raw?: string | null
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
          plate_raw?: string | null
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
      _apply_match_amounts: {
        Args: {
          _delta: number
          _obligation_id: string
          _transaction_id: string
        }
        Returns: undefined
      }
      _assert_driver_owns_trip: {
        Args: { _trip_id: string }
        Returns: {
          driver_id: string
          status: string
          tenant_id: string
        }[]
      }
      _build_driver_settlement: {
        Args: { _dispatch_trip_id: string; _tenant_id: string }
        Returns: string
      }
      _build_manual_driver_settlement: {
        Args: { _settlement_id: string }
        Returns: string
      }
      _driver_client_ids: { Args: never; Returns: string[] }
      _driver_fiscal_document_ids: { Args: never; Returns: string[] }
      _driver_load_ids: { Args: never; Returns: string[] }
      _driver_order_ids: { Args: never; Returns: string[] }
      _driver_pickup_order_ids: { Args: never; Returns: string[] }
      _driver_trip_ids: { Args: never; Returns: string[] }
      _load_available_for_settlement: {
        Args: {
          _allow_settlement_id?: string
          _load_id: string
          _tenant_id: string
        }
        Returns: boolean
      }
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
      _log_settlement_event: {
        Args: {
          _event_type: string
          _from_status?: string
          _payload?: Json
          _reason?: string
          _settlement_id: string
          _to_status?: string
        }
        Returns: undefined
      }
      _portal_assert_client_access: {
        Args: { _client_id: string; _tenant_id: string }
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
      accept_financial_match: {
        Args: { _match_id: string }
        Returns: undefined
      }
      add_driver_settlement_adjustment: {
        Args: {
          _amount: number
          _description: string
          _nature: string
          _reason: string
          _settlement_id: string
        }
        Returns: string
      }
      add_driver_settlement_manual_expense: {
        Args: {
          _amount: number
          _category: string
          _cost_center: string
          _expense_at: string
          _notes?: string
          _payment_source?: string
          _receipt_url?: string
          _reimbursable?: boolean
          _settlement_id: string
        }
        Returns: string
      }
      add_employee_incident_action: {
        Args: {
          _action_type: string
          _amount?: number
          _description?: string
          _effective_date?: string
          _employee_id: string
          _incident_id: string
        }
        Returns: string
      }
      add_payroll_manual_item: {
        Args: {
          _amount: number
          _description: string
          _entry_id: string
          _nature: string
          _reason: string
        }
        Returns: string
      }
      approve_payroll_period: {
        Args: { _period_id: string }
        Returns: undefined
      }
      assign_fiscal_documents_to_load: {
        Args: { _document_ids: string[]; _load_id: string; _tenant_id: string }
        Returns: Json
      }
      attach_loads_to_driver_settlement: {
        Args: { _load_ids: string[]; _settlement_id: string }
        Returns: undefined
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
      audit_data_consistency_v2: {
        Args: { _tenant_id: string }
        Returns: {
          domain: string
          entity_id: string
          entity_type: string
          message: string
          severity: string
          suggested_action: string
        }[]
      }
      cancel_client_invoice: {
        Args: { _invoice_id: string; _reason: string }
        Returns: undefined
      }
      cancel_client_pickup: {
        Args: { _pickup_id: string; _tenant_id: string }
        Returns: undefined
      }
      cancel_closing_report: {
        Args: { _closing_report_id: string; _reason: string }
        Returns: undefined
      }
      cancel_doccob_export: {
        Args: { _export_id: string; _reason: string; _tenant_id: string }
        Returns: undefined
      }
      cancel_occurrence_return_sheet: {
        Args: { _reason: string; _return_sheet_id: string }
        Returns: undefined
      }
      cancel_pallet_return_protocol: {
        Args: { _protocol_id: string; _reason: string }
        Returns: undefined
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
      client_is_rural: { Args: { _client_id: string }; Returns: boolean }
      close_closing_report: {
        Args: { _closing_report_id: string }
        Returns: undefined
      }
      close_payroll_period: {
        Args: { _period_id: string; _reason?: string }
        Returns: undefined
      }
      close_reconciliation_session: {
        Args: { _session_id: string }
        Returns: undefined
      }
      count_points_in_geofence: {
        Args: { _geofence_id: string; _points: Json }
        Returns: Json
      }
      create_client_invoice: { Args: { payload: Json }; Returns: string }
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
          arrival_date: string | null
          billing_status: string | null
          cash_to_receive: number
          ciot: string | null
          client_invoice_id: string | null
          closed_at: string | null
          closing_report_id: string | null
          closing_report_number: string | null
          closing_status: string | null
          control_load_number: string | null
          created_at: string
          created_by: string | null
          cte_count: number
          dedicated_vehicle: boolean
          destination: string | null
          distribution_manifest: string | null
          doccob_export_id: string | null
          driver_id: string | null
          driver_type: string | null
          estimated_arrival_at: string | null
          expected_payment_date: string | null
          external_load_number: string | null
          freight_amount: number
          freight_percent: number | null
          gate_departure_at: string | null
          gross_cargo_value: number
          held_at: string | null
          held_by: string | null
          hold_reason: string | null
          id: string
          invoice_count: number
          last_import_batch_id: string | null
          legacy_status_text: string | null
          load_date: string | null
          load_number: string
          merchandise_value: number | null
          monitor_responsible: string | null
          monitored: boolean
          notes: string | null
          occurrence_at: string | null
          occurrence_notes: string | null
          occurrence_responsible: string | null
          on_hold: boolean
          operation_type: Database["public"]["Enums"]["operation_type"] | null
          operational_status: string | null
          origin: string | null
          origin_manifest: string | null
          os_number: string | null
          payment_date: string | null
          payment_method: string | null
          payment_status: string
          pix_to_receive: number
          receivable_id: string | null
          received_amount: number
          schedule_at: string | null
          scheduled_load_at: string | null
          shipment_manifest: string | null
          sm_manager: string | null
          sm_release: string | null
          source_origin: string | null
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
      create_manual_driver_settlement: {
        Args: {
          _driver_id: string
          _load_ids: string[]
          _reference_date: string
          _tenant_id: string
          _vehicle_id: string
        }
        Returns: string
      }
      create_manual_expense: { Args: { _payload: Json }; Returns: string }
      create_manual_financial_match: {
        Args: {
          _amount_matched: number
          _bank_transaction_id: string
          _financial_obligation_id: string
          _reason?: string
          _tenant_id: string
        }
        Returns: string
      }
      create_merchandise_shortage_case: {
        Args: { _payload: Json; _tenant_id: string }
        Returns: string
      }
      create_pallet_return_protocol: {
        Args: { _payload: Json; _tenant_id: string }
        Returns: Json
      }
      create_tenant_with_owner: {
        Args: { _tenant_name: string }
        Returns: string
      }
      cte_defaults_for_group: { Args: { p_load_ids: string[] }; Returns: Json }
      current_driver_id: { Args: { _tenant_id: string }; Returns: string }
      delete_driver_settlement: {
        Args: { _reason: string; _settlement_id: string }
        Returns: undefined
      }
      delete_load_safely: {
        Args: { _load_id: string; _tenant_id: string }
        Returns: Json
      }
      delete_loads_safely: {
        Args: { _load_ids: string[]; _tenant_id: string }
        Returns: Json
      }
      delete_payroll_entry_item: {
        Args: { _item_id: string; _reason: string }
        Returns: undefined
      }
      detach_load_from_driver_settlement: {
        Args: { _load_id: string; _settlement_id: string }
        Returns: undefined
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
          _city?: string
          _document_number?: string
          _expense_at?: string
          _no_receipt?: boolean
          _no_receipt_reason?: string
          _notes?: string
          _odometer?: number
          _paid_with_advance?: boolean
          _payment_source?: string
          _receipt_path?: string
          _reimbursable?: boolean
          _state?: string
          _supplier_name?: string
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
      generate_driver_settlement: {
        Args: { _dispatch_trip_id: string; _tenant_id: string }
        Returns: string
      }
      generate_occurrence_return_sheet: {
        Args: {
          _occurrence_id: string
          _regenerate?: boolean
          _regeneration_reason?: string
        }
        Returns: Json
      }
      generate_payroll_period: {
        Args: {
          _include_drivers?: boolean
          _include_non_drivers?: boolean
          _period_end: string
          _period_name?: string
          _period_start: string
          _tenant_id: string
        }
        Returns: string
      }
      generate_pending_driver_settlements: {
        Args: { _tenant_id: string }
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
      get_client_portal_alerts: {
        Args: { _client_id?: string; _limit?: number; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_alerts_v2: {
        Args: { _client_id: string; _limit?: number; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_reports_summary: {
        Args: { _end_date?: string; _start_date?: string; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_reports_summary_v2: {
        Args: {
          _client_id?: string
          _end_date?: string
          _start_date?: string
          _tenant_id: string
        }
        Returns: Json
      }
      get_client_portal_shipment_detail: {
        Args: { _fiscal_document_id: string }
        Returns: Json
      }
      get_client_portal_shipment_detail_v2: {
        Args: { _fiscal_document_id: string }
        Returns: Json
      }
      get_client_portal_summary: {
        Args: { _end_date?: string; _start_date?: string; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_summary_v2: {
        Args: {
          _client_id?: string
          _end_date?: string
          _start_date?: string
          _tenant_id: string
        }
        Returns: Json
      }
      get_client_portal_tracking: {
        Args: { _client_id?: string; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_tracking_v2: {
        Args: { _client_id: string; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_upcoming_deliveries: {
        Args: { _client_id?: string; _limit?: number; _tenant_id: string }
        Returns: Json
      }
      get_client_portal_upcoming_deliveries_v2: {
        Args: { _client_id: string; _limit?: number; _tenant_id: string }
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
      get_user_client_access_detailed: {
        Args: { _tenant_id: string }
        Returns: {
          access_type: string
          active: boolean
          can_download_documents: boolean
          can_open_occurrences: boolean
          can_request_pickup: boolean
          can_view_driver_contact: boolean
          can_view_financial: boolean
          can_view_vehicle_live: boolean
          client_id: string
          client_name: string
          client_tax_id: string
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
      hold_load: {
        Args: { _load_id: string; _reason?: string }
        Returns: undefined
      }
      import_bank_statement: {
        Args: {
          _bank_account_id: string
          _file_hash: string
          _file_name: string
          _period_end: string
          _period_start: string
          _raw_metadata?: Json
          _rows: Json
          _tenant_id: string
        }
        Returns: Json
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
      list_available_loads_for_settlement: {
        Args: {
          _driver_id?: string
          _include_settlement_id?: string
          _limit?: number
          _search?: string
          _tenant_id: string
        }
        Returns: Json
      }
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
      list_client_documents_v2: {
        Args: {
          _client_id?: string
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
      list_client_occurrence_messages: {
        Args: { _occurrence_id: string; _tenant_id: string }
        Returns: {
          author_name: string
          author_role: string
          created_at: string
          id: string
          message: string
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
      list_client_occurrences_v2: {
        Args: {
          _client_id?: string
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
      list_client_pickups_v2: {
        Args: {
          _client_id?: string
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
      list_client_pods_v2: {
        Args: {
          _client_id?: string
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
      list_driver_settlement_filter_options: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      list_driver_settlements: {
        Args: {
          _date_from?: string
          _date_to?: string
          _driver_id?: string
          _only_expense_pending?: boolean
          _only_km_pending?: boolean
          _only_needs_recalculation?: boolean
          _only_no_freight?: boolean
          _page?: number
          _page_size?: number
          _search?: string
          _status?: string
          _tenant_id: string
          _vehicle_id?: string
        }
        Returns: Json
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
      mark_doccob_downloaded: {
        Args: { _export_id: string; _tenant_id: string }
        Returns: undefined
      }
      mark_doccob_sent: {
        Args: {
          _channel?: string
          _export_id: string
          _sent_to?: string
          _tenant_id: string
        }
        Returns: undefined
      }
      mark_driver_settlement_outdated: {
        Args: { _dispatch_trip_id: string; _reason: string; _tenant_id: string }
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
      next_client_invoice_number: {
        Args: {
          _installment?: number
          _issue_date?: string
          _tenant_id: string
        }
        Returns: string
      }
      next_closing_report_number: {
        Args: { _date?: string; _tenant_id: string }
        Returns: string
      }
      next_merchandise_shortage_number: {
        Args: { _date?: string; _tenant_id: string }
        Returns: string
      }
      next_nfse_number: {
        Args: { _branch_code?: string; _series?: string; _tenant_id: string }
        Returns: number
      }
      next_nfse_number_by_emitter: {
        Args: { _emitter_id: string; _series: string; _tenant_id: string }
        Returns: number
      }
      next_occurrence_return_sheet_number: {
        Args: { _date?: string; _tenant_id: string }
        Returns: string
      }
      next_pallet_return_protocol_number: {
        Args: { _date?: string; _tenant_id: string }
        Returns: string
      }
      normalize_fiscal_number: { Args: { value: string }; Returns: string }
      normalize_tax_id: { Args: { value: string }; Returns: string }
      normalize_vehicle_plate: { Args: { p: string }; Returns: string }
      op_route_norm: { Args: { txt: string }; Returns: string }
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
      recalculate_payroll_entry: {
        Args: { _entry_id: string }
        Returns: undefined
      }
      recompute_payroll_entry_totals: {
        Args: { _entry_id: string }
        Returns: undefined
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
      refresh_closing_report_overdue: {
        Args: { _tenant_id: string }
        Returns: number
      }
      register_closing_report_payment: {
        Args: { _closing_report_id: string; _payment: Json }
        Returns: string
      }
      register_doccob_export: {
        Args: {
          _charge_count: number
          _client_id: string
          _client_invoice_ids: string[]
          _content_hash: string
          _detail_count: number
          _file_date: string
          _file_name: string
          _generated_content: string
          _profile_id: string
          _record_count: number
          _reprocess_reason?: string
          _tenant_id: string
          _total_amount: number
        }
        Returns: Json
      }
      register_driver_settlement_payment: {
        Args: {
          _allow_overpayment?: boolean
          _amount: number
          _notes?: string
          _overpayment_reason?: string
          _payment_account?: string
          _payment_method?: string
          _payment_reference?: string
          _receipt_url?: string
          _settlement_id: string
        }
        Returns: string
      }
      register_driver_settlement_payment_v2: {
        Args: {
          _allow_overpayment?: boolean
          _amount: number
          _bank_account_id?: string
          _cost_center?: string
          _notes?: string
          _overpayment_reason?: string
          _payment_account?: string
          _payment_method?: string
          _payment_reference?: string
          _receipt_url?: string
          _settlement_id: string
        }
        Returns: string
      }
      register_employee_advance: {
        Args: {
          _advance_date?: string
          _amount: number
          _create_payable?: boolean
          _employee_id: string
          _mark_paid?: boolean
          _payment_method?: string
          _payment_reference?: string
          _reason?: string
          _tenant_id: string
        }
        Returns: string
      }
      register_payable_payment: {
        Args: {
          _amount: number
          _attachment_url?: string
          _bank_account_id: string
          _method?: string
          _notes?: string
          _paid_at: string
          _payable_id: string
        }
        Returns: string
      }
      register_receivable_payment: {
        Args: {
          _amount: number
          _attachment_url?: string
          _bank_account_id: string
          _method?: string
          _notes?: string
          _receivable_id: string
          _received_at: string
        }
        Returns: string
      }
      reject_financial_match: {
        Args: { _match_id: string; _reason: string }
        Returns: undefined
      }
      remove_driver_settlement_adjustment: {
        Args: { _item_id: string; _reason: string; _settlement_id: string }
        Returns: undefined
      }
      remove_fiscal_documents_from_load: {
        Args: { _document_ids: string[]; _load_id: string; _tenant_id: string }
        Returns: Json
      }
      reopen_closing_report: {
        Args: { _closing_report_id: string; _reason: string }
        Returns: undefined
      }
      reopen_reconciliation_session: {
        Args: { _reason: string; _session_id: string }
        Returns: undefined
      }
      reply_client_occurrence: {
        Args: { _message: string; _occurrence_id: string; _tenant_id: string }
        Returns: string
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
      reverse_financial_match: {
        Args: { _match_id: string; _reason: string }
        Returns: undefined
      }
      reverse_payable_payment: {
        Args: { _payment_id: string }
        Returns: boolean
      }
      reverse_receivable_payment: {
        Args: { _payment_id: string }
        Returns: boolean
      }
      revert_xml_loads_to_available: {
        Args: { _tenant_id: string }
        Returns: Json
      }
      run_bank_reconciliation: {
        Args: {
          _bank_account_id: string
          _period_end: string
          _period_start: string
          _tenant_id: string
        }
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
      search_client_portal_shipments_v2: {
        Args: {
          _city?: string
          _client_id?: string
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
      settle_zero_driver_settlement: {
        Args: { _reason: string; _settlement_id: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stop_terminal_statuses: { Args: never; Returns: string[] }
      sync_financial_obligations: {
        Args: { _date_from?: string; _date_to?: string; _tenant_id: string }
        Returns: Json
      }
      unhold_load: { Args: { _load_id: string }; Returns: undefined }
      update_driver_settlement_km_review: {
        Args: {
          _audited_end_location?: string
          _audited_km: number
          _audited_start_location?: string
          _km_end?: number
          _km_start?: number
          _km_status: string
          _notes: string
          _settlement_id: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          approved_expenses_total: number | null
          approved_with_exception: boolean
          audited_end_location: string | null
          audited_km: number | null
          audited_start_location: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          dispatch_trip_id: string | null
          documents_count: number | null
          driver_credits_total: number
          driver_debits_total: number
          driver_id: string | null
          driver_payable_amount: number
          driver_reimbursement_total: number
          estimated_km: number | null
          exception_reason: string | null
          expenses_total: number | null
          final_amount: number | null
          id: string
          invoice_balance: number | null
          is_manual: boolean
          km_end: number | null
          km_review_notes: string | null
          km_review_status: string | null
          km_start: number | null
          last_recalculated_at: string | null
          loads_count: number | null
          manual_adjustments_total: number | null
          manual_reference_date: string | null
          needs_recalculation: boolean
          operational_balance: number | null
          paid_at: string | null
          paid_by: string | null
          payment_balance: number
          pending_expenses_total: number | null
          recalculation_reason: string | null
          rejected_expenses_total: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          route_destination: string | null
          route_name: string | null
          route_origin: string | null
          route_result: number
          snapshot_json: Json
          source_updated_at: string | null
          status: string
          stops_count: number | null
          tenant_id: string
          total_freight_revenue: number
          total_freight_value: number | null
          total_goods_value: number
          total_invoice_value: number | null
          total_paid_amount: number
          total_weight_kg: number | null
          trip_completed_at: string | null
          trip_started_at: string | null
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_driver_settlement_status: {
        Args: {
          _allow_exceptions?: boolean
          _new_status: string
          _reason?: string
          _settlement_id: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          approved_expenses_total: number | null
          approved_with_exception: boolean
          audited_end_location: string | null
          audited_km: number | null
          audited_start_location: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          dispatch_trip_id: string | null
          documents_count: number | null
          driver_credits_total: number
          driver_debits_total: number
          driver_id: string | null
          driver_payable_amount: number
          driver_reimbursement_total: number
          estimated_km: number | null
          exception_reason: string | null
          expenses_total: number | null
          final_amount: number | null
          id: string
          invoice_balance: number | null
          is_manual: boolean
          km_end: number | null
          km_review_notes: string | null
          km_review_status: string | null
          km_start: number | null
          last_recalculated_at: string | null
          loads_count: number | null
          manual_adjustments_total: number | null
          manual_reference_date: string | null
          needs_recalculation: boolean
          operational_balance: number | null
          paid_at: string | null
          paid_by: string | null
          payment_balance: number
          pending_expenses_total: number | null
          recalculation_reason: string | null
          rejected_expenses_total: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          route_destination: string | null
          route_name: string | null
          route_origin: string | null
          route_result: number
          snapshot_json: Json
          source_updated_at: string | null
          status: string
          stops_count: number | null
          tenant_id: string
          total_freight_revenue: number
          total_freight_value: number | null
          total_goods_value: number
          total_invoice_value: number | null
          total_paid_amount: number
          total_weight_kg: number | null
          trip_completed_at: string | null
          trip_started_at: string | null
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "driver_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_merchandise_shortage_status: {
        Args: { _case_id: string; _payload?: Json; _status: string }
        Returns: undefined
      }
      update_pallet_return_status: {
        Args: { _payload?: Json; _protocol_id: string; _status: string }
        Returns: undefined
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
