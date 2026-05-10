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
      devices: {
        Row: {
          battery: number | null
          created_at: string
          garden_id: string | null
          id: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen: string | null
          metadata: Json | null
          name: string
          status: string
          user_id: string
        }
        Insert: {
          battery?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["device_kind"]
          last_seen?: string | null
          metadata?: Json | null
          name: string
          status?: string
          user_id: string
        }
        Update: {
          battery?: number | null
          created_at?: string
          garden_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["device_kind"]
          last_seen?: string | null
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
          exclusions: Json | null
          id: string
          imagery_source: string | null
          latitude: number | null
          longitude: number | null
          name: string
          polygon: Json | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          exclusions?: Json | null
          id?: string
          imagery_source?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          exclusions?: Json | null
          id?: string
          imagery_source?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          id: string
          name: string
          order_id: string
          product_id: string | null
          qty: number
          unit_price_dkk: number
          user_id: string
          variant_id: string | null
        }
        Insert: {
          id?: string
          name: string
          order_id: string
          product_id?: string | null
          qty?: number
          unit_price_dkk: number
          user_id: string
          variant_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          order_id?: string
          product_id?: string | null
          qty?: number
          unit_price_dkk?: number
          user_id?: string
          variant_id?: string | null
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
          created_at: string
          id: string
          notes: string | null
          refunded_at: string | null
          shipping_address: Json | null
          shipping_status: string
          status: string
          total_dkk: number
          tracking_number: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          refunded_at?: string | null
          shipping_address?: Json | null
          shipping_status?: string
          status?: string
          total_dkk: number
          tracking_number?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          refunded_at?: string | null
          shipping_address?: Json | null
          shipping_status?: string
          status?: string
          total_dkk?: number
          tracking_number?: string | null
          user_id?: string
        }
        Relationships: []
      }
      plant_health_log: {
        Row: {
          created_at: string
          diagnosis: string | null
          id: string
          image_url: string | null
          plant_id: string | null
          product_suggestions: Json | null
          raw: Json | null
          severity: string | null
          treatment: string | null
          user_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          diagnosis?: string | null
          id?: string
          image_url?: string | null
          plant_id?: string | null
          product_suggestions?: Json | null
          raw?: Json | null
          severity?: string | null
          treatment?: string | null
          user_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          diagnosis?: string | null
          id?: string
          image_url?: string | null
          plant_id?: string | null
          product_suggestions?: Json | null
          raw?: Json | null
          severity?: string | null
          treatment?: string | null
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
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
          base_price_dkk: number
          category: string
          created_at: string
          description: string | null
          featured: boolean
          gradient: string | null
          id: string
          image_url: string | null
          in_stock: boolean
          meta: string | null
          name: string
          short_description: string | null
          slug: string
          svg_art: string | null
        }
        Insert: {
          base_price_dkk: number
          category: string
          created_at?: string
          description?: string | null
          featured?: boolean
          gradient?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean
          meta?: string | null
          name: string
          short_description?: string | null
          slug: string
          svg_art?: string | null
        }
        Update: {
          base_price_dkk?: number
          category?: string
          created_at?: string
          description?: string | null
          featured?: boolean
          gradient?: string | null
          id?: string
          image_url?: string | null
          in_stock?: boolean
          meta?: string | null
          name?: string
          short_description?: string | null
          slug?: string
          svg_art?: string | null
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
          created_at: string
          done: boolean
          done_at: string | null
          due_at: string | null
          garden_id: string | null
          id: string
          kind: string
          notes: string | null
          plant_id: string | null
          title: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          garden_id?: string | null
          id?: string
          kind: string
          notes?: string | null
          plant_id?: string | null
          title: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          garden_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          plant_id?: string | null
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
          id: string
          image_url: string | null
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
          id?: string
          image_url?: string | null
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
          id?: string
          image_url?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
