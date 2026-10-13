
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "board_edit_links": {
                  Row: {
                    "board_id": string,"created_at": string,"created_by": string,"id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "board_id": string,"created_at"?: string,"created_by"?: string,"id"?: string,"revoked_at"?: string | null,"token": string
                  }
                  Update: {
                    "board_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_edit_links_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    }
                  ]
                },"board_files": {
                  Row: {
                    "board_id": string,"created_at": string,"file_id": string,"mime_type": string,"owner_id": string,"size_bytes": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "board_id": string,"created_at"?: string,"file_id": string,"mime_type": string,"owner_id"?: string,"size_bytes": number,"storage_path": string
                  }
                  Update: {
                    "board_id"?: string,"created_at"?: string,"file_id"?: string,"mime_type"?: string,"owner_id"?: string,"size_bytes"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_files_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    }
                  ]
                },"board_members": {
                  Row: {
                    "board_id": string,"created_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "board_id": string,"created_at"?: string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "board_id"?: string,"created_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_members_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    }
                  ]
                },"board_shares": {
                  Row: {
                    "board_id": string,"created_at": string,"created_by": string,"expires_at": string | null,"id": string,"revoked_at": string | null,"role": string,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "board_id": string,"created_at"?: string,"created_by"?: string,"expires_at"?: string | null,"id"?: string,"revoked_at"?: string | null,"role"?: string,"token": string
                  }
                  Update: {
                    "board_id"?: string,"created_at"?: string,"created_by"?: string,"expires_at"?: string | null,"id"?: string,"revoked_at"?: string | null,"role"?: string,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_shares_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    }
                  ]
                },"boards": {
                  Row: {
                    "app_state": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"id": string,"owner_id": string,"scene": NonNullable<Json>,"scene_schema_version": number,"thumbnail_path": string | null,"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "app_state"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"owner_id"?: string,"scene"?: NonNullable<Json>,"scene_schema_version"?: number,"thumbnail_path"?: string | null,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "app_state"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"owner_id"?: string,"scene"?: NonNullable<Json>,"scene_schema_version"?: number,"thumbnail_path"?: string | null,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_libraries": {
                  Row: {
                    "items": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "items"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "items"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "board_id_from_topic":
{ Args: { "p_topic": string }; Returns: string
                           },
"board_people":
{ Args: { "p_board_id": string }; Returns: {
              "avatar_url": string,"display_name": string,"joined_at": string,"role": string,"user_id": string
            }[]
                           },
"can_edit_board":
{ Args: { "p_board_id": string }; Returns: boolean
                           },
"is_board_member":
{ Args: { "p_board_id": string }; Returns: boolean
                           },
"is_board_owner":
{ Args: { "p_board_id": string }; Returns: boolean
                           },
"join_board":
{ Args: { "p_token": string }; Returns: string
                           },
"rotate_board_edit_link":
{ Args: { "p_board_id": string,"p_token": string }; Returns: {
              "board_id": string,
"created_at": string,
"created_by": string,
"id": string,
"revoked_at": string | null,
"token": string
            }
                          SetofOptions: {
        from: "*"
        to: "board_edit_links"
        isOneToOne: true
        isSetofReturn: false
      } },
"rotate_board_share":
{ Args: { "p_board_id": string,"p_token": string }; Returns: {
              "board_id": string,
"created_at": string,
"created_by": string,
"expires_at": string | null,
"id": string,
"revoked_at": string | null,
"role": string,
"token": string
            }
                          SetofOptions: {
        from: "*"
        to: "board_shares"
        isOneToOne: true
        isSetofReturn: false
      } },
"save_board":
{ Args: { "p_app_state": Json,"p_board_id": string,"p_expected_version": number,"p_scene": Json }; Returns: number
                           },
"set_board_thumbnail":
{ Args: { "p_board_id": string,"p_path"?: string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
