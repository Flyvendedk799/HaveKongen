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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_recommendations: {
        Row: {
          body: string | null
          created_at: string
          data: Json | null
          garden_id: string | null
          id: string
          kind: string
          resolved_at: string | null
          severity: string
          status: string
          title: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json | null
          garden_id?: string | null
          id?: string
          kind: string
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json | null
          garden_id?: string | null
          id?: string
          kind?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      animal_life_list: {
        Row: {
          confidence: string | null
          created_at: string
          first_observed_at: string
          garden_id: string | null
          id: string
          kind: string
          last_observed_at: string
          latin: string | null
          name_da: string
          notes: string | null
          observation_count: number
          source: string
          species_key: string
          user_id: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          first_observed_at?: string
          garden_id?: string | null
          id?: string
          kind?: string
          last_observed_at?: string
          latin?: string | null
          name_da: string
          notes?: string | null
          observation_count?: number
          source?: string
          species_key: string
          user_id: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          first_observed_at?: string
          garden_id?: string | null
          id?: string
          kind?: string
          last_observed_at?: string
          latin?: string | null
          name_da?: string
          notes?: string | null
          observation_count?: number
          source?: string
          species_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "animal_life_list_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_blocks: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      daily_briefings: {
        Row: {
          alerts: Json
          created_at: string
          for_date: string
          garden_id: string | null
          id: string
          summary: string | null
          tasks: Json
          tip: string | null
          user_id: string
          weather: string | null
        }
        Insert: {
          alerts?: Json
          created_at?: string
          for_date: string
          garden_id?: string | null
          id?: string
          summary?: string | null
          tasks?: Json
          tip?: string | null
          user_id: string
          weather?: string | null
        }
        Update: {
          alerts?: Json
          created_at?: string
          for_date?: string
          garden_id?: string | null
          id?: string
          summary?: string | null
          tasks?: Json
          tip?: string | null
          user_id?: string
          weather?: string | null
        }
        Relationships: []
      }
      device_actions: {
        Row: {
          action: string | null
          approved_at: string | null
          created_at: string
          device_id: string | null
          garden_id: string | null
          id: string
          kind: string | null
          payload: Json
          reason: string | null
          requested_at: string
          status: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          action?: string | null
          approved_at?: string | null
          created_at?: string
          device_id?: string | null
          garden_id?: string | null
          id?: string
          kind?: string | null
          payload?: Json
          reason?: string | null
          requested_at?: string
          status?: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          action?: string | null
          approved_at?: string | null
          created_at?: string
          device_id?: string | null
          garden_id?: string | null
          id?: string
          kind?: string | null
          payload?: Json
          reason?: string | null
          requested_at?: string
          status?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_actions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_actions_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      device_readings: {
        Row: {
          created_at: string
          data: Json
          device_id: string | null
          garden_id: string | null
          id: string
          kind: string
          observed_at: string
          unit: string | null
          user_id: string
          value: number | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json
          device_id?: string | null
          garden_id?: string | null
          id?: string
          kind: string
          observed_at?: string
          unit?: string | null
          user_id: string
          value?: number | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          device_id?: string | null
          garden_id?: string | null
          id?: string
          kind?: string
          observed_at?: string
          unit?: string | null
          user_id?: string
          value?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_readings_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          autopilot_enabled: boolean
          battery: number | null
          created_at: string
          garden_id: string | null
          id: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen: string | null
          map_position: Json | null
          metadata: Json | null
          name: string
          status: string
          user_id: string
        }
        Insert: {
          autopilot_enabled?: boolean
          battery?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen?: string | null
          map_position?: Json | null
          metadata?: Json | null
          name: string
          status?: string
          user_id: string
        }
        Update: {
          autopilot_enabled?: boolean
          battery?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          last_seen?: string | null
          map_position?: Json | null
          metadata?: Json | null
          name?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_journal: {
        Row: {
          caption: string | null
          created_at: string
          data: Json
          garden_id: string | null
          id: string
          image_url: string | null
          kind: string
          plant_id: string | null
          user_id: string
          zone_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          data?: Json
          garden_id?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          plant_id?: string | null
          user_id: string
          zone_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          data?: Json
          garden_id?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          plant_id?: string | null
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      garden_observations: {
        Row: {
          ai_result: Json
          anchor: Json
          caption: string | null
          confidence: number | null
          created_at: string
          garden_id: string | null
          id: string
          image_url: string | null
          kind: string
          plant_id: string | null
          user_id: string
          zone_id: string | null
        }
        Insert: {
          ai_result?: Json
          anchor?: Json
          caption?: string | null
          confidence?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          image_url?: string | null
          kind: string
          plant_id?: string | null
          user_id: string
          zone_id?: string | null
        }
        Update: {
          ai_result?: Json
          anchor?: Json
          caption?: string | null
          confidence?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          plant_id?: string | null
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "garden_observations_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_scan_events: {
        Row: {
          created_at: string
          event_type: string
          garden_id: string
          id: string
          payload: Json
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          garden_id: string
          id?: string
          payload?: Json
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          garden_id?: string
          id?: string
          payload?: Json
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_scan_events_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garden_scan_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "garden_scan_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_scan_sessions: {
        Row: {
          anchors: Json
          capture_client_version: string | null
          capture_metadata: Json
          claimed_by: string | null
          confidence: number | null
          created_at: string
          device_capabilities: Json
          device_model: string | null
          error_code: string | null
          error_detail: string | null
          garden_id: string
          id: string
          last_status_at: string
          manifest_path: string | null
          media_retention_until: string
          pipeline_version: string
          processing_attempts: number
          processing_finished_at: string | null
          processing_started_at: string | null
          result_json: Json | null
          source: string | null
          status: string
          status_history: Json
          updated_at: string
          upload_prefix: string | null
          user_id: string
          warnings: Json
        }
        Insert: {
          anchors?: Json
          capture_client_version?: string | null
          capture_metadata?: Json
          claimed_by?: string | null
          confidence?: number | null
          created_at?: string
          device_capabilities?: Json
          device_model?: string | null
          error_code?: string | null
          error_detail?: string | null
          garden_id: string
          id?: string
          last_status_at?: string
          manifest_path?: string | null
          media_retention_until?: string
          pipeline_version?: string
          processing_attempts?: number
          processing_finished_at?: string | null
          processing_started_at?: string | null
          result_json?: Json | null
          source?: string | null
          status?: string
          status_history?: Json
          updated_at?: string
          upload_prefix?: string | null
          user_id: string
          warnings?: Json
        }
        Update: {
          anchors?: Json
          capture_client_version?: string | null
          capture_metadata?: Json
          claimed_by?: string | null
          confidence?: number | null
          created_at?: string
          device_capabilities?: Json
          device_model?: string | null
          error_code?: string | null
          error_detail?: string | null
          garden_id?: string
          id?: string
          last_status_at?: string
          manifest_path?: string | null
          media_retention_until?: string
          pipeline_version?: string
          processing_attempts?: number
          processing_finished_at?: string | null
          processing_started_at?: string | null
          result_json?: Json | null
          source?: string | null
          status?: string
          status_history?: Json
          updated_at?: string
          upload_prefix?: string | null
          user_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "garden_scan_sessions_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_zones: {
        Row: {
          area_m2: number | null
          created_at: string
          garden_id: string
          id: string
          microclimate: Json | null
          mulch: boolean | null
          name: string
          polygon: Json | null
          shade_pct: number | null
          slope: string | null
          soil: string | null
          sun_exposure: string | null
          type: Database["public"]["Enums"]["zone_type"]
          user_id: string
          wind_exposure: string | null
        }
        Insert: {
          area_m2?: number | null
          created_at?: string
          garden_id: string
          id?: string
          microclimate?: Json | null
          mulch?: boolean | null
          name: string
          polygon?: Json | null
          shade_pct?: number | null
          slope?: string | null
          soil?: string | null
          sun_exposure?: string | null
          type?: Database["public"]["Enums"]["zone_type"]
          user_id: string
          wind_exposure?: string | null
        }
        Update: {
          area_m2?: number | null
          created_at?: string
          garden_id?: string
          id?: string
          microclimate?: Json | null
          mulch?: boolean | null
          name?: string
          polygon?: Json | null
          shade_pct?: number | null
          slope?: string | null
          soil?: string | null
          sun_exposure?: string | null
          type?: Database["public"]["Enums"]["zone_type"]
          user_id?: string
          wind_exposure?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "garden_zones_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      gardens: {
        Row: {
          address: string | null
          area_m2: number | null
          created_at: string
          depth_model: Json | null
          depth_model_updated_at: string | null
          exclusions: Json | null
          id: string
          imagery_source: string | null
          latitude: number | null
          longitude: number | null
          name: string
          polygon: Json | null
          preferences: Json
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          depth_model?: Json | null
          depth_model_updated_at?: string | null
          exclusions?: Json | null
          id?: string
          imagery_source?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          preferences?: Json
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          depth_model?: Json | null
          depth_model_updated_at?: string | null
          exclusions?: Json | null
          id?: string
          imagery_source?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          preferences?: Json
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      havemaaler_segmentation_events: {
        Row: {
          accepted: boolean | null
          algorithm_version: string | null
          client_context: Json
          confidence: number | null
          created_at: string
          crop_hash: string | null
          diagnostics: Json
          event_name: string
          id: string
          imagery_source: string | null
          needs_review: boolean | null
          seed_counts: Json
          session_id: string
          strictness: string | null
          user_id: string | null
          warnings: string[]
        }
        Insert: {
          accepted?: boolean | null
          algorithm_version?: string | null
          client_context?: Json
          confidence?: number | null
          created_at?: string
          crop_hash?: string | null
          diagnostics?: Json
          event_name: string
          id?: string
          imagery_source?: string | null
          needs_review?: boolean | null
          seed_counts?: Json
          session_id: string
          strictness?: string | null
          user_id?: string | null
          warnings?: string[]
        }
        Update: {
          accepted?: boolean | null
          algorithm_version?: string | null
          client_context?: Json
          confidence?: number | null
          created_at?: string
          crop_hash?: string | null
          diagnostics?: Json
          event_name?: string
          id?: string
          imagery_source?: string | null
          needs_review?: boolean | null
          seed_counts?: Json
          session_id?: string
          strictness?: string | null
          user_id?: string | null
          warnings?: string[]
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          created_at: string
          display_name: string | null
          garden_id: string | null
          id: string
          kind: string
          last_sync_at: string | null
          provider: string
          settings: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          garden_id?: string | null
          id?: string
          kind: string
          last_sync_at?: string | null
          provider: string
          settings?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          garden_id?: string | null
          id?: string
          kind?: string
          last_sync_at?: string | null
          provider?: string
          settings?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      lawn_segmentation_cache: {
        Row: {
          bbox_hash: string
          created_at: string
          polygon: Json
          source: string
        }
        Insert: {
          bbox_hash: string
          created_at?: string
          polygon: Json
          source?: string
        }
        Update: {
          bbox_hash?: string
          created_at?: string
          polygon?: Json
          source?: string
        }
        Relationships: []
      }
      neighbor_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "neighbor_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "neighbor_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      neighbor_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "neighbor_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "neighbor_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      neighbor_posts: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          image_url: string | null
          kind: string
          postal_code: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          image_url?: string | null
          kind?: string
          postal_code?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          image_url?: string | null
          kind?: string
          postal_code?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          gradient: string | null
          id: string
          image_url: string | null
          line_discount_oere: number
          line_total_oere: number
          name: string
          order_id: string
          product_id: string | null
          product_slug: string | null
          qty: number
          sku: string | null
          svg_art: string | null
          unit_price_dkk: number
          unit_price_oere: number
          user_id: string
          variant_id: string | null
          variant_name: string | null
          vat_oere: number
          vat_rate: number
        }
        Insert: {
          gradient?: string | null
          id?: string
          image_url?: string | null
          line_discount_oere?: number
          line_total_oere?: number
          name: string
          order_id: string
          product_id?: string | null
          product_slug?: string | null
          qty?: number
          sku?: string | null
          svg_art?: string | null
          unit_price_dkk: number
          unit_price_oere?: number
          user_id: string
          variant_id?: string | null
          variant_name?: string | null
          vat_oere?: number
          vat_rate?: number
        }
        Update: {
          gradient?: string | null
          id?: string
          image_url?: string | null
          line_discount_oere?: number
          line_total_oere?: number
          name?: string
          order_id?: string
          product_id?: string | null
          product_slug?: string | null
          qty?: number
          sku?: string | null
          svg_art?: string | null
          unit_price_dkk?: number
          unit_price_oere?: number
          user_id?: string
          variant_id?: string | null
          variant_name?: string | null
          vat_oere?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: Json | null
          cancelled_at: string | null
          created_at: string
          currency: string
          delivered_at: string | null
          discount_code: string | null
          discount_oere: number
          email: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          order_no: string | null
          paid_at: string | null
          payment_provider: string | null
          payment_status: string
          phone: string | null
          placed_at: string | null
          refunded_at: string | null
          shipping_address: Json | null
          shipping_method: string | null
          shipping_oere: number
          shipping_status: string
          shipped_at: string | null
          status: string
          subtotal_oere: number
          total_dkk: number
          total_oere: number
          tracking_number: string | null
          updated_at: string
          user_id: string
          vat_oere: number
        }
        Insert: {
          billing_address?: Json | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          discount_code?: string | null
          discount_oere?: number
          email?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_no?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_status?: string
          phone?: string | null
          placed_at?: string | null
          refunded_at?: string | null
          shipping_address?: Json | null
          shipping_method?: string | null
          shipping_oere?: number
          shipping_status?: string
          shipped_at?: string | null
          status?: string
          subtotal_oere?: number
          total_dkk: number
          total_oere?: number
          tracking_number?: string | null
          updated_at?: string
          user_id: string
          vat_oere?: number
        }
        Update: {
          billing_address?: Json | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          discount_code?: string | null
          discount_oere?: number
          email?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          order_no?: string | null
          paid_at?: string | null
          payment_provider?: string | null
          payment_status?: string
          phone?: string | null
          placed_at?: string | null
          refunded_at?: string | null
          shipping_address?: Json | null
          shipping_method?: string | null
          shipping_oere?: number
          shipping_status?: string
          shipped_at?: string | null
          status?: string
          subtotal_oere?: number
          total_dkk?: number
          total_oere?: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
          vat_oere?: number
        }
        Relationships: []
      }
      plant_growth_snapshots: {
        Row: {
          ai_result: Json
          anomaly_flags: string[]
          created_at: string
          estimated_height_cm: number | null
          flowering: boolean | null
          fruiting: boolean | null
          garden_id: string | null
          harvest_readiness: string | null
          id: string
          observation_id: string | null
          plant_id: string | null
          stage: string | null
          user_id: string
          vigor: string | null
          zone_id: string | null
        }
        Insert: {
          ai_result?: Json
          anomaly_flags?: string[]
          created_at?: string
          estimated_height_cm?: number | null
          flowering?: boolean | null
          fruiting?: boolean | null
          garden_id?: string | null
          harvest_readiness?: string | null
          id?: string
          observation_id?: string | null
          plant_id?: string | null
          stage?: string | null
          user_id: string
          vigor?: string | null
          zone_id?: string | null
        }
        Update: {
          ai_result?: Json
          anomaly_flags?: string[]
          created_at?: string
          estimated_height_cm?: number | null
          flowering?: boolean | null
          fruiting?: boolean | null
          garden_id?: string | null
          harvest_readiness?: string | null
          id?: string
          observation_id?: string | null
          plant_id?: string | null
          stage?: string | null
          user_id?: string
          vigor?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plant_growth_snapshots_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plant_growth_snapshots_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "garden_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_health_log: {
        Row: {
          causes: string[] | null
          confidence: number | null
          created_at: string
          diagnosis: string | null
          garden_id: string | null
          id: string
          image_url: string | null
          observation_id: string | null
          plant_id: string | null
          prevention: string | null
          product_suggestions: Json | null
          raw: Json | null
          severity: string | null
          symptoms: string[] | null
          treatment: string | null
          user_id: string
          zone_id: string | null
        }
        Insert: {
          causes?: string[] | null
          confidence?: number | null
          created_at?: string
          diagnosis?: string | null
          garden_id?: string | null
          id?: string
          image_url?: string | null
          observation_id?: string | null
          plant_id?: string | null
          prevention?: string | null
          product_suggestions?: Json | null
          raw?: Json | null
          severity?: string | null
          symptoms?: string[] | null
          treatment?: string | null
          user_id: string
          zone_id?: string | null
        }
        Update: {
          causes?: string[] | null
          confidence?: number | null
          created_at?: string
          diagnosis?: string | null
          garden_id?: string | null
          id?: string
          image_url?: string | null
          observation_id?: string | null
          plant_id?: string | null
          prevention?: string | null
          product_suggestions?: Json | null
          raw?: Json | null
          severity?: string | null
          symptoms?: string[] | null
          treatment?: string | null
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plant_health_log_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
        ]
      }
      plants_catalog: {
        Row: {
          antagonist_plants: string[] | null
          category: string | null
          companion_plants: string[] | null
          created_at: string
          description: string | null
          disease_risks: string[] | null
          frost_risk: string | null
          harvest_months: number[] | null
          image_url: string | null
          kc: number | null
          latin: string | null
          month_tasks: Json | null
          name_da: string
          prikle_weeks_after_sow: number | null
          prune_months: number[] | null
          root_depth_cm: number | null
          slug: string
          sow_months: number[] | null
          sun: string | null
          transplant_months: number[] | null
          water_need: string | null
          winterize_months: number[] | null
        }
        Insert: {
          antagonist_plants?: string[] | null
          category?: string | null
          companion_plants?: string[] | null
          created_at?: string
          description?: string | null
          disease_risks?: string[] | null
          frost_risk?: string | null
          harvest_months?: number[] | null
          image_url?: string | null
          kc?: number | null
          latin?: string | null
          month_tasks?: Json | null
          name_da: string
          prikle_weeks_after_sow?: number | null
          prune_months?: number[] | null
          root_depth_cm?: number | null
          slug: string
          sow_months?: number[] | null
          sun?: string | null
          transplant_months?: number[] | null
          water_need?: string | null
          winterize_months?: number[] | null
        }
        Update: {
          antagonist_plants?: string[] | null
          category?: string | null
          companion_plants?: string[] | null
          created_at?: string
          description?: string | null
          disease_risks?: string[] | null
          frost_risk?: string | null
          harvest_months?: number[] | null
          image_url?: string | null
          kc?: number | null
          latin?: string | null
          month_tasks?: Json | null
          name_da?: string
          prikle_weeks_after_sow?: number | null
          prune_months?: number[] | null
          root_depth_cm?: number | null
          slug?: string
          sow_months?: number[] | null
          sun?: string | null
          transplant_months?: number[] | null
          water_need?: string | null
          winterize_months?: number[] | null
        }
        Relationships: []
      }
      product_media: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          sort: number
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          sort?: number
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          sort?: number
          url?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          id: string
          in_stock: boolean
          low_stock_threshold: number
          name: string
          price_dkk: number
          product_id: string
          sku: string | null
          stock_qty: number
          track_inventory: boolean
        }
        Insert: {
          id?: string
          in_stock?: boolean
          low_stock_threshold?: number
          name: string
          price_dkk: number
          product_id: string
          sku?: string | null
          stock_qty?: number
          track_inventory?: boolean
        }
        Update: {
          id?: string
          in_stock?: boolean
          low_stock_threshold?: number
          name?: string
          price_dkk?: number
          product_id?: string
          sku?: string | null
          stock_qty?: number
          track_inventory?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          base_price_dkk: number
          category: string
          created_at: string
          description: string | null
          featured: boolean
          gradient: string | null
          id: string
          image_url: string | null
          in_stock: boolean
          low_stock_threshold: number
          meta: string | null
          name: string
          rating_avg: number
          rating_count: number
          short_description: string | null
          sku: string | null
          slug: string
          stock_qty: number
          svg_art: string | null
          track_inventory: boolean
          updated_at: string
          vat_rate: number
          weight_grams: number | null
        }
        Insert: {
          active?: boolean
          base_price_dkk: number
          category: string
          created_at?: string
          description?: string | null
          featured?: boolean
          gradient?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean
          low_stock_threshold?: number
          meta?: string | null
          name: string
          rating_avg?: number
          rating_count?: number
          short_description?: string | null
          sku?: string | null
          slug: string
          stock_qty?: number
          svg_art?: string | null
          track_inventory?: boolean
          updated_at?: string
          vat_rate?: number
          weight_grams?: number | null
        }
        Update: {
          active?: boolean
          base_price_dkk?: number
          category?: string
          created_at?: string
          description?: string | null
          featured?: boolean
          gradient?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean
          low_stock_threshold?: number
          meta?: string | null
          name?: string
          rating_avg?: number
          rating_count?: number
          short_description?: string | null
          sku?: string | null
          slug?: string
          stock_qty?: number
          svg_art?: string | null
          track_inventory?: boolean
          updated_at?: string
          vat_rate?: number
          weight_grams?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          name: string | null
          onboarded_at: string | null
          deletion_requested_at: string | null
          locale: string
          marketing_opt_in: boolean
          phone: string | null
          postal_code: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          id: string
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          onboarded_at?: string | null
          deletion_requested_at?: string | null
          locale?: string
          marketing_opt_in?: boolean
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          onboarded_at?: string | null
          deletion_requested_at?: string | null
          locale?: string
          marketing_opt_in?: boolean
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seed_swaps: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          plant_slug: string | null
          postal_code: string | null
          qty: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          wants: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          plant_slug?: string | null
          postal_code?: string | null
          qty?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          wants?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          plant_slug?: string | null
          postal_code?: string | null
          qty?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          wants?: string | null
        }
        Relationships: []
      }
      task_log: {
        Row: {
          confidence: number | null
          created_at: string
          done: boolean
          done_at: string | null
          due_at: string | null
          garden_id: string | null
          id: string
          kind: string
          notes: string | null
          observation_id: string | null
          payload: Json
          plant_id: string | null
          priority: string | null
          reason: string | null
          snoozed_until: string | null
          source: string | null
          title: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          garden_id?: string | null
          id?: string
          kind: string
          notes?: string | null
          observation_id?: string | null
          payload?: Json
          plant_id?: string | null
          priority?: string | null
          reason?: string | null
          snoozed_until?: string | null
          source?: string | null
          title: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          garden_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          observation_id?: string | null
          payload?: Json
          plant_id?: string | null
          priority?: string | null
          reason?: string | null
          snoozed_until?: string | null
          source?: string | null
          title?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      user_plants: {
        Row: {
          created_at: string
          custom_name: string | null
          garden_id: string
          health_status: string | null
          id: string
          image_url: string | null
          last_observed_at: string | null
          lifecycle_status: string | null
          map_position: Json | null
          notes: string | null
          plant_slug: string | null
          planted_at: string | null
          qty: number
          user_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          garden_id: string
          health_status?: string | null
          id?: string
          image_url?: string | null
          last_observed_at?: string | null
          lifecycle_status?: string | null
          map_position?: Json | null
          notes?: string | null
          plant_slug?: string | null
          planted_at?: string | null
          qty?: number
          user_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          garden_id?: string
          health_status?: string | null
          id?: string
          image_url?: string | null
          last_observed_at?: string | null
          lifecycle_status?: string | null
          map_position?: Json | null
          notes?: string | null
          plant_slug?: string | null
          planted_at?: string | null
          qty?: number
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_plants_garden_id_fkey"
            columns: ["garden_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_plants_plant_slug_fkey"
            columns: ["plant_slug"]
            isOneToOne: false
            referencedRelation: "plants_catalog"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "user_plants_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "garden_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watering_events: {
        Row: {
          created_at: string
          id: string
          mm_delivered: number | null
          ran_at: string | null
          reason: string | null
          schedule_id: string | null
          scheduled_for: string
          user_id: string
          weather_skipped: boolean
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mm_delivered?: number | null
          ran_at?: string | null
          reason?: string | null
          schedule_id?: string | null
          scheduled_for: string
          user_id: string
          weather_skipped?: boolean
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mm_delivered?: number | null
          ran_at?: string | null
          reason?: string | null
          schedule_id?: string | null
          scheduled_for?: string
          user_id?: string
          weather_skipped?: boolean
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "watering_events_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "watering_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watering_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "garden_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      watering_runs: {
        Row: {
          created_at: string
          id: string
          liters: number | null
          mm: number | null
          notes: string | null
          ran_at: string
          schedule_id: string | null
          source: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          liters?: number | null
          mm?: number | null
          notes?: string | null
          ran_at?: string
          schedule_id?: string | null
          source?: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          liters?: number | null
          mm?: number | null
          notes?: string | null
          ran_at?: string
          schedule_id?: string | null
          source?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      watering_schedules: {
        Row: {
          ai_adjusted: boolean
          created_at: string
          duration_min: number
          enabled: boolean
          id: string
          name: string
          rule: Json | null
          start_time: string
          user_id: string
          weekday_mask: number
          zone_id: string
        }
        Insert: {
          ai_adjusted?: boolean
          created_at?: string
          duration_min?: number
          enabled?: boolean
          id?: string
          name?: string
          rule?: Json | null
          start_time?: string
          user_id: string
          weekday_mask?: number
          zone_id: string
        }
        Update: {
          ai_adjusted?: boolean
          created_at?: string
          duration_min?: number
          enabled?: boolean
          id?: string
          name?: string
          rule?: Json | null
          start_time?: string
          user_id?: string
          weekday_mask?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watering_schedules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "garden_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_cache: {
        Row: {
          date: string
          et0: number | null
          fetched_at: string
          id: string
          lat: number
          lng: number
          precip_mm: number
          temp_max: number | null
          temp_min: number | null
          wind_max: number | null
        }
        Insert: {
          date: string
          et0?: number | null
          fetched_at?: string
          id?: string
          lat: number
          lng: number
          precip_mm?: number
          temp_max?: number | null
          temp_min?: number | null
          wind_max?: number | null
        }
        Update: {
          date?: string
          et0?: number | null
          fetched_at?: string
          id?: string
          lat?: number
          lng?: number
          precip_mm?: number
          temp_max?: number | null
          temp_min?: number | null
          wind_max?: number | null
        }
        Relationships: []
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: []
      }
account_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          reason: string | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          is_default_billing: boolean
          is_default_shipping: boolean
          label: string | null
          name: string
          phone: string | null
          postal_code: string
          street: string
          street2: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          name: string
          phone?: string | null
          postal_code: string
          street: string
          street2?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          name?: string
          phone?: string | null
          postal_code?: string
          street?: string
          street2?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          anon_key: string | null
          calls: number
          day: string
          fn: string
          id: string
          tokens_in: number
          tokens_out: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          anon_key?: string | null
          calls?: number
          day?: string
          fn: string
          id?: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          anon_key?: string | null
          calls?: number
          day?: string
          fn?: string
          id?: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      consents: {
        Row: {
          analytics: boolean
          anon_id: string | null
          created_at: string
          functional: boolean
          id: string
          marketing: boolean
          necessary: boolean
          policy_version: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          analytics?: boolean
          anon_id?: string | null
          created_at?: string
          functional?: boolean
          id?: string
          marketing?: boolean
          necessary?: boolean
          policy_version?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          analytics?: boolean
          anon_id?: string | null
          created_at?: string
          functional?: boolean
          id?: string
          marketing?: boolean
          necessary?: boolean
          policy_version?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          admin_note: string | null
          body: string
          created_at: string
          email: string
          id: string
          name: string
          order_no: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          body: string
          created_at?: string
          email: string
          id?: string
          name: string
          order_no?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          body?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          order_no?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      discount_codes: {
        Row: {
          active: boolean
          category: string | null
          code: string
          created_at: string
          description: string | null
          ends_at: string | null
          kind: string
          max_redemptions: number | null
          min_subtotal_oere: number
          per_user_limit: number
          redemptions: number
          starts_at: string | null
          value: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          code: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          kind: string
          max_redemptions?: number | null
          min_subtotal_oere?: number
          per_user_limit?: number
          redemptions?: number
          starts_at?: string | null
          value?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          kind?: string
          max_redemptions?: number | null
          min_subtotal_oere?: number
          per_user_limit?: number
          redemptions?: number
          starts_at?: string | null
          value?: number
        }
        Relationships: []
      }
      discount_redemptions: {
        Row: {
          amount_oere: number
          code: string
          created_at: string
          id: string
          order_id: string | null
          user_id: string
        }
        Insert: {
          amount_oere?: number
          code: string
          created_at?: string
          id?: string
          order_id?: string | null
          user_id: string
        }
        Update: {
          amount_oere?: number
          code?: string
          created_at?: string
          id?: string
          order_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          created_at: string
          delta: number
          id: string
          note: string | null
          order_id: string | null
          product_id: string | null
          reason: string
          variant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta: number
          id?: string
          note?: string | null
          order_id?: string | null
          product_id?: string | null
          reason: string
          variant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          note?: string | null
          order_id?: string | null
          product_id?: string | null
          reason?: string
          variant_id?: string | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          source: string | null
          status: string
          token: string
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          source?: string | null
          status?: string
          token?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          source?: string | null
          status?: string
          token?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          created_at: string
          from_status: string | null
          id: string
          kind: string
          message: string | null
          meta: Json
          order_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          from_status?: string | null
          id?: string
          kind: string
          message?: string | null
          meta?: Json
          order_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          message?: string | null
          meta?: Json
          order_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      order_return_items: {
        Row: {
          id: string
          order_item_id: string
          qty: number
          return_id: string
        }
        Insert: {
          id?: string
          order_item_id: string
          qty: number
          return_id: string
        }
        Update: {
          id?: string
          order_item_id?: string
          qty?: number
          return_id?: string
        }
        Relationships: []
      }
      order_returns: {
        Row: {
          admin_note: string | null
          comment: string | null
          created_at: string
          id: string
          order_id: string
          reason: string
          refund_oere: number
          resolved_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          order_id: string
          reason: string
          refund_oere?: number
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string
          reason?: string
          refund_oere?: number
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_oere: number
          created_at: string
          currency: string
          id: string
          instructions: Json | null
          order_id: string
          paid_at: string | null
          provider: string
          raw: Json
          reference: string | null
          refunded_oere: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_oere: number
          created_at?: string
          currency?: string
          id?: string
          instructions?: Json | null
          order_id: string
          paid_at?: string | null
          provider: string
          raw?: Json
          reference?: string | null
          refunded_oere?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_oere?: number
          created_at?: string
          currency?: string
          id?: string
          instructions?: Json | null
          order_id?: string
          paid_at?: string | null
          provider?: string
          raw?: Json
          reference?: string | null
          refunded_oere?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_reviews: {
        Row: {
          admin_note: string | null
          author_name: string | null
          body: string | null
          created_at: string
          id: string
          order_id: string | null
          product_id: string
          rating: number
          status: string
          title: string | null
          updated_at: string
          user_id: string | null
          verified_purchase: boolean
        }
        Insert: {
          admin_note?: string | null
          author_name?: string | null
          body?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_id: string
          rating: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          verified_purchase?: boolean
        }
        Update: {
          admin_note?: string | null
          author_name?: string | null
          body?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          product_id?: string
          rating?: number
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          verified_purchase?: boolean
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          hits: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          hits?: number
          updated_at?: string
          window_start?: string
        }
        Update: {
          bucket_key?: string
          hits?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      shipping_methods: {
        Row: {
          active: boolean
          carrier: string | null
          code: string
          description: string | null
          eta_max_days: number
          eta_min_days: number
          free_over_oere: number | null
          name: string
          price_oere: number
          sort: number
        }
        Insert: {
          active?: boolean
          carrier?: string | null
          code: string
          description?: string | null
          eta_max_days?: number
          eta_min_days?: number
          free_over_oere?: number | null
          name: string
          price_oere: number
          sort?: number
        }
        Update: {
          active?: boolean
          carrier?: string | null
          code?: string
          description?: string | null
          eta_max_days?: number
          eta_min_days?: number
          free_over_oere?: number | null
          name?: string
          price_oere?: number
          sort?: number
        }
        Relationships: []
      }
      shop_settings: {
        Row: {
          key: string
          public_read: boolean
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          public_read?: boolean
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          public_read?: boolean
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_mark_order_paid: {
        Args: { p_order_id: string; p_reference?: string | null }
        Returns: Json
      }
      admin_resolve_return: {
        Args: {
          p_note?: string | null
          p_refund_oere?: number | null
          p_return_id: string
          p_status: string
        }
        Returns: Json
      }
      admin_update_order: {
        Args: {
          p_note?: string | null
          p_order_id: string
          p_shipping_status?: string | null
          p_status?: string | null
          p_tracking_number?: string | null
        }
        Returns: Json
      }
      cancel_account_deletion: { Args: Record<string, never>; Returns: Json }
      cancel_order: { Args: { p_order_id: string; p_reason?: string | null }; Returns: Json }
      export_my_data: { Args: Record<string, never>; Returns: Json }
      place_order: {
        Args: {
          p_billing_address?: Json | null
          p_discount_code?: string | null
          p_email?: string | null
          p_idempotency_key?: string | null
          p_items: Json
          p_note?: string | null
          p_payment_provider?: string | null
          p_phone?: string | null
          p_shipping_address: Json
          p_shipping_method?: string | null
        }
        Returns: Json
      }
      quote_cart: {
        Args: {
          p_discount_code?: string | null
          p_items: Json
          p_shipping_method?: string | null
        }
        Returns: Json
      }
      request_account_deletion: { Args: { p_reason?: string | null }; Returns: Json }
      request_return: {
        Args: {
          p_comment?: string | null
          p_items?: Json | null
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      search_catalog: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          category: string
          gradient: string | null
          id: string
          image_url: string | null
          kind: string
          price_dkk: number | null
          rank: number
          slug: string
          subtitle: string | null
          title: string
        }[]
      }
      submit_contact_message: {
        Args: {
          p_body: string
          p_email: string
          p_name: string
          p_order_no?: string | null
          p_subject: string
        }
        Returns: Json
      }
      subscribe_newsletter: { Args: { p_email: string; p_source?: string | null }; Returns: Json }
      unsubscribe_newsletter: { Args: { p_token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      same_postal: { Args: { _a: string; _b: string }; Returns: boolean }
      user_postal: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
      device_kind: "mower" | "sprinkler" | "sensor" | "greenhouse"
      zone_type: "lawn" | "bed" | "greenhouse" | "terrace" | "pond" | "tree"
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
      app_role: ["admin", "user"],
      device_kind: ["mower", "sprinkler", "sensor", "greenhouse"],
      zone_type: ["lawn", "bed", "greenhouse", "terrace", "pond", "tree"],
    },
  },
} as const
