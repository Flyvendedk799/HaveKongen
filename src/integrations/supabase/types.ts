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
      garden_zones: {
        Row: {
          area_m2: number | null
          created_at: string
          garden_id: string
          id: string
          name: string
          polygon: Json | null
          soil: string | null
          sun_exposure: string | null
          type: Database["public"]["Enums"]["zone_type"]
          user_id: string
        }
        Insert: {
          area_m2?: number | null
          created_at?: string
          garden_id: string
          id?: string
          name: string
          polygon?: Json | null
          soil?: string | null
          sun_exposure?: string | null
          type?: Database["public"]["Enums"]["zone_type"]
          user_id: string
        }
        Update: {
          area_m2?: number | null
          created_at?: string
          garden_id?: string
          id?: string
          name?: string
          polygon?: Json | null
          soil?: string | null
          sun_exposure?: string | null
          type?: Database["public"]["Enums"]["zone_type"]
          user_id?: string
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
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          polygon: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          area_m2?: number | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          polygon?: Json | null
          updated_at?: string
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
          shipping_address: Json | null
          status: string
          total_dkk: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          shipping_address?: Json | null
          status?: string
          total_dkk: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          shipping_address?: Json | null
          status?: string
          total_dkk?: number
          user_id?: string
        }
        Relationships: []
      }
      plants_catalog: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          harvest_months: number[] | null
          image_url: string | null
          latin: string | null
          name_da: string
          slug: string
          sow_months: number[] | null
          sun: string | null
          water_need: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          harvest_months?: number[] | null
          image_url?: string | null
          latin?: string | null
          name_da: string
          slug: string
          sow_months?: number[] | null
          sun?: string | null
          water_need?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          harvest_months?: number[] | null
          image_url?: string | null
          latin?: string | null
          name_da?: string
          slug?: string
          sow_months?: number[] | null
          sun?: string | null
          water_need?: string | null
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          id: string
          in_stock: boolean
          name: string
          price_dkk: number
          product_id: string
          sku: string | null
        }
        Insert: {
          id?: string
          in_stock?: boolean
          name: string
          price_dkk: number
          product_id: string
          sku?: string | null
        }
        Update: {
          id?: string
          in_stock?: boolean
          name?: string
          price_dkk?: number
          product_id?: string
          sku?: string | null
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
          postal_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_plants: {
        Row: {
          created_at: string
          custom_name: string | null
          garden_id: string
          id: string
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
      watering_schedules: {
        Row: {
          ai_adjusted: boolean
          created_at: string
          duration_min: number
          enabled: boolean
          id: string
          name: string
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
