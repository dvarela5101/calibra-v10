
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin": {
                  Row: {
                    "correo": string,"id": string,"nombre": string,"orden_revision": number
                  }
                  Insert: {
                    "correo": string,"id": string,"nombre": string,"orden_revision": number
                  }
                  Update: {
                    "correo"?: string,"id"?: string,"nombre"?: string,"orden_revision"?: number
                  }
                  Relationships: [
                    
                  ]
                },"certificado": {
                  Row: {
                    "fecha_emision": string,"id": string,"id_admin": string,"id_materia": string,"id_monitor": string
                  }
                  Insert: {
                    "fecha_emision"?: string,"id"?: string,"id_admin": string,"id_materia": string,"id_monitor": string
                  }
                  Update: {
                    "fecha_emision"?: string,"id"?: string,"id_admin"?: string,"id_materia"?: string,"id_monitor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "certificado_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificado_id_materia_fkey"
      columns: ["id_materia"]
isOneToOne: false
      referencedRelation: "materia"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificado_id_monitor_fkey"
      columns: ["id_monitor"]
isOneToOne: false
      referencedRelation: "monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"correo_envio": {
                  Row: {
                    "actualizado_en": string,"clave": string,"creado_en": string,"destinatario": string,"enviado_en": string | null,"estado": Database["public"]['Enums']["estado_correo"],"id": string,"id_proveedor": string | null,"intentos": number,"plantilla": string,"ultimo_error": string | null
                  }
                  Insert: {
                    "actualizado_en"?: string,"clave": string,"creado_en"?: string,"destinatario": string,"enviado_en"?: string | null,"estado"?: Database["public"]['Enums']["estado_correo"],"id"?: string,"id_proveedor"?: string | null,"intentos"?: number,"plantilla": string,"ultimo_error"?: string | null
                  }
                  Update: {
                    "actualizado_en"?: string,"clave"?: string,"creado_en"?: string,"destinatario"?: string,"enviado_en"?: string | null,"estado"?: Database["public"]['Enums']["estado_correo"],"id"?: string,"id_proveedor"?: string | null,"intentos"?: number,"plantilla"?: string,"ultimo_error"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"desembolso": {
                  Row: {
                    "comision": number,"estado": Database["public"]['Enums']["estado_desembolso"],"fecha_desembolso": string | null,"fecha_generacion": string,"id": string,"id_admin": string | null,"id_monitoria": string,"llave_destino": string,"monto_bruto": number,"monto_neto": number,"referencia_transferencia": string | null
                  }
                  Insert: {
                    "comision": number,"estado"?: Database["public"]['Enums']["estado_desembolso"],"fecha_desembolso"?: string | null,"fecha_generacion"?: string,"id"?: string,"id_admin"?: string | null,"id_monitoria": string,"llave_destino": string,"monto_bruto": number,"monto_neto": number,"referencia_transferencia"?: string | null
                  }
                  Update: {
                    "comision"?: number,"estado"?: Database["public"]['Enums']["estado_desembolso"],"fecha_desembolso"?: string | null,"fecha_generacion"?: string,"id"?: string,"id_admin"?: string | null,"id_monitoria"?: string,"llave_destino"?: string,"monto_bruto"?: number,"monto_neto"?: number,"referencia_transferencia"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "desembolso_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "desembolso_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "desembolso_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"diagnostico": {
                  Row: {
                    "fecha_realizacion": string,"id": string,"id_evaluacion": string,"id_lead": string | null,"id_materia": string,"id_monitoria": string | null,"id_sesion_anonima": string | null,"puntaje": number,"respuestas": NonNullable<Json>,"resultado_por_tema": NonNullable<Json>,"token_recuperacion": string
                  }
                  Insert: {
                    "fecha_realizacion"?: string,"id"?: string,"id_evaluacion": string,"id_lead"?: string | null,"id_materia": string,"id_monitoria"?: string | null,"id_sesion_anonima"?: string | null,"puntaje": number,"respuestas": NonNullable<Json>,"resultado_por_tema": NonNullable<Json>,"token_recuperacion"?: string
                  }
                  Update: {
                    "fecha_realizacion"?: string,"id"?: string,"id_evaluacion"?: string,"id_lead"?: string | null,"id_materia"?: string,"id_monitoria"?: string | null,"id_sesion_anonima"?: string | null,"puntaje"?: number,"respuestas"?: NonNullable<Json>,"resultado_por_tema"?: NonNullable<Json>,"token_recuperacion"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "diagnostico_evaluacion_fk"
      columns: ["id_evaluacion","id_materia"]
isOneToOne: false
      referencedRelation: "evaluacion"
      referencedColumns: ["id","id_materia"]
    },{
      foreignKeyName: "diagnostico_id_lead_fkey"
      columns: ["id_lead"]
isOneToOne: false
      referencedRelation: "lead"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "diagnostico_monitoria_fk"
      columns: ["id_monitoria","id_materia"]
isOneToOne: false
      referencedRelation: "monitoria"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"estudiante": {
                  Row: {
                    "fecha_registro": string,"id": string,"id_lead": string
                  }
                  Insert: {
                    "fecha_registro"?: string,"id": string,"id_lead": string
                  }
                  Update: {
                    "fecha_registro"?: string,"id"?: string,"id_lead"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "estudiante_id_lead_fkey"
      columns: ["id_lead"]
isOneToOne: true
      referencedRelation: "lead"
      referencedColumns: ["id"]
    }
                  ]
                },"evaluacion": {
                  Row: {
                    "acumulativo": boolean,"id": string,"id_materia": string,"nombre": string,"semana": number
                  }
                  Insert: {
                    "acumulativo"?: boolean,"id"?: string,"id_materia": string,"nombre": string,"semana": number
                  }
                  Update: {
                    "acumulativo"?: boolean,"id"?: string,"id_materia"?: string,"nombre"?: string,"semana"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "evaluacion_id_materia_fkey"
      columns: ["id_materia"]
isOneToOne: false
      referencedRelation: "materia"
      referencedColumns: ["id"]
    }
                  ]
                },"franja": {
                  Row: {
                    "dia": number,"duracion_min": number,"hora": string,"id": string,"id_monitor": string,"precio": number,"presencial": boolean
                  }
                  Insert: {
                    "dia": number,"duracion_min": number,"hora": string,"id"?: string,"id_monitor": string,"precio": number,"presencial": boolean
                  }
                  Update: {
                    "dia"?: number,"duracion_min"?: number,"hora"?: string,"id"?: string,"id_monitor"?: string,"precio"?: number,"presencial"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "franja_id_monitor_fkey"
      columns: ["id_monitor"]
isOneToOne: false
      referencedRelation: "monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"lead": {
                  Row: {
                    "acepta_contacto": boolean,"acepta_tratamiento_datos": boolean,"correo": string | null,"estado": Database["public"]['Enums']["estado_lead"],"fecha_consentimiento": string,"fecha_creacion": string,"id": string,"id_sesion_anonima": string | null,"nombre": string,"numero_telefono": string | null,"origen": string | null
                  }
                  Insert: {
                    "acepta_contacto"?: boolean,"acepta_tratamiento_datos": boolean,"correo"?: string | null,"estado"?: Database["public"]['Enums']["estado_lead"],"fecha_consentimiento": string,"fecha_creacion"?: string,"id"?: string,"id_sesion_anonima"?: string | null,"nombre": string,"numero_telefono"?: string | null,"origen"?: string | null
                  }
                  Update: {
                    "acepta_contacto"?: boolean,"acepta_tratamiento_datos"?: boolean,"correo"?: string | null,"estado"?: Database["public"]['Enums']["estado_lead"],"fecha_consentimiento"?: string,"fecha_creacion"?: string,"id"?: string,"id_sesion_anonima"?: string | null,"nombre"?: string,"numero_telefono"?: string | null,"origen"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"materia": {
                  Row: {
                    "codigo": string,"id": string,"nombre": string
                  }
                  Insert: {
                    "codigo": string,"id"?: string,"nombre": string
                  }
                  Update: {
                    "codigo"?: string,"id"?: string,"nombre"?: string
                  }
                  Relationships: [
                    
                  ]
                },"monitor": {
                  Row: {
                    "id": string,"nombre": string
                  }
                  Insert: {
                    "id": string,"nombre": string
                  }
                  Update: {
                    "id"?: string,"nombre"?: string
                  }
                  Relationships: [
                    
                  ]
                },"monitor_privado": {
                  Row: {
                    "correo": string,"id_monitor": string,"llave": string,"numero_telefono": string
                  }
                  Insert: {
                    "correo": string,"id_monitor": string,"llave": string,"numero_telefono": string
                  }
                  Update: {
                    "correo"?: string,"id_monitor"?: string,"llave"?: string,"numero_telefono"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitor_privado_id_monitor_fkey"
      columns: ["id_monitor"]
isOneToOne: true
      referencedRelation: "monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"monitoria": {
                  Row: {
                    "estado": Database["public"]['Enums']["estado_monitoria"],"fecha": string,"fecha_creacion": string,"fecha_finalizacion": string | null,"id": string,"id_franja": string,"id_lead": string,"id_materia": string,"id_monitor": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total": number
                  }
                  Insert: {
                    "estado"?: Database["public"]['Enums']["estado_monitoria"],"fecha": string,"fecha_creacion"?: string,"fecha_finalizacion"?: string | null,"id"?: string,"id_franja": string,"id_lead": string,"id_materia": string,"id_monitor": string,"motivo_cancelacion"?: Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total": number
                  }
                  Update: {
                    "estado"?: Database["public"]['Enums']["estado_monitoria"],"fecha"?: string,"fecha_creacion"?: string,"fecha_finalizacion"?: string | null,"id"?: string,"id_franja"?: string,"id_lead"?: string,"id_materia"?: string,"id_monitor"?: string,"motivo_cancelacion"?: Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitoria_certificado_fk"
      columns: ["id_monitor","id_materia"]
isOneToOne: false
      referencedRelation: "certificado"
      referencedColumns: ["id_monitor","id_materia"]
    },{
      foreignKeyName: "monitoria_franja_fk"
      columns: ["id_franja","id_monitor"]
isOneToOne: false
      referencedRelation: "franja"
      referencedColumns: ["id","id_monitor"]
    },{
      foreignKeyName: "monitoria_id_lead_fkey"
      columns: ["id_lead"]
isOneToOne: false
      referencedRelation: "lead"
      referencedColumns: ["id"]
    }
                  ]
                },"monitoria_grupal": {
                  Row: {
                    "cupos": number,"id_monitoria": string,"modalidad_pago": Database["public"]['Enums']["modalidad_pago"],"precio_por_persona": number,"token_enlace": string
                  }
                  Insert: {
                    "cupos": number,"id_monitoria": string,"modalidad_pago": Database["public"]['Enums']["modalidad_pago"],"precio_por_persona": number,"token_enlace"?: string
                  }
                  Update: {
                    "cupos"?: number,"id_monitoria"?: string,"modalidad_pago"?: Database["public"]['Enums']["modalidad_pago"],"precio_por_persona"?: number,"token_enlace"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitoria_grupal_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "monitoria_grupal_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"pago": {
                  Row: {
                    "comprobante": string,"contacto": string,"estado": Database["public"]['Enums']["estado_pago"],"fecha_asignacion": string,"fecha_pago": string,"fecha_revision": string | null,"id": string,"id_admin": string,"id_monitoria": string,"monto": number,"nombre_pagador": string,"referencia_transferencia": string | null
                  }
                  Insert: {
                    "comprobante": string,"contacto": string,"estado"?: Database["public"]['Enums']["estado_pago"],"fecha_asignacion"?: string,"fecha_pago"?: string,"fecha_revision"?: string | null,"id"?: string,"id_admin": string,"id_monitoria": string,"monto": number,"nombre_pagador": string,"referencia_transferencia"?: string | null
                  }
                  Update: {
                    "comprobante"?: string,"contacto"?: string,"estado"?: Database["public"]['Enums']["estado_pago"],"fecha_asignacion"?: string,"fecha_pago"?: string,"fecha_revision"?: string | null,"id"?: string,"id_admin"?: string,"id_monitoria"?: string,"monto"?: number,"nombre_pagador"?: string,"referencia_transferencia"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pago_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pago_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: false
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pago_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: false
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"perfil_monitor": {
                  Row: {
                    "id_monitor": string
                  }
                  Insert: {
                    "id_monitor": string
                  }
                  Update: {
                    "id_monitor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "perfil_monitor_id_monitor_fkey"
      columns: ["id_monitor"]
isOneToOne: true
      referencedRelation: "monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"reembolso": {
                  Row: {
                    "estado": Database["public"]['Enums']["estado_reembolso"],"fecha_generacion": string,"fecha_reembolso": string | null,"id": string,"id_admin": string,"id_pago": string,"llave_destino": string | null,"monto": number,"motivo": string,"referencia_transferencia": string | null
                  }
                  Insert: {
                    "estado"?: Database["public"]['Enums']["estado_reembolso"],"fecha_generacion"?: string,"fecha_reembolso"?: string | null,"id"?: string,"id_admin": string,"id_pago": string,"llave_destino"?: string | null,"monto": number,"motivo": string,"referencia_transferencia"?: string | null
                  }
                  Update: {
                    "estado"?: Database["public"]['Enums']["estado_reembolso"],"fecha_generacion"?: string,"fecha_reembolso"?: string | null,"id"?: string,"id_admin"?: string,"id_pago"?: string,"llave_destino"?: string | null,"monto"?: number,"motivo"?: string,"referencia_transferencia"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reembolso_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reembolso_id_pago_fkey"
      columns: ["id_pago"]
isOneToOne: true
      referencedRelation: "pago"
      referencedColumns: ["id"]
    }
                  ]
                },"reporte_inasistencia": {
                  Row: {
                    "estado": Database["public"]['Enums']["estado_reporte"],"fecha_decision": string | null,"fecha_reporte": string,"id": string,"id_admin": string,"id_monitoria": string,"observaciones": string | null
                  }
                  Insert: {
                    "estado"?: Database["public"]['Enums']["estado_reporte"],"fecha_decision"?: string | null,"fecha_reporte"?: string,"id"?: string,"id_admin": string,"id_monitoria": string,"observaciones"?: string | null
                  }
                  Update: {
                    "estado"?: Database["public"]['Enums']["estado_reporte"],"fecha_decision"?: string | null,"fecha_reporte"?: string,"id"?: string,"id_admin"?: string,"id_monitoria"?: string,"observaciones"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reporte_inasistencia_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reporte_inasistencia_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reporte_inasistencia_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"resena": {
                  Row: {
                    "calificacion": number,"comentario": string | null,"fecha": string,"id": string,"id_pago": string
                  }
                  Insert: {
                    "calificacion": number,"comentario"?: string | null,"fecha"?: string,"id"?: string,"id_pago": string
                  }
                  Update: {
                    "calificacion"?: number,"comentario"?: string | null,"fecha"?: string,"id"?: string,"id_pago"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resena_id_pago_fkey"
      columns: ["id_pago"]
isOneToOne: true
      referencedRelation: "pago"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "desembolsos_ejecutables": {
                  Row: {
                    "desembolsable_desde": string | null,"fecha_generacion": string | null,"fecha_sesion": string | null,"id": string | null,"id_monitoria": string | null,"monto_neto": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "desembolso_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "desembolso_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"monitoria_plazos": {
                  Row: {
                    "cancelable_hasta": string | null,"desembolsable_desde": string | null,"es_grupal": boolean | null,"fecha_limite_diferencia": string | null,"fecha_limite_pago": string | null,"fin_programado": string | null,"id_monitoria": string | null,"inicio": string | null,"reporte_inasistencia_hasta": string | null,"reserva_hasta": string | null,"ventana_resena_hasta": string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "cancelable_hasta":
{ Args: { "p_es_grupal": boolean,"p_inicio": string }; Returns: string
                           },
"comision":
{ Args: { "p_monto_bruto": number }; Returns: number
                           },
"cumple_antelacion":
{ Args: { "p_ahora": string,"p_es_grupal": boolean,"p_inicio": string }; Returns: boolean
                           },
"dentro_de_plazo":
{ Args: { "p_ahora": string,"p_limite": string }; Returns: boolean
                           },
"desembolsable_desde":
{ Args: { "p_fin_programado": string }; Returns: string
                           },
"fecha_limite_diferencia":
{ Args: { "p_inicio": string }; Returns: string
                           },
"fecha_limite_pago":
{ Args: { "p_inicio": string }; Returns: string
                           },
"fin_programado":
{ Args: { "p_duracion_min": number,"p_inicio": string }; Returns: string
                           },
"inicio_sesion":
{ Args: { "p_fecha": string,"p_hora": string }; Returns: string
                           },
"mi_rol":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"monto_neto":
{ Args: { "p_monto_bruto": number }; Returns: number
                           },
"parametros_negocio":
{ Args: Record<PropertyKey, never>; Returns: {
              "antelacion_grupal_min": number,"antelacion_individual_min": number,"cancelacion_grupal_min": number,"cancelacion_individual_min": number,"comision_porcentaje": number,"comision_tope": number,"desembolso_min": number,"diferencia_min": number,"pago_integrantes_min": number,"reporte_inasistencia_min": number,"resena_grupal_min": number,"reserva_min": number,"revision_min": number
            }[]
                           },
"plazo_alcanzado":
{ Args: { "p_ahora": string,"p_desde": string }; Returns: boolean
                           },
"reporte_inasistencia_hasta":
{ Args: { "p_fin_programado": string }; Returns: string
                           },
"reserva_hasta":
{ Args: { "p_fecha_creacion": string }; Returns: string
                           },
"revision_hasta":
{ Args: { "p_fecha_asignacion": string }; Returns: string
                           },
"ventana_resena_hasta":
{ Args: { "p_fecha_finalizacion": string }; Returns: string
                           }
          }
          Enums: {
            "estado_correo": "pendiente"|"enviado"|"fallido","estado_desembolso": "pendiente"|"desembolsado"|"anulado","estado_lead": "nuevo"|"contactado"|"descartado","estado_monitoria": "pendiente_pago"|"confirmada"|"realizada"|"cancelada","estado_pago": "en_revision"|"aprobado"|"rechazado","estado_reembolso": "esperando_llave"|"pendiente"|"reembolsado","estado_reporte": "en_revision"|"aceptado"|"rechazado","modalidad_pago": "unico"|"dividido","motivo_cancelacion": "reserva_expirada"|"pago_rechazado"|"estudiante"|"monitor_no_asistio"|"diferencia_no_cubierta"
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
            "estado_correo": ["pendiente", "enviado", "fallido"],"estado_desembolso": ["pendiente", "desembolsado", "anulado"],"estado_lead": ["nuevo", "contactado", "descartado"],"estado_monitoria": ["pendiente_pago", "confirmada", "realizada", "cancelada"],"estado_pago": ["en_revision", "aprobado", "rechazado"],"estado_reembolso": ["esperando_llave", "pendiente", "reembolsado"],"estado_reporte": ["en_revision", "aceptado", "rechazado"],"modalidad_pago": ["unico", "dividido"],"motivo_cancelacion": ["reserva_expirada", "pago_rechazado", "estudiante", "monitor_no_asistio", "diferencia_no_cubierta"]
          }
        }
} as const

