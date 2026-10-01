export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      app_admin: {
        Row: {
          created_at: string;
          id: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          after_data: Json | null;
          before_data: Json | null;
          created_at: string;
          id: number;
          record_id: string | null;
          table_name: string;
          version_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          created_at?: string;
          id?: never;
          record_id?: string | null;
          table_name: string;
          version_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          created_at?: string;
          id?: never;
          record_id?: string | null;
          table_name?: string;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_version_id_fkey';
            columns: ['version_id'];
            isOneToOne: false;
            referencedRelation: 'published_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      content_items: {
        Row: {
          body: string | null;
          created_at: string;
          created_by: string | null;
          duration_sec: number;
          ends_at: string | null;
          id: string;
          is_commercial: boolean;
          media_ids: string[];
          priority: number;
          qr_url: string | null;
          shabbat_visibility: string;
          starts_at: string | null;
          status: string;
          time_windows: Json;
          title: string;
          title_he: string | null;
          type: string;
          updated_at: string;
          weekdays: number[];
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_sec?: number;
          ends_at?: string | null;
          id?: string;
          is_commercial?: boolean;
          media_ids?: string[];
          priority?: number;
          qr_url?: string | null;
          shabbat_visibility?: string;
          starts_at?: string | null;
          status?: string;
          time_windows?: Json;
          title: string;
          title_he?: string | null;
          type: string;
          updated_at?: string;
          weekdays?: number[];
        };
        Update: {
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_sec?: number;
          ends_at?: string | null;
          id?: string;
          is_commercial?: boolean;
          media_ids?: string[];
          priority?: number;
          qr_url?: string | null;
          shabbat_visibility?: string;
          starts_at?: string | null;
          status?: string;
          time_windows?: Json;
          title?: string;
          title_he?: string | null;
          type?: string;
          updated_at?: string;
          weekdays?: number[];
        };
        Relationships: [];
      };
      daily_study_entries: {
        Row: {
          created_at: string;
          created_by: string | null;
          hebrew_date: string | null;
          id: string;
          kind: string;
          local_date: string;
          reference: string;
          status: string;
          text_fr: string | null;
          updated_at: string;
          url: string | null;
          validated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          hebrew_date?: string | null;
          id?: string;
          kind: string;
          local_date: string;
          reference: string;
          status?: string;
          text_fr?: string | null;
          updated_at?: string;
          url?: string | null;
          validated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          hebrew_date?: string | null;
          id?: string;
          kind?: string;
          local_date?: string;
          reference?: string;
          status?: string;
          text_fr?: string | null;
          updated_at?: string;
          url?: string | null;
          validated_by?: string | null;
        };
        Relationships: [];
      };
      device_pairings: {
        Row: {
          code_hash: string;
          created_at: string;
          created_by: string | null;
          device_name: string;
          expires_at: string;
          id: string;
          used_at: string | null;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          created_by?: string | null;
          device_name: string;
          expires_at: string;
          id?: string;
          used_at?: string | null;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          created_by?: string | null;
          device_name?: string;
          expires_at?: string;
          id?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          build: string | null;
          cache_status: string | null;
          client_time: string | null;
          clock_skew_seconds: number | null;
          created_at: string;
          device_name: string;
          displayed_version: number | null;
          id: string;
          last_error_code: string | null;
          last_seen: string | null;
          revoked_at: string | null;
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          build?: string | null;
          cache_status?: string | null;
          client_time?: string | null;
          clock_skew_seconds?: number | null;
          created_at?: string;
          device_name: string;
          displayed_version?: number | null;
          id?: string;
          last_error_code?: string | null;
          last_seen?: string | null;
          revoked_at?: string | null;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          build?: string | null;
          cache_status?: string | null;
          client_time?: string | null;
          clock_skew_seconds?: number | null;
          created_at?: string;
          device_name?: string;
          displayed_version?: number | null;
          id?: string;
          last_error_code?: string | null;
          last_seen?: string | null;
          revoked_at?: string | null;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      jewish_days: {
        Row: {
          fetched_at: string;
          hebrew_date: Json;
          holiday_kinds: string[];
          holidays: string[];
          holidays_he: string[];
          local_date: string;
          omer: number | null;
          parasha: Json | null;
          rosh_hodesh: string | null;
          source_records: Json;
          study: Json;
          valid_until: string | null;
          zmanim: Json;
        };
        Insert: {
          fetched_at?: string;
          hebrew_date: Json;
          holiday_kinds?: string[];
          holidays?: string[];
          holidays_he?: string[];
          local_date: string;
          omer?: number | null;
          parasha?: Json | null;
          rosh_hodesh?: string | null;
          source_records?: Json;
          study?: Json;
          valid_until?: string | null;
          zmanim?: Json;
        };
        Update: {
          fetched_at?: string;
          hebrew_date?: Json;
          holiday_kinds?: string[];
          holidays?: string[];
          holidays_he?: string[];
          local_date?: string;
          omer?: number | null;
          parasha?: Json | null;
          rosh_hodesh?: string | null;
          source_records?: Json;
          study?: Json;
          valid_until?: string | null;
          zmanim?: Json;
        };
        Relationships: [];
      };
      layout_draft: {
        Row: {
          id: boolean;
          mode: string;
          options: Json;
          slides: Json;
          theme: string;
          updated_at: string;
          updated_by: string | null;
          zones: Json;
        };
        Insert: {
          id?: boolean;
          mode?: string;
          options?: Json;
          slides?: Json;
          theme?: string;
          updated_at?: string;
          updated_by?: string | null;
          zones?: Json;
        };
        Update: {
          id?: boolean;
          mode?: string;
          options?: Json;
          slides?: Json;
          theme?: string;
          updated_at?: string;
          updated_by?: string | null;
          zones?: Json;
        };
        Relationships: [];
      };
      media_assets: {
        Row: {
          bucket: string;
          bytes: number;
          created_at: string;
          created_by: string | null;
          error_code: string | null;
          height: number | null;
          id: string;
          kind: string;
          mime: string;
          original_name_label: string;
          page_index: number | null;
          pages: number | null;
          parent_id: string | null;
          sha256: string | null;
          status: string;
          storage_path: string;
          updated_at: string;
          variants: Json;
          width: number | null;
        };
        Insert: {
          bucket?: string;
          bytes?: number;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          height?: number | null;
          id?: string;
          kind: string;
          mime: string;
          original_name_label?: string;
          page_index?: number | null;
          pages?: number | null;
          parent_id?: string | null;
          sha256?: string | null;
          status?: string;
          storage_path: string;
          updated_at?: string;
          variants?: Json;
          width?: number | null;
        };
        Update: {
          bucket?: string;
          bytes?: number;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          height?: number | null;
          id?: string;
          kind?: string;
          mime?: string;
          original_name_label?: string;
          page_index?: number | null;
          pages?: number | null;
          parent_id?: string | null;
          sha256?: string | null;
          status?: string;
          storage_path?: string;
          updated_at?: string;
          variants?: Json;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'media_assets_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      minyan_exceptions: {
        Row: {
          cancelled: boolean;
          comment: string | null;
          created_at: string;
          id: string;
          local_date: string;
          office: string;
          time: string | null;
          updated_at: string;
        };
        Insert: {
          cancelled?: boolean;
          comment?: string | null;
          created_at?: string;
          id?: string;
          local_date: string;
          office: string;
          time?: string | null;
          updated_at?: string;
        };
        Update: {
          cancelled?: boolean;
          comment?: string | null;
          created_at?: string;
          id?: string;
          local_date?: string;
          office?: string;
          time?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      minyan_rules: {
        Row: {
          active: boolean;
          created_at: string;
          day_kinds: string[];
          id: string;
          office: string;
          priority: number;
          status: string;
          time: string;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
          weekdays: number[];
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          day_kinds?: string[];
          id?: string;
          office: string;
          priority?: number;
          status?: string;
          time: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          weekdays?: number[];
        };
        Update: {
          active?: boolean;
          created_at?: string;
          day_kinds?: string[];
          id?: string;
          office?: string;
          priority?: number;
          status?: string;
          time?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          weekdays?: number[];
        };
        Relationships: [];
      };
      public_state: {
        Row: {
          current_version_id: string | null;
          current_version_number: number;
          id: boolean;
          published_at: string | null;
          updated_at: string;
        };
        Insert: {
          current_version_id?: string | null;
          current_version_number?: number;
          id?: boolean;
          published_at?: string | null;
          updated_at?: string;
        };
        Update: {
          current_version_id?: string | null;
          current_version_number?: number;
          id?: boolean;
          published_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'public_state_current_version_id_fkey';
            columns: ['current_version_id'];
            isOneToOne: false;
            referencedRelation: 'published_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      published_versions: {
        Row: {
          created_at: string;
          created_by: string | null;
          draft_snapshot: Json;
          id: string;
          media_manifest: Json;
          package: Json;
          package_hash: string;
          restored_from: string | null;
          source: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          draft_snapshot: Json;
          id?: string;
          media_manifest?: Json;
          package: Json;
          package_hash: string;
          restored_from?: string | null;
          source: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          draft_snapshot?: Json;
          id?: string;
          media_manifest?: Json;
          package?: Json;
          package_hash?: string;
          restored_from?: string | null;
          source?: string;
          version_number?: number;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          count: number;
          key: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          key: string;
          window_start: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      refresh_locks: {
        Row: {
          lock_name: string;
          locked_until: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          lock_name: string;
          locked_until: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          lock_name?: string;
          locked_until?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          alot_angle: number;
          approved_at: string | null;
          approved_by: string | null;
          audit_retention_days: number;
          candle_lighting_minutes: number;
          havdalah_mode: string;
          hebrew_day_change: string;
          hide_commercial_on_chol_hamoed: boolean;
          id: boolean;
          latitude: number;
          longitude: number;
          media_active_budget_mb: number;
          misheyakir_angle: number;
          rambam_cycle: string;
          religious_method_params: Json;
          religious_method_status: string;
          site_address: string;
          site_name: string;
          sponsor_margin_after_min: number;
          sponsor_margin_before_min: number;
          timezone: string;
          updated_at: string;
          version_retention: number;
        };
        Insert: {
          alot_angle?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          audit_retention_days?: number;
          candle_lighting_minutes?: number;
          havdalah_mode?: string;
          hebrew_day_change?: string;
          hide_commercial_on_chol_hamoed?: boolean;
          id?: boolean;
          latitude?: number;
          longitude?: number;
          media_active_budget_mb?: number;
          misheyakir_angle?: number;
          rambam_cycle?: string;
          religious_method_params?: Json;
          religious_method_status?: string;
          site_address?: string;
          site_name?: string;
          sponsor_margin_after_min?: number;
          sponsor_margin_before_min?: number;
          timezone?: string;
          updated_at?: string;
          version_retention?: number;
        };
        Update: {
          alot_angle?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          audit_retention_days?: number;
          candle_lighting_minutes?: number;
          havdalah_mode?: string;
          hebrew_day_change?: string;
          hide_commercial_on_chol_hamoed?: boolean;
          id?: boolean;
          latitude?: number;
          longitude?: number;
          media_active_budget_mb?: number;
          misheyakir_angle?: number;
          rambam_cycle?: string;
          religious_method_params?: Json;
          religious_method_status?: string;
          site_address?: string;
          site_name?: string;
          sponsor_margin_after_min?: number;
          sponsor_margin_before_min?: number;
          timezone?: string;
          updated_at?: string;
          version_retention?: number;
        };
        Relationships: [];
      };
      source_health: {
        Row: {
          data_age_seconds: number | null;
          data_hash: string | null;
          fallback_available: boolean;
          last_error_at: string | null;
          last_error_code: string | null;
          last_failure_at: string | null;
          last_success_at: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          data_age_seconds?: number | null;
          data_hash?: string | null;
          fallback_available?: boolean;
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          source: string;
          updated_at?: string;
        };
        Update: {
          data_age_seconds?: number | null;
          data_hash?: string | null;
          fallback_available?: boolean;
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      source_records: {
        Row: {
          created_at: string;
          fetched_at: string;
          id: string;
          instant: string | null;
          kind: string;
          local_date: string | null;
          method: Json;
          override_by: string | null;
          override_expires_at: string | null;
          override_value: Json | null;
          params: Json;
          provider: string;
          source_id: string | null;
          status: string;
          valid_until: string | null;
          value: Json;
        };
        Insert: {
          created_at?: string;
          fetched_at: string;
          id?: string;
          instant?: string | null;
          kind: string;
          local_date?: string | null;
          method?: Json;
          override_by?: string | null;
          override_expires_at?: string | null;
          override_value?: Json | null;
          params?: Json;
          provider: string;
          source_id?: string | null;
          status?: string;
          valid_until?: string | null;
          value: Json;
        };
        Update: {
          created_at?: string;
          fetched_at?: string;
          id?: string;
          instant?: string | null;
          kind?: string;
          local_date?: string | null;
          method?: Json;
          override_by?: string | null;
          override_expires_at?: string | null;
          override_value?: Json | null;
          params?: Json;
          provider?: string;
          source_id?: string | null;
          status?: string;
          valid_until?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      weather_cache: {
        Row: {
          attribution: string;
          expires_at: string | null;
          id: boolean;
          last_modified: string | null;
          payload: Json;
          symbol: string | null;
          temperature_c: number | null;
          updated_at: string | null;
        };
        Insert: {
          attribution?: string;
          expires_at?: string | null;
          id?: boolean;
          last_modified?: string | null;
          payload?: Json;
          symbol?: string | null;
          temperature_c?: number | null;
          updated_at?: string | null;
        };
        Update: {
          attribution?: string;
          expires_at?: string | null;
          id?: boolean;
          last_modified?: string | null;
          payload?: Json;
          symbol?: string | null;
          temperature_c?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      device_status: {
        Row: {
          build: string | null;
          cache_status: string | null;
          client_time: string | null;
          clock_skew_seconds: number | null;
          device_name: string | null;
          displayed_version: number | null;
          id: string | null;
          last_error_code: string | null;
          last_seen: string | null;
          online: boolean | null;
          revoked_at: string | null;
        };
        Insert: {
          build?: string | null;
          cache_status?: string | null;
          client_time?: string | null;
          clock_skew_seconds?: number | null;
          device_name?: string | null;
          displayed_version?: number | null;
          id?: string | null;
          last_error_code?: string | null;
          last_seen?: string | null;
          online?: never;
          revoked_at?: string | null;
        };
        Update: {
          build?: string | null;
          cache_status?: string | null;
          client_time?: string | null;
          clock_skew_seconds?: number | null;
          device_name?: string | null;
          displayed_version?: number | null;
          id?: string | null;
          last_error_code?: string | null;
          last_seen?: string | null;
          online?: never;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      consume_device_pairing: {
        Args: { p_code_hash: string; p_token_hash: string };
        Returns: string;
      };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_start: string };
        Returns: boolean;
      };
      is_admin: { Args: never; Returns: boolean };
      publish_package: {
        Args: {
          p_actor: string;
          p_expected_number: number;
          p_hash: string;
          p_manifest: Json;
          p_package: Json;
          p_restored_from: string;
          p_snapshot: Json;
          p_source: string;
        };
        Returns: {
          id: string;
          version_number: number;
        }[];
      };
      purge_old_versions: { Args: never; Returns: number };
      release_refresh_lock: {
        Args: { p_lock_name: string; p_owner_id: string };
        Returns: boolean;
      };
      try_acquire_refresh_lock: {
        Args: { p_lock_name: string; p_owner_id: string; p_ttl_seconds: number };
        Returns: boolean;
      };
      upsert_calendar_refresh: {
        Args: {
          p_data_hash: string;
          p_days: Json;
          p_records: Json;
          p_success_at: string;
        };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
