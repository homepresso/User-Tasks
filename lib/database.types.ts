export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_queue: {
        Row: {
          agent_id: string
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error: string | null
          id: string
          input_message: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number | null
          next_retry_at: string | null
          priority: number | null
          result: Json | null
          run_id: string | null
          scheduled_for: string | null
          shared_context: Json | null
          started_at: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          agent_id: string
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          input_message: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number | null
          next_retry_at?: string | null
          priority?: number | null
          result?: Json | null
          run_id?: string | null
          scheduled_for?: string | null
          shared_context?: Json | null
          started_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          agent_id?: string
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          input_message?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number | null
          next_retry_at?: string | null
          priority?: number | null
          result?: Json | null
          run_id?: string | null
          scheduled_for?: string | null
          shared_context?: Json | null
          started_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_queue_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          actor_id: string | null
          agent_id: string | null
          caller_id: string | null
          caller_type: string | null
          completed_at: string | null
          context: Json | null
          created_at: string | null
          duration_ms: number | null
          error: string | null
          id: string
          input_message: string | null
          input_tokens: number | null
          iterations: number | null
          model: string | null
          output_response: string | null
          output_tokens: number | null
          outputs: Json | null
          paused_at: string | null
          paused_context: Json | null
          queue_job_id: string | null
          started_at: string | null
          status: string | null
          tenant_id: string | null
          tool_calls: Json | null
          total_tokens: number | null
          trace_id: string | null
          usage: Json | null
          workflow_run_id: string | null
        }
        Insert: {
          actor_id?: string | null
          agent_id?: string | null
          caller_id?: string | null
          caller_type?: string | null
          completed_at?: string | null
          context?: Json | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_message?: string | null
          input_tokens?: number | null
          iterations?: number | null
          model?: string | null
          output_response?: string | null
          output_tokens?: number | null
          outputs?: Json | null
          paused_at?: string | null
          paused_context?: Json | null
          queue_job_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          tool_calls?: Json | null
          total_tokens?: number | null
          trace_id?: string | null
          usage?: Json | null
          workflow_run_id?: string | null
        }
        Update: {
          actor_id?: string | null
          agent_id?: string | null
          caller_id?: string | null
          caller_type?: string | null
          completed_at?: string | null
          context?: Json | null
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_message?: string | null
          input_tokens?: number | null
          iterations?: number | null
          model?: string | null
          output_response?: string | null
          output_tokens?: number | null
          outputs?: Json | null
          paused_at?: string | null
          paused_context?: Json | null
          queue_job_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          tool_calls?: Json | null
          total_tokens?: number | null
          trace_id?: string | null
          usage?: Json | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_queue_job_id_fkey"
            columns: ["queue_job_id"]
            isOneToOne: false
            referencedRelation: "agent_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          boundaries: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          integration_id: string | null
          is_active: boolean | null
          max_iterations: number | null
          max_tokens: number | null
          model: string
          name: string
          output_config: Json | null
          role: string | null
          system_prompt: string
          tags: string[] | null
          task: string | null
          temperature: number | null
          tenant_id: string | null
          tools: Json | null
          updated_at: string | null
        }
        Insert: {
          boundaries?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          max_iterations?: number | null
          max_tokens?: number | null
          model?: string
          name: string
          output_config?: Json | null
          role?: string | null
          system_prompt?: string
          tags?: string[] | null
          task?: string | null
          temperature?: number | null
          tenant_id?: string | null
          tools?: Json | null
          updated_at?: string | null
        }
        Update: {
          boundaries?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean | null
          max_iterations?: number | null
          max_tokens?: number | null
          model?: string
          name?: string
          output_config?: Json | null
          role?: string | null
          system_prompt?: string
          tags?: string[] | null
          task?: string | null
          temperature?: number | null
          tenant_id?: string | null
          tools?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_revoked: boolean | null
          key_hash: string
          key_prefix: string
          key_type: string
          last_used_at: string | null
          name: string
          permissions: Json | null
          scopes: Json
          tenant_id: string
          user_id: string | null
          workflow_source_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_revoked?: boolean | null
          key_hash: string
          key_prefix: string
          key_type?: string
          last_used_at?: string | null
          name: string
          permissions?: Json | null
          scopes?: Json
          tenant_id: string
          user_id?: string | null
          workflow_source_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_revoked?: boolean | null
          key_hash?: string
          key_prefix?: string
          key_type?: string
          last_used_at?: string | null
          name?: string
          permissions?: Json | null
          scopes?: Json
          tenant_id?: string
          user_id?: string | null
          workflow_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workflow_source_id_fkey"
            columns: ["workflow_source_id"]
            isOneToOne: false
            referencedRelation: "workflow_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_table_rows: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          retention_applied_at: string | null
          retention_policy_id: string | null
          table_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          table_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          table_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_table_rows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_table_rows_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_table_rows_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "custom_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_table_rows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_table_rows_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_tables: {
        Row: {
          columns: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          retention_applied_at: string | null
          retention_policy_id: string | null
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_tables_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_tables_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_workflow_activities: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          demo_inputs: Json
          description: string | null
          icon_name: string
          id: string
          key: string
          manifest: Json
          name: string
          source_code: string
          source_filename: string | null
          source_kind: string
          status: string
          tags: string[]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          demo_inputs?: Json
          description?: string | null
          icon_name?: string
          id?: string
          key: string
          manifest?: Json
          name: string
          source_code: string
          source_filename?: string | null
          source_kind?: string
          status?: string
          tags?: string[]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          demo_inputs?: Json
          description?: string | null
          icon_name?: string
          id?: string
          key?: string
          manifest?: Json
          name?: string
          source_code?: string
          source_filename?: string | null
          source_kind?: string
          status?: string
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_workflow_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_workflow_activities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_workflow_activities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_events: {
        Row: {
          attempts: number | null
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          last_attempt_at: string | null
          payload: Json
          target_url: string
          task_id: string | null
          tenant_id: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          last_attempt_at?: string | null
          payload: Json
          target_url: string
          task_id?: string | null
          tenant_id: string
        }
        Update: {
          attempts?: number | null
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          last_attempt_at?: string | null
          payload?: Json
          target_url?: string
          task_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dead_letter_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dead_letter_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_tables: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          inputs: Json
          name: string
          outputs: Json
          rules: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inputs?: Json
          name: string
          outputs?: Json
          rules?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          inputs?: Json
          name?: string
          outputs?: Json
          rules?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_tables_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          payload: Json
          started_at: string | null
          status: string
          target_id: string
          target_type: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          payload?: Json
          started_at?: string | null
          status?: string
          target_id: string
          target_type: string
          tenant_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          payload?: Json
          started_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deletion_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_links: {
        Row: {
          created_at: string | null
          display_name: string | null
          external_id: string
          id: string
          last_seen_at: string | null
          local_id: string
          object_type: string
          provider: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          external_id: string
          id?: string
          last_seen_at?: string | null
          local_id: string
          object_type: string
          provider: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          external_id?: string
          id?: string
          last_seen_at?: string | null
          local_id?: string
          object_type?: string
          provider?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_sync_runs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          progress: Json | null
          provider: string
          started_at: string | null
          stats: Json | null
          status: string
          tenant_id: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          progress?: Json | null
          provider: string
          started_at?: string | null
          stats?: Json | null
          status?: string
          tenant_id: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          progress?: Json | null
          provider?: string
          started_at?: string | null
          stats?: Json | null
          status?: string
          tenant_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "directory_sync_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_sync_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      effort_records: {
        Row: {
          created_at: string
          id: string
          minutes: number
          notes: string | null
          record_type: Database["public"]["Enums"]["effort_record_type"]
          task_id: string
          tenant_id: string
          timer_end: string | null
          timer_start: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          minutes: number
          notes?: string | null
          record_type: Database["public"]["Enums"]["effort_record_type"]
          task_id: string
          tenant_id: string
          timer_end?: string | null
          timer_start?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          minutes?: number
          notes?: string | null
          record_type?: Database["public"]["Enums"]["effort_record_type"]
          task_id?: string
          tenant_id?: string
          timer_end?: string | null
          timer_start?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "effort_records_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "effort_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "effort_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          html_body: string
          id: string
          is_default: boolean
          name: string
          subject: string
          tenant_id: string
          text_body: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          html_body?: string
          id?: string
          is_default?: boolean
          name: string
          subject?: string
          tenant_id: string
          text_body?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          html_body?: string
          id?: string
          is_default?: boolean
          name?: string
          subject?: string
          tenant_id?: string
          text_body?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_stream: {
        Row: {
          actor_id: string | null
          attributes: Json
          category: string
          id: number
          message: string
          occurred_at: string
          run_id: string | null
          severity: string
          source_id: string | null
          source_table: string
          task_id: string | null
          tenant_id: string
          trace_id: string | null
          type: string
          workflow_id: string | null
        }
        Insert: {
          actor_id?: string | null
          attributes?: Json
          category: string
          id?: never
          message: string
          occurred_at?: string
          run_id?: string | null
          severity?: string
          source_id?: string | null
          source_table: string
          task_id?: string | null
          tenant_id: string
          trace_id?: string | null
          type: string
          workflow_id?: string | null
        }
        Update: {
          actor_id?: string | null
          attributes?: Json
          category?: string
          id?: never
          message?: string
          occurred_at?: string
          run_id?: string | null
          severity?: string
          source_id?: string | null
          source_table?: string
          task_id?: string | null
          tenant_id?: string
          trace_id?: string | null
          type?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_stream_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_stream_purge_marks: {
        Row: {
          purged_through: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          purged_through?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          purged_through?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_stream_purge_marks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_deployments: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          dry_run: boolean
          error: string | null
          id: string
          source: Json
          started_at: string | null
          stats: Json | null
          status: string
          tenant_id: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dry_run?: boolean
          error?: string | null
          id?: string
          source: Json
          started_at?: string | null
          stats?: Json | null
          status?: string
          tenant_id: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dry_run?: boolean
          error?: string | null
          id?: string
          source?: Json
          started_at?: string | null
          stats?: Json | null
          status?: string
          tenant_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_deployments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_deployments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_sync_asset_map: {
        Row: {
          asset_type: string
          local_id: string
          source_id: string
          source_repo: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          asset_type: string
          local_id: string
          source_id: string
          source_repo?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          asset_type?: string
          local_id?: string
          source_id?: string
          source_repo?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_asset_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_sync_queue: {
        Row: {
          action: string
          asset_id: string
          asset_name: string | null
          asset_type: string
          attempts: number
          commit_sha: string | null
          error: string | null
          id: string
          queued_at: string
          queued_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action: string
          asset_id: string
          asset_name?: string | null
          asset_type: string
          attempts?: number
          commit_sha?: string | null
          error?: string | null
          id?: string
          queued_at?: string
          queued_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          asset_id?: string
          asset_name?: string | null
          asset_type?: string
          attempts?: number
          commit_sha?: string | null
          error?: string | null
          id?: string
          queued_at?: string
          queued_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_queue_queued_by_fkey"
            columns: ["queued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_sync_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_sync_runs: {
        Row: {
          attempts: number
          commit_sha: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          files_changed: number | null
          id: string
          kind: string
          message: string | null
          progress: Json | null
          scope: Json | null
          started_at: string | null
          status: string
          template_id: string | null
          tenant_id: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          files_changed?: number | null
          id?: string
          kind?: string
          message?: string | null
          progress?: Json | null
          scope?: Json | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          tenant_id: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          files_changed?: number | null
          id?: string
          kind?: string
          message?: string | null
          progress?: Json | null
          scope?: Json | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          tenant_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_sync_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "github_sync_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_sync_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      github_sync_templates: {
        Row: {
          asset_types: Json
          assets: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_run_at: string | null
          name: string
          schedule: Json | null
          schedule_last_fired_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          asset_types?: Json
          assets?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_run_at?: string | null
          name: string
          schedule?: Json | null
          schedule_last_fired_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          asset_types?: Json
          assets?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_run_at?: string | null
          name?: string
          schedule?: Json | null
          schedule_last_fired_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_sync_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_call_logs: {
        Row: {
          caller_id: string | null
          caller_node_id: string | null
          caller_type: string | null
          completed_at: string | null
          duration_ms: number | null
          error: string | null
          id: string
          integration_id: string | null
          method: string | null
          reference_id: string | null
          request_body: Json | null
          request_headers: Json | null
          response_body: Json | null
          response_headers: Json | null
          response_status: number | null
          started_at: string
          tenant_id: string
          trace_id: string | null
          url: string | null
        }
        Insert: {
          caller_id?: string | null
          caller_node_id?: string | null
          caller_type?: string | null
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          integration_id?: string | null
          method?: string | null
          reference_id?: string | null
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          response_headers?: Json | null
          response_status?: number | null
          started_at?: string
          tenant_id: string
          trace_id?: string | null
          url?: string | null
        }
        Update: {
          caller_id?: string | null
          caller_node_id?: string | null
          caller_type?: string | null
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          integration_id?: string | null
          method?: string | null
          reference_id?: string | null
          request_body?: Json | null
          request_headers?: Json | null
          response_body?: Json | null
          response_headers?: Json | null
          response_status?: number | null
          started_at?: string
          tenant_id?: string
          trace_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_call_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_call_logs_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "integration_references"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_call_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_object_sources: {
        Row: {
          alias: string
          created_at: string
          id: string
          is_primary: boolean
          join_on_foreign: string | null
          join_on_local: string | null
          join_to_alias: string | null
          join_type: string | null
          object_id: string
          reference_id: string | null
          sort_order: number
          source_type: string
          table_id: string | null
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          is_primary?: boolean
          join_on_foreign?: string | null
          join_on_local?: string | null
          join_to_alias?: string | null
          join_type?: string | null
          object_id: string
          reference_id?: string | null
          sort_order?: number
          source_type: string
          table_id?: string | null
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          join_on_foreign?: string | null
          join_on_local?: string | null
          join_to_alias?: string | null
          join_type?: string | null
          object_id?: string
          reference_id?: string | null
          sort_order?: number
          source_type?: string
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_object_sources_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "integration_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_object_sources_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "integration_references"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_object_sources_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "custom_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_objects: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_references: {
        Row: {
          created_at: string
          description: string | null
          id: string
          inputs: Json
          integration_id: string
          name: string
          outputs: Json
          request_config: Json
          tags: string[] | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          inputs?: Json
          integration_id: string
          name: string
          outputs?: Json
          request_config?: Json
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          inputs?: Json
          integration_id?: string
          name?: string
          outputs?: Json
          request_config?: Json
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_references_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_references_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          last_test_message: string | null
          last_test_status: string | null
          last_tested_at: string | null
          name: string
          tags: string[] | null
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          name: string
          tags?: string[] | null
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          name?: string
          tags?: string[] | null
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["lifecycle_event_type"]
          id: string
          metadata: Json | null
          task_id: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["lifecycle_event_type"]
          id?: string
          metadata?: Json | null
          task_id: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["lifecycle_event_type"]
          id?: string
          metadata?: Json | null
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lifecycle_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifecycle_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifecycle_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      log_destinations: {
        Row: {
          config: Json
          consecutive_failures: number
          created_at: string
          created_by: string | null
          credentials: Json
          cursor: number
          enabled: boolean
          events_sent: number
          filters: Json
          id: string
          last_error: string | null
          last_error_at: string | null
          last_success_at: string | null
          locked_at: string | null
          locked_by: string | null
          name: string
          next_attempt_at: string | null
          status: string
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          credentials?: Json
          cursor?: number
          enabled?: boolean
          events_sent?: number
          filters?: Json
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          name: string
          next_attempt_at?: string | null
          status?: string
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          credentials?: Json
          cursor?: number
          enabled?: boolean
          events_sent?: number
          filters?: Json
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          name?: string
          next_attempt_at?: string | null
          status?: string
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_destinations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_servers: {
        Row: {
          auth_config: Json | null
          auth_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          tools_cache: Json | null
          tools_cached_at: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          auth_config?: Json | null
          auth_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          tools_cache?: Json | null
          tools_cached_at?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          auth_config?: Json | null
          auth_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          tools_cache?: Json | null
          tools_cached_at?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_servers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      node_favorites: {
        Row: {
          created_at: string | null
          node_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          node_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          node_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_favorites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          task_id: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          task_id?: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          task_id?: string | null
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          scopes: string[]
          tenant_id: string
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          scopes?: string[]
          tenant_id: string
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          scopes?: string[]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_authorization_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_authorization_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          allowed_scopes: string[]
          client_id: string
          client_secret_hash: string | null
          client_type: string
          created_at: string
          created_by: string | null
          created_ip: string | null
          grant_types: string[]
          id: string
          is_dynamic: boolean
          is_first_party: boolean
          name: string
          redirect_uris: string[]
          revoked_at: string | null
          tenant_id: string | null
        }
        Insert: {
          allowed_scopes?: string[]
          client_id: string
          client_secret_hash?: string | null
          client_type: string
          created_at?: string
          created_by?: string | null
          created_ip?: string | null
          grant_types?: string[]
          id?: string
          is_dynamic?: boolean
          is_first_party?: boolean
          name: string
          redirect_uris?: string[]
          revoked_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          allowed_scopes?: string[]
          client_id?: string
          client_secret_hash?: string | null
          client_type?: string
          created_at?: string
          created_by?: string | null
          created_ip?: string | null
          grant_types?: string[]
          id?: string
          is_dynamic?: boolean
          is_first_party?: boolean
          name?: string
          redirect_uris?: string[]
          revoked_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_connect_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          state_hash: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          kind: string
          payload?: Json
          state_hash: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          state_hash?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_connect_states_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_connect_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_tokens: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          grant_type: string
          id: string
          last_used_at: string | null
          refresh_parent: string | null
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
          token_hash: string
          token_prefix: string
          token_type: string
          user_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at: string
          grant_type: string
          id?: string
          last_used_at?: string | null
          refresh_parent?: string | null
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
          token_hash: string
          token_prefix: string
          token_type: string
          user_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          grant_type?: string
          id?: string
          last_used_at?: string | null
          refresh_parent?: string | null
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
          token_hash?: string
          token_prefix?: string
          token_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_tokens_refresh_parent_fkey"
            columns: ["refresh_parent"]
            isOneToOne: false
            referencedRelation: "oauth_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      object_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          id: string
          metadata: Json | null
          object_id: string
          object_type: string
          summary: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          metadata?: Json | null
          object_id: string
          object_type: string
          summary?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          metadata?: Json | null
          object_id?: string
          object_type?: string
          summary?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "object_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      object_permissions: {
        Row: {
          can_delete: boolean
          can_edit: boolean
          can_execute: boolean
          can_view: boolean
          created_at: string
          granted_by: string | null
          id: string
          object_id: string
          object_type: string
          role_id: string | null
          team_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          can_delete?: boolean
          can_edit?: boolean
          can_execute?: boolean
          can_view?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          object_id: string
          object_type: string
          role_id?: string | null
          team_id?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          can_delete?: boolean
          can_edit?: boolean
          can_execute?: boolean
          can_view?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          object_id?: string
          object_type?: string
          role_id?: string | null
          team_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "object_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string | null
          details: Json | null
          id: string
          role_id: string | null
          target_user_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string | null
          details?: Json | null
          id?: string
          role_id?: string | null
          target_user_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          role_id?: string | null
          target_user_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          category: string | null
          config: Json
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_favorite: boolean | null
          is_shared: boolean | null
          last_run_at: string | null
          name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          config?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          is_shared?: boolean | null
          last_run_at?: string | null
          name: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          config?: Json
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          is_shared?: boolean | null
          last_run_at?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_execution_events: {
        Row: {
          action_type: string
          asset_name: string | null
          created_at: string
          executed_at: string
          id: string
          metadata: Json
          result_status: string
          retention_policy_id: string
          target_id: string
          target_type: string
          tenant_id: string
          updated_at: string
          workflow_triggered_at: string | null
        }
        Insert: {
          action_type: string
          asset_name?: string | null
          created_at?: string
          executed_at: string
          id?: string
          metadata?: Json
          result_status?: string
          retention_policy_id: string
          target_id: string
          target_type: string
          tenant_id: string
          updated_at?: string
          workflow_triggered_at?: string | null
        }
        Update: {
          action_type?: string
          asset_name?: string | null
          created_at?: string
          executed_at?: string
          id?: string
          metadata?: Json
          result_status?: string
          retention_policy_id?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          updated_at?: string
          workflow_triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_execution_events_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          applies_to: string[]
          created_at: string
          created_by: string | null
          description: string | null
          duration_days: number | null
          duration_unit: string | null
          duration_value: number | null
          exact_date: string | null
          id: string
          name: string
          policy_mode: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applies_to?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_days?: number | null
          duration_unit?: string | null
          duration_value?: number | null
          exact_date?: string | null
          id?: string
          name: string
          policy_mode: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applies_to?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_days?: number | null
          duration_unit?: string | null
          duration_value?: number | null
          exact_date?: string | null
          id?: string
          name?: string
          policy_mode?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_review_events: {
        Row: {
          admin_tasks_created_at: string | null
          asset_name: string | null
          created_at: string
          id: string
          metadata: Json
          retention_policy_id: string
          review_date: string
          status: string
          target_id: string
          target_type: string
          task_ids: Json
          tenant_id: string
          updated_at: string
          workflow_triggered_at: string | null
        }
        Insert: {
          admin_tasks_created_at?: string | null
          asset_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          retention_policy_id: string
          review_date: string
          status?: string
          target_id: string
          target_type: string
          task_ids?: Json
          tenant_id: string
          updated_at?: string
          workflow_triggered_at?: string | null
        }
        Update: {
          admin_tasks_created_at?: string | null
          asset_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          retention_policy_id?: string
          review_date?: string
          status?: string
          target_id?: string
          target_type?: string
          task_ids?: Json
          tenant_id?: string
          updated_at?: string
          workflow_triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_review_events_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          base_role: string | null
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          permissions: string[]
          retention_applied_at: string | null
          retention_policy_id: string | null
          slug: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          base_role?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          permissions?: string[]
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          slug: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          base_role?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          permissions?: string[]
          retention_applied_at?: string | null
          retention_policy_id?: string | null
          slug?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_definitions: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          tenant_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tag_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          acceptance_comment: string | null
          acceptance_status: string
          accepted_at: string | null
          created_at: string
          id: string
          role: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          acceptance_comment?: string | null
          acceptance_status?: string
          accepted_at?: string | null
          created_at?: string
          id?: string
          role?: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          acceptance_comment?: string | null
          acceptance_status?: string
          accepted_at?: string | null
          created_at?: string
          id?: string
          role?: string
          task_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          depends_on_task_id: string
          id: string
          task_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id: string
          id?: string
          task_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id?: string
          id?: string
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_escalations: {
        Row: {
          created_at: string
          escalate_after_minutes: number
          escalated_at: string | null
          escalation_type: string
          id: string
          is_escalated: boolean
          task_id: string
          team_id: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          escalate_after_minutes?: number
          escalated_at?: string | null
          escalation_type?: string
          id?: string
          is_escalated?: boolean
          task_id: string
          team_id?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          escalate_after_minutes?: number
          escalated_at?: string | null
          escalation_type?: string
          id?: string
          is_escalated?: boolean
          task_id?: string
          team_id?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_escalations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_escalations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_escalations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          created_at: string
          id: string
          is_sent: boolean
          offset_minutes: number
          sent_at: string | null
          task_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_sent?: boolean
          offset_minutes: number
          sent_at?: string | null
          task_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_sent?: boolean
          offset_minutes?: number
          sent_at?: string | null
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_responses: {
        Row: {
          id: string
          outcome: string
          outcome_notes: string | null
          responded_at: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          outcome: string
          outcome_notes?: string | null
          responded_at?: string
          task_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: string
          outcome?: string
          outcome_notes?: string | null
          responded_at?: string
          task_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_responses_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          aad_group_id: string | null
          acceptance_comment: string | null
          acceptance_status: string
          accepted_at: string | null
          actioned_at: string | null
          actioned_by: string | null
          actual_effort: number | null
          allow_delegate: boolean | null
          allow_escalate: boolean | null
          allow_reassign: boolean | null
          assigned_team_id: string | null
          assignee_id: string | null
          assigner_id: string | null
          assignment_group_id: string | null
          assignment_mode: string
          assignment_type: string
          available_outcomes: Json | null
          child_count: number | null
          completed_at: string | null
          completed_child_count: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          due_date_mode: string
          due_date_offset: Json | null
          estimated_completion: string | null
          estimated_effort_assignee: number | null
          estimated_effort_assigner: number | null
          event_id: string | null
          id: string
          is_sequential: boolean | null
          is_workflow_task: boolean
          metadata: Json | null
          outcome: string | null
          outcome_notes: string | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          progress_pct: number | null
          sequence: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          tenant_id: string
          title: string
          updated_at: string
          workflow_id: string | null
          workflow_position: string | null
          workflow_source_id: string | null
          workflow_step_id: string | null
        }
        Insert: {
          aad_group_id?: string | null
          acceptance_comment?: string | null
          acceptance_status?: string
          accepted_at?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          actual_effort?: number | null
          allow_delegate?: boolean | null
          allow_escalate?: boolean | null
          allow_reassign?: boolean | null
          assigned_team_id?: string | null
          assignee_id?: string | null
          assigner_id?: string | null
          assignment_group_id?: string | null
          assignment_mode?: string
          assignment_type?: string
          available_outcomes?: Json | null
          child_count?: number | null
          completed_at?: string | null
          completed_child_count?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_date_mode?: string
          due_date_offset?: Json | null
          estimated_completion?: string | null
          estimated_effort_assignee?: number | null
          estimated_effort_assigner?: number | null
          event_id?: string | null
          id?: string
          is_sequential?: boolean | null
          is_workflow_task?: boolean
          metadata?: Json | null
          outcome?: string | null
          outcome_notes?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress_pct?: number | null
          sequence?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id: string
          title: string
          updated_at?: string
          workflow_id?: string | null
          workflow_position?: string | null
          workflow_source_id?: string | null
          workflow_step_id?: string | null
        }
        Update: {
          aad_group_id?: string | null
          acceptance_comment?: string | null
          acceptance_status?: string
          accepted_at?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          actual_effort?: number | null
          allow_delegate?: boolean | null
          allow_escalate?: boolean | null
          allow_reassign?: boolean | null
          assigned_team_id?: string | null
          assignee_id?: string | null
          assigner_id?: string | null
          assignment_group_id?: string | null
          assignment_mode?: string
          assignment_type?: string
          available_outcomes?: Json | null
          child_count?: number | null
          completed_at?: string | null
          completed_child_count?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_date_mode?: string
          due_date_offset?: Json | null
          estimated_completion?: string | null
          estimated_effort_assignee?: number | null
          estimated_effort_assigner?: number | null
          event_id?: string | null
          id?: string
          is_sequential?: boolean | null
          is_workflow_task?: boolean
          metadata?: Json | null
          outcome?: string | null
          outcome_notes?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress_pct?: number | null
          sequence?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id?: string
          title?: string
          updated_at?: string
          workflow_id?: string | null
          workflow_position?: string | null
          workflow_source_id?: string | null
          workflow_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_tasks_workflow_source"
            columns: ["workflow_source_id"]
            isOneToOne: false
            referencedRelation: "workflow_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigner_id_fkey"
            columns: ["assigner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_connectors: {
        Row: {
          config: Json
          connector_key: string
          created_at: string | null
          created_by: string | null
          credentials: Json
          display_name: string | null
          id: string
          integration_id: string | null
          is_enabled: boolean
          last_test_message: string | null
          last_test_status: string | null
          last_tested_at: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          connector_key: string
          created_at?: string | null
          created_by?: string | null
          credentials?: Json
          display_name?: string | null
          id?: string
          integration_id?: string | null
          is_enabled?: boolean
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          connector_key?: string
          created_at?: string | null
          created_by?: string | null
          credentials?: Json
          display_name?: string | null
          id?: string
          integration_id?: string | null
          is_enabled?: boolean
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_connectors_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          agent_run_retention_days: number | null
          auth_provider: Database["public"]["Enums"]["auth_provider"]
          branding: Json | null
          company_size: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          custom_domain: string | null
          deleted_at: string | null
          domain: string | null
          id: string
          industry: string | null
          log_retention_days: number
          name: string
          onboarding_completed: boolean | null
          plan: Database["public"]["Enums"]["tenant_plan"]
          settings: Json | null
          slug: string
          updated_at: string
        }
        Insert: {
          agent_run_retention_days?: number | null
          auth_provider?: Database["public"]["Enums"]["auth_provider"]
          branding?: Json | null
          company_size?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          custom_domain?: string | null
          deleted_at?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          log_retention_days?: number
          name: string
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json | null
          slug: string
          updated_at?: string
        }
        Update: {
          agent_run_retention_days?: number | null
          auth_provider?: Database["public"]["Enums"]["auth_provider"]
          branding?: Json | null
          company_size?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          custom_domain?: string | null
          deleted_at?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          log_retention_days?: number
          name?: string
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_memberships: {
        Row: {
          created_at: string
          display_name_override: string | null
          id: string
          is_active: boolean | null
          is_home: boolean | null
          joined_at: string
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name_override?: string | null
          id?: string
          is_active?: boolean | null
          is_home?: boolean | null
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name_override?: string | null
          id?: string
          is_active?: boolean | null
          is_home?: boolean | null
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_teams: {
        Row: {
          created_at: string
          id: string
          role: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_teams_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          available_hours_week: number | null
          avatar_url: string | null
          created_at: string
          current_tenant_id: string | null
          deleted_at: string | null
          description: string | null
          display_name: string
          email: string
          id: string
          last_seen_at: string | null
          manager_id: string | null
          preferences: Json | null
          role: Database["public"]["Enums"]["user_role"]
          skills: string[]
          team_id: string | null
          tenant_id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          available_hours_week?: number | null
          avatar_url?: string | null
          created_at?: string
          current_tenant_id?: string | null
          deleted_at?: string | null
          description?: string | null
          display_name: string
          email: string
          id: string
          last_seen_at?: string | null
          manager_id?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
          team_id?: string | null
          tenant_id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          available_hours_week?: number | null
          avatar_url?: string | null
          created_at?: string
          current_tenant_id?: string | null
          deleted_at?: string | null
          description?: string | null
          display_name?: string
          email?: string
          id?: string
          last_seen_at?: string | null
          manager_id?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
          team_id?: string | null
          tenant_id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_users_team"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_current_tenant_id_fkey"
            columns: ["current_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          id: string
          level: string
          message: string
          metadata: Json | null
          node_id: string | null
          node_label: string | null
          node_type: string | null
          run_id: string | null
          tenant_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          level?: string
          message: string
          metadata?: Json | null
          node_id?: string | null
          node_label?: string | null
          node_type?: string | null
          run_id?: string | null
          tenant_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          node_id?: string | null
          node_label?: string | null
          node_type?: string | null
          run_id?: string | null
          tenant_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_logs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_queue: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number | null
          next_retry_at: string | null
          priority: number | null
          result: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
          task_id: string | null
          tenant_id: string
          trace_id: string | null
          trigger_data: Json | null
          trigger_type: string
          workflow_id: string
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number | null
          next_retry_at?: string | null
          priority?: number | null
          result?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          task_id?: string | null
          tenant_id: string
          trace_id?: string | null
          trigger_data?: Json | null
          trigger_type: string
          workflow_id: string
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number | null
          next_retry_at?: string | null
          priority?: number | null
          result?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          task_id?: string | null
          tenant_id?: string
          trace_id?: string | null
          trigger_data?: Json | null
          trigger_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_queue_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_queue_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          event_id: string | null
          execution_trace: Json
          id: string
          node_results: Json | null
          pause_variables: Json | null
          paused_at: string | null
          paused_node_id: string | null
          sla_breached_triggered_at: string | null
          sla_due_at: string | null
          sla_label: string | null
          sla_last_evaluated_at: string | null
          sla_metadata: Json
          sla_status: string
          sla_warning_at: string | null
          sla_warning_triggered_at: string | null
          started_at: string
          status: string
          task_id: string | null
          tenant_id: string
          title: string | null
          trace_id: string | null
          version_id: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          event_id?: string | null
          execution_trace?: Json
          id?: string
          node_results?: Json | null
          pause_variables?: Json | null
          paused_at?: string | null
          paused_node_id?: string | null
          sla_breached_triggered_at?: string | null
          sla_due_at?: string | null
          sla_label?: string | null
          sla_last_evaluated_at?: string | null
          sla_metadata?: Json
          sla_status?: string
          sla_warning_at?: string | null
          sla_warning_triggered_at?: string | null
          started_at?: string
          status?: string
          task_id?: string | null
          tenant_id: string
          title?: string | null
          trace_id?: string | null
          version_id?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          event_id?: string | null
          execution_trace?: Json
          id?: string
          node_results?: Json | null
          pause_variables?: Json | null
          paused_at?: string | null
          paused_node_id?: string | null
          sla_breached_triggered_at?: string | null
          sla_due_at?: string | null
          sla_label?: string | null
          sla_last_evaluated_at?: string | null
          sla_metadata?: Json
          sla_status?: string
          sla_warning_at?: string | null
          sla_warning_triggered_at?: string | null
          started_at?: string
          status?: string
          task_id?: string | null
          tenant_id?: string
          title?: string | null
          trace_id?: string | null
          version_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_sources: {
        Row: {
          api_key_hash: string | null
          auth_config: Json | null
          callback_url: string | null
          created_at: string
          display_name: string
          engine_type: string
          id: string
          instance_id: string | null
          is_active: boolean | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key_hash?: string | null
          auth_config?: Json | null
          callback_url?: string | null
          created_at?: string
          display_name: string
          engine_type: string
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key_hash?: string | null
          auth_config?: Json | null
          callback_url?: string | null
          created_at?: string
          display_name?: string
          engine_type?: string
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          edges: Json
          id: string
          is_active: boolean
          nodes: Json
          publish_notes: string | null
          published_at: string
          published_by: string | null
          sections: Json | null
          swimlanes: Json | null
          tenant_id: string
          trigger_config: Json | null
          trigger_type: string
          user_variables: Json | null
          version_number: number
          workflow_id: string
        }
        Insert: {
          edges?: Json
          id?: string
          is_active?: boolean
          nodes?: Json
          publish_notes?: string | null
          published_at?: string
          published_by?: string | null
          sections?: Json | null
          swimlanes?: Json | null
          tenant_id: string
          trigger_config?: Json | null
          trigger_type: string
          user_variables?: Json | null
          version_number: number
          workflow_id: string
        }
        Update: {
          edges?: Json
          id?: string
          is_active?: boolean
          nodes?: Json
          publish_notes?: string | null
          published_at?: string
          published_by?: string | null
          sections?: Json | null
          swimlanes?: Json | null
          tenant_id?: string
          trigger_config?: Json | null
          trigger_type?: string
          user_variables?: Json | null
          version_number?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_webhooks: {
        Row: {
          api_key_hash: string
          api_key_prefix: string
          created_at: string
          id: string
          is_active: boolean | null
          last_received_at: string | null
          payload_mapping: Json | null
          receive_count: number | null
          slug: string
          tenant_id: string
          workflow_id: string
        }
        Insert: {
          api_key_hash: string
          api_key_prefix: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          payload_mapping?: Json | null
          receive_count?: number | null
          slug: string
          tenant_id: string
          workflow_id: string
        }
        Update: {
          api_key_hash?: string
          api_key_prefix?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          payload_mapping?: Json | null
          receive_count?: number | null
          slug?: string
          tenant_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_webhooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_webhooks_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          edges: Json
          has_unpublished_changes: boolean | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          node_count: number
          nodes: Json
          published_version_id: string | null
          run_count: number | null
          schedule_last_fired_at: string | null
          sections: Json | null
          swimlanes: Json | null
          tags: string[] | null
          tenant_id: string
          trigger_config: Json | null
          trigger_type: string
          updated_at: string
          user_variables: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          has_unpublished_changes?: boolean | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          node_count?: number
          nodes?: Json
          published_version_id?: string | null
          run_count?: number | null
          schedule_last_fired_at?: string | null
          sections?: Json | null
          swimlanes?: Json | null
          tags?: string[] | null
          tenant_id: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
          user_variables?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          has_unpublished_changes?: boolean | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          node_count?: number
          nodes?: Json
          published_version_id?: string | null
          run_count?: number | null
          schedule_last_fired_at?: string | null
          sections?: Json | null
          swimlanes?: Json | null
          tags?: string[] | null
          tenant_id?: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
          user_variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_published_version_id_fkey"
            columns: ["published_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_tenant_id_fkey"
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
      add_task_dependency: {
        Args: { p_depends_on: string; p_task: string }
        Returns: string
      }
      check_object_permission: {
        Args: {
          p_object_id: string
          p_object_type: string
          p_permission: string
        }
        Returns: boolean
      }
      claim_jobs: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempts: number | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number | null
          next_retry_at: string | null
          priority: number | null
          result: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
          task_id: string | null
          tenant_id: string
          trace_id: string | null
          trigger_data: Json | null
          trigger_type: string
          workflow_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workflow_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_agent_job: {
        Args: { p_worker_id: string }
        Returns: {
          agent_id: string
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error: string | null
          id: string
          input_message: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number | null
          next_retry_at: string | null
          priority: number | null
          result: Json | null
          run_id: string | null
          scheduled_for: string | null
          shared_context: Json | null
          started_at: string | null
          status: string
          tenant_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "agent_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_next_deletion_job: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          payload: Json
          started_at: string | null
          status: string
          target_id: string
          target_type: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deletion_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_next_directory_sync_run: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          progress: Json | null
          provider: string
          started_at: string | null
          stats: Json | null
          status: string
          tenant_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "directory_sync_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_github_deployment: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          dry_run: boolean
          error: string | null
          id: string
          source: Json
          started_at: string | null
          stats: Json | null
          status: string
          tenant_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "github_deployments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_github_sync_run: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          commit_sha: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          files_changed: number | null
          id: string
          kind: string
          message: string | null
          progress: Json | null
          scope: Json | null
          started_at: string | null
          status: string
          template_id: string | null
          tenant_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "github_sync_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_job: {
        Args: { p_worker_id?: string }
        Returns: {
          attempts: number | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number | null
          next_retry_at: string | null
          priority: number | null
          result: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
          task_id: string | null
          tenant_id: string
          trace_id: string | null
          trigger_data: Json | null
          trigger_type: string
          workflow_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workflow_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_next_log_destination: {
        Args: { p_lock_seconds?: number; p_worker_id: string }
        Returns: Json
      }
      claim_scheduled_sync: {
        Args: {
          p_connector_key: string
          p_expected: string
          p_fired_at: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      complete_agent_job: {
        Args: { p_job_id: string; p_result: Json; p_run_id?: string }
        Returns: undefined
      }
      complete_deletion_job: { Args: { p_job_id: string }; Returns: undefined }
      complete_job: {
        Args: { p_job_id: string; p_result?: Json }
        Returns: undefined
      }
      create_task_with_subtasks: {
        Args: {
          p_assignee_id?: string
          p_description?: string
          p_due_date?: string
          p_estimated_effort?: number
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_subtasks?: Json
          p_title: string
        }
        Returns: Json
      }
      enqueue_workflow: {
        Args: {
          p_delay_seconds?: number
          p_priority?: number
          p_task_id?: string
          p_tenant_id: string
          p_trigger_data?: Json
          p_trigger_type?: string
          p_workflow_id: string
        }
        Returns: string
      }
      enqueue_workflow_batch: {
        Args: { p_jobs: Json; p_tenant_id: string }
        Returns: number
      }
      escalate_task: {
        Args: { p_notes?: string; p_target_user_id: string; p_task_id: string }
        Returns: undefined
      }
      fail_agent_job: {
        Args: { p_error: string; p_job_id: string }
        Returns: undefined
      }
      fail_deletion_job: {
        Args: { p_error: string; p_job_id: string }
        Returns: undefined
      }
      fail_job: {
        Args: { p_error: string; p_job_id: string }
        Returns: undefined
      }
      get_current_tenant_id: { Args: never; Returns: string }
      get_task_tree: { Args: { p_task_id: string }; Returns: Json }
      get_user_permissions: {
        Args: { p_tenant_id?: string }
        Returns: string[]
      }
      get_user_role_in_tenant: {
        Args: { p_tenant_id?: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_user_tenant_ids: { Args: never; Returns: string[] }
      is_trusted_db_caller: { Args: never; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notifications_read: {
        Args: { p_notification_ids: string[] }
        Returns: undefined
      }
      merge_tenant_connector_config: {
        Args: { p_connector_key: string; p_patch: Json; p_tenant_id: string }
        Returns: undefined
      }
      merge_tenant_connector_credentials: {
        Args: { p_connector_id: string; p_patch: Json }
        Returns: undefined
      }
      purge_event_stream: {
        Args: { p_batch_size?: number; p_before: string; p_tenant_id: string }
        Returns: number
      }
      purge_queue_history: {
        Args: { p_batch_size?: number; p_before: string }
        Returns: Json
      }
      reassign_task: {
        Args: {
          p_new_assignee_id: string
          p_reason?: string
          p_task_id: string
        }
        Returns: undefined
      }
      record_workflow_run: {
        Args: { p_workflow_id: string }
        Returns: undefined
      }
      release_jobs: {
        Args: { p_job_ids: string[]; p_worker_id: string }
        Returns: number
      }
      rls_member_tenant_ids: { Args: never; Returns: string[] }
      rls_visible_tenant_ids: { Args: never; Returns: string[] }
      search_custom_table_rows: {
        Args: { lim?: number; q: string }
        Returns: {
          data: Json
          id: string
          table_id: string
          table_name: string
        }[]
      }
      seed_tenant_roles: { Args: { p_tenant_id: string }; Returns: undefined }
      switch_tenant: { Args: { p_tenant_id: string }; Returns: undefined }
      workflow_node_visit_stats: {
        Args: { p_limit?: number; p_since?: string; p_workflow_ids: string[] }
        Returns: {
          node_id: string
          visits: number
          workflow_id: string
        }[]
      }
      workflow_run_daily_stats: {
        Args: { p_since: string; p_workflow_ids?: string[] }
        Returns: {
          active: number
          completed: number
          completed_ms: number
          day: string
          edge_traversals: number
          errors: number
          last_completed_at: string
          last_started_at: string
          node_visits: number
          runs: number
          timed: number
          timed_ms: number
          workflow_id: string
        }[]
      }
      workflow_run_duration_stats: {
        Args: { p_since: string; p_workflow_ids?: string[] }
        Returns: {
          active: number
          avg_ms: number
          completed: number
          failed: number
          p50_ms: number
          p95_ms: number
          runs: number
          workflow_id: string
        }[]
      }
      workflow_run_summaries: {
        Args: { p_limit?: number; p_since?: string; p_workflow_ids: string[] }
        Returns: {
          completed_at: string
          edge_traversals: number
          error: string
          id: string
          paused_at: string
          paused_node_id: string
          result_node_count: number
          sla_due_at: string
          sla_label: string
          sla_status: string
          sla_warning_at: string
          started_at: string
          status: string
          task_id: string
          title: string
          trace_node_visits: number
          workflow_id: string
        }[]
      }
      workflow_run_trace_counts: {
        Args: { p_results: Json; p_trace: Json }
        Returns: Record<string, unknown>
      }
    }
    Enums: {
      auth_provider: "email" | "google" | "azure_ad" | "saml"
      effort_record_type:
        | "assigner_estimate"
        | "assignee_estimate"
        | "actual"
        | "timer_entry"
      lifecycle_event_type:
        | "created"
        | "assigned"
        | "started"
        | "reassigned"
        | "escalated"
        | "redirected"
        | "delegated"
        | "snoozed"
        | "blocked"
        | "unblocked"
        | "completed"
        | "cancelled"
        | "reopened"
        | "comment_added"
        | "task_accepted"
        | "task_held"
        | "task_rejected"
        | "task_redirected"
        | "task_escalated"
        | "task_response"
        | "task_unanimous_failed"
        | "task_data_saved"
      task_priority: "critical" | "high" | "medium" | "low" | "none"
      task_status:
        | "draft"
        | "todo"
        | "in_progress"
        | "blocked"
        | "completed"
        | "cancelled"
      tenant_plan:
        | "personal_free"
        | "personal_pro"
        | "business_team"
        | "business_enterprise"
      user_role: "owner" | "admin" | "manager" | "member" | "viewer"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      auth_provider: ["email", "google", "azure_ad", "saml"],
      effort_record_type: [
        "assigner_estimate",
        "assignee_estimate",
        "actual",
        "timer_entry",
      ],
      lifecycle_event_type: [
        "created",
        "assigned",
        "started",
        "reassigned",
        "escalated",
        "redirected",
        "delegated",
        "snoozed",
        "blocked",
        "unblocked",
        "completed",
        "cancelled",
        "reopened",
        "comment_added",
        "task_accepted",
        "task_held",
        "task_rejected",
        "task_redirected",
        "task_escalated",
        "task_response",
        "task_unanimous_failed",
        "task_data_saved",
      ],
      task_priority: ["critical", "high", "medium", "low", "none"],
      task_status: [
        "draft",
        "todo",
        "in_progress",
        "blocked",
        "completed",
        "cancelled",
      ],
      tenant_plan: [
        "personal_free",
        "personal_pro",
        "business_team",
        "business_enterprise",
      ],
      user_role: ["owner", "admin", "manager", "member", "viewer"],
    },
  },
} as const

