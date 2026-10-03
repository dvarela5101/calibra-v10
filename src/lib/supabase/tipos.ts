
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
                },"aviso_monitor": {
                  Row: {
                    "creado_en": string,"evento": string,"id": string,"id_monitoria": string,"intentos": number,"procesado_en": string | null
                  }
                  Insert: {
                    "creado_en"?: string,"evento": string,"id"?: string,"id_monitoria": string,"intentos"?: number,"procesado_en"?: string | null
                  }
                  Update: {
                    "creado_en"?: string,"evento"?: string,"id"?: string,"id_monitoria"?: string,"intentos"?: number,"procesado_en"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "aviso_monitor_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: false
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "aviso_monitor_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: false
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"cancelacion_cita": {
                  Row: {
                    "con_pago_en_revision": boolean,"correo_destino": string | null,"creada_en": string,"id": string,"id_monitoria": string,"intentos": number,"procesado_en": string | null,"reembolso_a_otro_contacto": boolean
                  }
                  Insert: {
                    "con_pago_en_revision": boolean,"correo_destino"?: string | null,"creada_en"?: string,"id"?: string,"id_monitoria": string,"intentos"?: number,"procesado_en"?: string | null,"reembolso_a_otro_contacto": boolean
                  }
                  Update: {
                    "con_pago_en_revision"?: boolean,"correo_destino"?: string | null,"creada_en"?: string,"id"?: string,"id_monitoria"?: string,"intentos"?: number,"procesado_en"?: string | null,"reembolso_a_otro_contacto"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "cancelacion_cita_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cancelacion_cita_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"certificado": {
                  Row: {
                    "fecha_emision": string,"fecha_evaluacion": string,"id": string,"id_admin": string,"id_materia": string,"id_monitor": string
                  }
                  Insert: {
                    "fecha_emision"?: string,"fecha_evaluacion"?: string,"id"?: string,"id_admin": string,"id_materia": string,"id_monitor": string
                  }
                  Update: {
                    "fecha_emision"?: string,"fecha_evaluacion"?: string,"id"?: string,"id_admin"?: string,"id_materia"?: string,"id_monitor"?: string
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
                },"comprobante_revisado": {
                  Row: {
                    "revisado_en": string,"ruta": string,"tipo": string
                  }
                  Insert: {
                    "revisado_en"?: string,"ruta": string,"tipo": string
                  }
                  Update: {
                    "revisado_en"?: string,"ruta"?: string,"tipo"?: string
                  }
                  Relationships: [
                    
                  ]
                },"confirmacion_cita": {
                  Row: {
                    "creada_en": string,"id": string,"id_monitoria": string,"intentos": number,"procesado_en": string | null,"token": string
                  }
                  Insert: {
                    "creada_en"?: string,"id"?: string,"id_monitoria": string,"intentos"?: number,"procesado_en"?: string | null,"token"?: string
                  }
                  Update: {
                    "creada_en"?: string,"id"?: string,"id_monitoria"?: string,"intentos"?: number,"procesado_en"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "confirmacion_cita_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "confirmacion_cita_id_monitoria_fkey"
      columns: ["id_monitoria"]
isOneToOne: true
      referencedRelation: "monitoria_plazos"
      referencedColumns: ["id_monitoria"]
    }
                  ]
                },"correo_envio": {
                  Row: {
                    "actualizado_en": string,"clave": string,"creado_en": string,"destinatario": string,"enviado_en": string | null,"estado": Database["public"]['Enums']["estado_correo"],"id": string,"id_proveedor": string | null,"intentos": number,"plantilla": string,"reintentable": boolean,"ultimo_error": string | null
                  }
                  Insert: {
                    "actualizado_en"?: string,"clave": string,"creado_en"?: string,"destinatario": string,"enviado_en"?: string | null,"estado"?: Database["public"]['Enums']["estado_correo"],"id"?: string,"id_proveedor"?: string | null,"intentos"?: number,"plantilla": string,"reintentable"?: boolean,"ultimo_error"?: string | null
                  }
                  Update: {
                    "actualizado_en"?: string,"clave"?: string,"creado_en"?: string,"destinatario"?: string,"enviado_en"?: string | null,"estado"?: Database["public"]['Enums']["estado_correo"],"id"?: string,"id_proveedor"?: string | null,"intentos"?: number,"plantilla"?: string,"reintentable"?: boolean,"ultimo_error"?: string | null
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
                    "activa": boolean,"acumulativo": boolean,"clave": string | null,"id": string,"id_materia": string,"nombre": string,"semana": number
                  }
                  Insert: {
                    "activa"?: boolean,"acumulativo"?: boolean,"clave"?: string | null,"id"?: string,"id_materia": string,"nombre": string,"semana": number
                  }
                  Update: {
                    "activa"?: boolean,"acumulativo"?: boolean,"clave"?: string | null,"id"?: string,"id_materia"?: string,"nombre"?: string,"semana"?: number
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
                },"evaluacion_tema": {
                  Row: {
                    "id_evaluacion": string,"id_materia": string,"id_tema": string
                  }
                  Insert: {
                    "id_evaluacion": string,"id_materia": string,"id_tema": string
                  }
                  Update: {
                    "id_evaluacion"?: string,"id_materia"?: string,"id_tema"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evaluacion_tema_evaluacion_fk"
      columns: ["id_evaluacion","id_materia"]
isOneToOne: false
      referencedRelation: "evaluacion"
      referencedColumns: ["id","id_materia"]
    },{
      foreignKeyName: "evaluacion_tema_tema_fk"
      columns: ["id_tema","id_materia"]
isOneToOne: false
      referencedRelation: "tema"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"franja": {
                  Row: {
                    "abierta_desde": string,"cerrada_desde": string | null,"dia": number,"duracion_min": number,"enlace": string | null,"hora": string,"id": string,"id_monitor": string,"lugar": string | null,"precio": number,"presencial": boolean
                  }
                  Insert: {
                    "abierta_desde"?: string,"cerrada_desde"?: string | null,"dia": number,"duracion_min": number,"enlace"?: string | null,"hora": string,"id"?: string,"id_monitor": string,"lugar"?: string | null,"precio": number,"presencial": boolean
                  }
                  Update: {
                    "abierta_desde"?: string,"cerrada_desde"?: string | null,"dia"?: number,"duracion_min"?: number,"enlace"?: string | null,"hora"?: string,"id"?: string,"id_monitor"?: string,"lugar"?: string | null,"precio"?: number,"presencial"?: boolean
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
                },"habilidad": {
                  Row: {
                    "clave": string,"descripcion": string,"id": string,"id_materia": string,"id_tema": string
                  }
                  Insert: {
                    "clave": string,"descripcion": string,"id"?: string,"id_materia": string,"id_tema": string
                  }
                  Update: {
                    "clave"?: string,"descripcion"?: string,"id"?: string,"id_materia"?: string,"id_tema"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "habilidad_tema_fk"
      columns: ["id_tema","id_materia"]
isOneToOne: false
      referencedRelation: "tema"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"habilidad_prerrequisito": {
                  Row: {
                    "id_habilidad": string,"id_prerrequisito": string
                  }
                  Insert: {
                    "id_habilidad": string,"id_prerrequisito": string
                  }
                  Update: {
                    "id_habilidad"?: string,"id_prerrequisito"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "habilidad_prerrequisito_id_habilidad_fkey"
      columns: ["id_habilidad"]
isOneToOne: false
      referencedRelation: "habilidad"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "habilidad_prerrequisito_id_prerrequisito_fkey"
      columns: ["id_prerrequisito"]
isOneToOne: false
      referencedRelation: "habilidad"
      referencedColumns: ["id"]
    }
                  ]
                },"invitacion_monitor": {
                  Row: {
                    "correo": string,"creada_en": string,"id": string,"id_admin": string,"id_monitor": string | null,"token_hash": string,"usada_en": string | null,"vence_en": string
                  }
                  Insert: {
                    "correo": string,"creada_en"?: string,"id"?: string,"id_admin": string,"id_monitor"?: string | null,"token_hash": string,"usada_en"?: string | null,"vence_en"?: string
                  }
                  Update: {
                    "correo"?: string,"creada_en"?: string,"id"?: string,"id_admin"?: string,"id_monitor"?: string | null,"token_hash"?: string,"usada_en"?: string | null,"vence_en"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitacion_monitor_id_admin_fkey"
      columns: ["id_admin"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitacion_monitor_id_monitor_fkey"
      columns: ["id_monitor"]
isOneToOne: false
      referencedRelation: "monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"invitacion_resena": {
                  Row: {
                    "creada_en": string,"id": string,"id_pago": string,"intentos": number,"procesado_en": string | null,"token": string
                  }
                  Insert: {
                    "creada_en"?: string,"id"?: string,"id_pago": string,"intentos"?: number,"procesado_en"?: string | null,"token"?: string
                  }
                  Update: {
                    "creada_en"?: string,"id"?: string,"id_pago"?: string,"intentos"?: number,"procesado_en"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitacion_resena_id_pago_fkey"
      columns: ["id_pago"]
isOneToOne: true
      referencedRelation: "pago"
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
                },"lead_sesion": {
                  Row: {
                    "id_lead": string,"id_sesion": string,"ligada_en": string
                  }
                  Insert: {
                    "id_lead": string,"id_sesion": string,"ligada_en"?: string
                  }
                  Update: {
                    "id_lead"?: string,"id_sesion"?: string,"ligada_en"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_sesion_id_lead_fkey"
      columns: ["id_lead"]
isOneToOne: false
      referencedRelation: "lead"
      referencedColumns: ["id"]
    }
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
                },"misconcepcion": {
                  Row: {
                    "clave": string,"descripcion": string,"id": string,"id_habilidad": string,"id_materia": string
                  }
                  Insert: {
                    "clave": string,"descripcion": string,"id"?: string,"id_habilidad": string,"id_materia": string
                  }
                  Update: {
                    "clave"?: string,"descripcion"?: string,"id"?: string,"id_habilidad"?: string,"id_materia"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "misconcepcion_habilidad_fk"
      columns: ["id_habilidad","id_materia"]
isOneToOne: false
      referencedRelation: "habilidad"
      referencedColumns: ["id","id_materia"]
    }
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
                    "estado": Database["public"]['Enums']["estado_monitoria"],"fecha": string,"fecha_creacion": string,"fecha_finalizacion": string | null,"id": string,"id_diagnostico": string | null,"id_franja": string,"id_lead": string,"id_materia": string,"id_monitor": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total": number
                  }
                  Insert: {
                    "estado"?: Database["public"]['Enums']["estado_monitoria"],"fecha": string,"fecha_creacion"?: string,"fecha_finalizacion"?: string | null,"id"?: string,"id_diagnostico"?: string | null,"id_franja": string,"id_lead": string,"id_materia": string,"id_monitor": string,"motivo_cancelacion"?: Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total": number
                  }
                  Update: {
                    "estado"?: Database["public"]['Enums']["estado_monitoria"],"fecha"?: string,"fecha_creacion"?: string,"fecha_finalizacion"?: string | null,"id"?: string,"id_diagnostico"?: string | null,"id_franja"?: string,"id_lead"?: string,"id_materia"?: string,"id_monitor"?: string,"motivo_cancelacion"?: Database["public"]['Enums']["motivo_cancelacion"] | null,"valor_total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitoria_certificado_fk"
      columns: ["id_monitor","id_materia"]
isOneToOne: false
      referencedRelation: "certificado"
      referencedColumns: ["id_monitor","id_materia"]
    },{
      foreignKeyName: "monitoria_diagnostico_fk"
      columns: ["id_diagnostico","id_materia"]
isOneToOne: false
      referencedRelation: "diagnostico"
      referencedColumns: ["id","id_materia"]
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
                },"opcion": {
                  Row: {
                    "correcta": boolean,"error": string | null,"id": string,"id_materia": string,"id_misconcepcion": string | null,"id_pregunta": string,"letra": string,"texto": string
                  }
                  Insert: {
                    "correcta": boolean,"error"?: string | null,"id"?: string,"id_materia": string,"id_misconcepcion"?: string | null,"id_pregunta": string,"letra": string,"texto": string
                  }
                  Update: {
                    "correcta"?: boolean,"error"?: string | null,"id"?: string,"id_materia"?: string,"id_misconcepcion"?: string | null,"id_pregunta"?: string,"letra"?: string,"texto"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opcion_misconcepcion_fk"
      columns: ["id_misconcepcion","id_materia"]
isOneToOne: false
      referencedRelation: "misconcepcion"
      referencedColumns: ["id","id_materia"]
    },{
      foreignKeyName: "opcion_pregunta_fk"
      columns: ["id_pregunta","id_materia"]
isOneToOne: false
      referencedRelation: "pregunta"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"pago": {
                  Row: {
                    "comprobante": string,"contacto": string,"estado": Database["public"]['Enums']["estado_pago"],"fecha_asignacion": string,"fecha_pago": string,"fecha_revision": string | null,"id": string,"id_admin": string,"id_monitoria": string,"monto": number,"nombre_pagador": string,"observaciones": string | null,"referencia_transferencia": string | null
                  }
                  Insert: {
                    "comprobante": string,"contacto": string,"estado"?: Database["public"]['Enums']["estado_pago"],"fecha_asignacion"?: string,"fecha_pago"?: string,"fecha_revision"?: string | null,"id"?: string,"id_admin": string,"id_monitoria": string,"monto": number,"nombre_pagador": string,"observaciones"?: string | null,"referencia_transferencia"?: string | null
                  }
                  Update: {
                    "comprobante"?: string,"contacto"?: string,"estado"?: Database["public"]['Enums']["estado_pago"],"fecha_asignacion"?: string,"fecha_pago"?: string,"fecha_revision"?: string | null,"id"?: string,"id_admin"?: string,"id_monitoria"?: string,"monto"?: number,"nombre_pagador"?: string,"observaciones"?: string | null,"referencia_transferencia"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pago_comprobante_revisado_fk"
      columns: ["comprobante"]
isOneToOne: false
      referencedRelation: "comprobante_revisado"
      referencedColumns: ["ruta"]
    },{
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
                },"pregunta": {
                  Row: {
                    "clave": string,"dificultad": number,"enunciado": string,"estado": Database["public"]['Enums']["estado_pregunta"],"id": string,"id_materia": string,"id_tema": string,"origen": string,"revisor": string | null,"solucion": string | null
                  }
                  Insert: {
                    "clave": string,"dificultad": number,"enunciado": string,"estado": Database["public"]['Enums']["estado_pregunta"],"id"?: string,"id_materia": string,"id_tema": string,"origen": string,"revisor"?: string | null,"solucion"?: string | null
                  }
                  Update: {
                    "clave"?: string,"dificultad"?: number,"enunciado"?: string,"estado"?: Database["public"]['Enums']["estado_pregunta"],"id"?: string,"id_materia"?: string,"id_tema"?: string,"origen"?: string,"revisor"?: string | null,"solucion"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pregunta_tema_fk"
      columns: ["id_tema","id_materia"]
isOneToOne: false
      referencedRelation: "tema"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"pregunta_habilidad": {
                  Row: {
                    "id_habilidad": string,"id_materia": string,"id_pregunta": string
                  }
                  Insert: {
                    "id_habilidad": string,"id_materia": string,"id_pregunta": string
                  }
                  Update: {
                    "id_habilidad"?: string,"id_materia"?: string,"id_pregunta"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pregunta_habilidad_habilidad_fk"
      columns: ["id_habilidad","id_materia"]
isOneToOne: false
      referencedRelation: "habilidad"
      referencedColumns: ["id","id_materia"]
    },{
      foreignKeyName: "pregunta_habilidad_pregunta_fk"
      columns: ["id_pregunta","id_materia"]
isOneToOne: false
      referencedRelation: "pregunta"
      referencedColumns: ["id","id_materia"]
    }
                  ]
                },"reembolso": {
                  Row: {
                    "estado": Database["public"]['Enums']["estado_reembolso"],"fecha_generacion": string,"fecha_reembolso": string | null,"id": string,"id_admin": string | null,"id_pago": string,"llave_destino": string | null,"monto": number,"motivo": string,"referencia_transferencia": string | null
                  }
                  Insert: {
                    "estado"?: Database["public"]['Enums']["estado_reembolso"],"fecha_generacion"?: string,"fecha_reembolso"?: string | null,"id"?: string,"id_admin"?: string | null,"id_pago": string,"llave_destino"?: string | null,"monto": number,"motivo": string,"referencia_transferencia"?: string | null
                  }
                  Update: {
                    "estado"?: Database["public"]['Enums']["estado_reembolso"],"fecha_generacion"?: string,"fecha_reembolso"?: string | null,"id"?: string,"id_admin"?: string | null,"id_pago"?: string,"llave_destino"?: string | null,"monto"?: number,"motivo"?: string,"referencia_transferencia"?: string | null
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
                },"solicitud_llave": {
                  Row: {
                    "creada_en": string,"en_correo_de_cancelacion": boolean,"id_reembolso": string,"token": string
                  }
                  Insert: {
                    "creada_en"?: string,"en_correo_de_cancelacion"?: boolean,"id_reembolso": string,"token"?: string
                  }
                  Update: {
                    "creada_en"?: string,"en_correo_de_cancelacion"?: boolean,"id_reembolso"?: string,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "solicitud_llave_id_reembolso_fkey"
      columns: ["id_reembolso"]
isOneToOne: true
      referencedRelation: "reembolso"
      referencedColumns: ["id"]
    }
                  ]
                },"solicitud_monitor": {
                  Row: {
                    "abierta": boolean | null,"acepta_tratamiento_datos": boolean,"actualizada_en": string,"correo": string,"creada_en": string,"estado": Database["public"]['Enums']["estado_solicitud_monitor"],"fecha_consentimiento": string,"id": string,"id_admin_actualizo": string | null,"nombre": string,"numero_telefono": string
                  }
                  Insert: {
                    "abierta"?: never,"acepta_tratamiento_datos": boolean,"actualizada_en"?: string,"correo": string,"creada_en"?: string,"estado"?: Database["public"]['Enums']["estado_solicitud_monitor"],"fecha_consentimiento": string,"id"?: string,"id_admin_actualizo"?: string | null,"nombre": string,"numero_telefono": string
                  }
                  Update: {
                    "abierta"?: never,"acepta_tratamiento_datos"?: boolean,"actualizada_en"?: string,"correo"?: string,"creada_en"?: string,"estado"?: Database["public"]['Enums']["estado_solicitud_monitor"],"fecha_consentimiento"?: string,"id"?: string,"id_admin_actualizo"?: string | null,"nombre"?: string,"numero_telefono"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "solicitud_monitor_id_admin_actualizo_fkey"
      columns: ["id_admin_actualizo"]
isOneToOne: false
      referencedRelation: "admin"
      referencedColumns: ["id"]
    }
                  ]
                },"solicitud_monitor_materia": {
                  Row: {
                    "id_materia": string,"id_solicitud": string
                  }
                  Insert: {
                    "id_materia": string,"id_solicitud": string
                  }
                  Update: {
                    "id_materia"?: string,"id_solicitud"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "solicitud_monitor_materia_id_materia_fkey"
      columns: ["id_materia"]
isOneToOne: false
      referencedRelation: "materia"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "solicitud_monitor_materia_id_solicitud_fkey"
      columns: ["id_solicitud"]
isOneToOne: false
      referencedRelation: "solicitud_monitor"
      referencedColumns: ["id"]
    }
                  ]
                },"tema": {
                  Row: {
                    "clave": string,"id": string,"id_materia": string,"nombre": string,"orden": number
                  }
                  Insert: {
                    "clave": string,"id"?: string,"id_materia": string,"nombre": string,"orden": number
                  }
                  Update: {
                    "clave"?: string,"id"?: string,"id_materia"?: string,"nombre"?: string,"orden"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tema_id_materia_fkey"
      columns: ["id_materia"]
isOneToOne: false
      referencedRelation: "materia"
      referencedColumns: ["id"]
    }
                  ]
                },"verificacion_lead": {
                  Row: {
                    "creada_en": string,"id": string,"id_lead": string,"siguiente": string,"token_hash": string,"usada_en": string | null,"vence_en": string
                  }
                  Insert: {
                    "creada_en"?: string,"id"?: string,"id_lead": string,"siguiente"?: string,"token_hash": string,"usada_en"?: string | null,"vence_en"?: string
                  }
                  Update: {
                    "creada_en"?: string,"id"?: string,"id_lead"?: string,"siguiente"?: string,"token_hash"?: string,"usada_en"?: string | null,"vence_en"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verificacion_lead_id_lead_fkey"
      columns: ["id_lead"]
isOneToOne: false
      referencedRelation: "lead"
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
            "acceso_a_mis_franjas":
{ Args: Record<PropertyKey, never>; Returns: {
              "enlace": string,"id_franja": string,"lugar": string
            }[]
                           },
"agendar_monitoria":
{ Args: { "p_acepta_sin_cancelacion"?: boolean,"p_codigo_materia": string,"p_fecha": string,"p_id_franja": string }; Returns: {
              "id_monitoria": string,"resultado": string
            }[]
                           },
"anotar_comprobante_revisado":
{ Args: { "p_ruta": string,"p_tipo": string }; Returns: string
                           },
"cancelable_hasta":
{ Args: { "p_es_grupal": boolean,"p_inicio": string }; Returns: string
                           },
"cancelar_cita_por_token":
{ Args: { "p_token": string }; Returns: string
                           },
"cancelar_mi_cita":
{ Args: { "p_id_monitoria": string }; Returns: string
                           },
"cierre_automatico_desde":
{ Args: { "p_fin_programado": string }; Returns: string
                           },
"cita_por_token":
{ Args: { "p_token": string }; Returns: {
              "cancelable_hasta": string,"codigo_materia": string,"duracion_min": number,"enlace": string,"estado": Database["public"]['Enums']["estado_monitoria"],"estado_pago": string,"estado_reembolso": string,"estado_reporte": string,"fecha": string,"fin_programado": string,"hora": string,"id_monitoria": string,"inicio": string,"lugar": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_materia": string,"nombre_monitor": string,"observaciones_reporte": string,"presencial": boolean,"reporte_hasta": string,"valor_total": number
            }[]
                           },
"comision":
{ Args: { "p_monto_bruto": number }; Returns: number
                           },
"confirmar_correo_de_lead":
{ Args: { "p_id_sesion": string,"p_token_hash": string }; Returns: {
              "id_lead": string,"siguiente": string
            }[]
                           },
"crear_solicitud_monitor":
{ Args: { "p_correo": string,"p_fecha_consentimiento": string,"p_materias": (string)[],"p_nombre": string,"p_numero_telefono": string }; Returns: string
                           },
"crear_verificacion_lead":
{ Args: { "p_correo": string,"p_maximo_por_hora": number,"p_siguiente": string,"p_token_hash": string }; Returns: {
              "correo_lead": string,"id_del_lead": string,"id_verificacion": string,"nombre_lead": string,"vence": string
            }[]
                           },
"cumple_antelacion":
{ Args: { "p_ahora": string,"p_es_grupal": boolean,"p_inicio": string }; Returns: boolean
                           },
"datos_de_aviso_monitor":
{ Args: { "p_id_monitoria": string }; Returns: {
              "correo_monitor": string,"duracion_min": number,"estado": Database["public"]['Enums']["estado_monitoria"],"grupal": boolean,"inicio": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_estudiante": string,"nombre_materia": string,"nombre_monitor": string,"presencial": boolean
            }[]
                           },
"datos_de_cancelacion_cita":
{ Args: { "p_id_monitoria": string }; Returns: {
              "con_pago_en_revision": boolean,"correo_destino": string,"creada_en": string,"estado": Database["public"]['Enums']["estado_monitoria"],"grupal": boolean,"inicio": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_lead": string,"nombre_materia": string,"reembolso_a_otro_contacto": boolean,"token_cita": string
            }[]
                           },
"datos_de_confirmacion_cita":
{ Args: { "p_id_monitoria": string }; Returns: {
              "cancelable_hasta": string,"correo_destino": string,"creada_en": string,"duracion_min": number,"enlace": string,"estado": Database["public"]['Enums']["estado_monitoria"],"grupal": boolean,"inicio": string,"lugar": string,"nombre_lead": string,"nombre_materia": string,"nombre_monitor": string,"presencial": boolean,"token": string,"valor_total": number
            }[]
                           },
"datos_de_invitacion_resena":
{ Args: { "p_id_pago": string }; Returns: {
              "correo_lead": string,"disponible": boolean,"nombre_lead": string,"nombre_monitor": string,"token": string
            }[]
                           },
"dentro_de_plazo":
{ Args: { "p_ahora": string,"p_limite": string }; Returns: boolean
                           },
"desembolsable_desde":
{ Args: { "p_fin_programado": string }; Returns: string
                           },
"desembolso_ejecutable":
{ Args: { "p_ahora": string,"p_fin_programado": string }; Returns: boolean
                           },
"equipo_de_admins":
{ Args: Record<PropertyKey, never>; Returns: {
              "activo": boolean,"casos_abiertos": number,"correo": string,"id": string,"nombre": string,"orden_revision": number
            }[]
                           },
"fecha_limite_diferencia":
{ Args: { "p_inicio": string }; Returns: string
                           },
"fecha_limite_pago":
{ Args: { "p_inicio": string }; Returns: string
                           },
"fechas_libres_de_materia":
{ Args: { "p_codigo_materia": string,"p_semanas": number }; Returns: {
              "duracion_min": number,"fecha": string,"hora": string,"id_franja": string,"id_monitor": string,"nombre_monitor": string,"precio": number,"presencial": boolean
            }[]
                           },
"fin_programado":
{ Args: { "p_duracion_min": number,"p_inicio": string }; Returns: string
                           },
"finalizar_monitoria":
{ Args: { "p_id_monitoria": string }; Returns: string
                           },
"inicio_sesion":
{ Args: { "p_fecha": string,"p_hora": string }; Returns: string
                           },
"llaves_de_cancelacion":
{ Args: { "p_id_monitoria": string }; Returns: {
              "id_reembolso": string,"monto": number,"token": string
            }[]
                           },
"mi_agenda":
{ Args: Record<PropertyKey, never>; Returns: {
              "codigo_materia": string,"duracion_min": number,"estado": Database["public"]['Enums']["estado_monitoria"],"estado_pago": string,"fecha": string,"hora": string,"id_monitoria": string,"inicio": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_estudiante": string,"nombre_materia": string,"presencial": boolean,"reserva_vencida": boolean
            }[]
                           },
"mi_cita":
{ Args: { "p_id_monitoria": string }; Returns: {
              "cancelable_hasta": string,"codigo_materia": string,"duracion_min": number,"enlace": string,"estado": Database["public"]['Enums']["estado_monitoria"],"estado_pago": string,"estado_reembolso": string,"estado_reporte": string,"fecha": string,"fin_programado": string,"hora": string,"id_monitoria": string,"inicio": string,"lugar": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_materia": string,"nombre_monitor": string,"observaciones_reporte": string,"presencial": boolean,"reporte_hasta": string,"valor_total": number
            }[]
                           },
"mi_cuota_de_comprobantes":
{ Args: Record<PropertyKey, never>; Returns: {
              "libre_desde": string,"maximo": number,"usados": number
            }[]
                           },
"mi_rol":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"mis_citas":
{ Args: Record<PropertyKey, never>; Returns: {
              "cancelable_hasta": string,"codigo_materia": string,"duracion_min": number,"enlace": string,"estado": Database["public"]['Enums']["estado_monitoria"],"estado_pago": string,"estado_reembolso": string,"estado_reporte": string,"fecha": string,"fin_programado": string,"hora": string,"id_monitoria": string,"inicio": string,"lugar": string,"motivo_cancelacion": Database["public"]['Enums']["motivo_cancelacion"],"nombre_materia": string,"nombre_monitor": string,"observaciones_reporte": string,"presencial": boolean,"reporte_hasta": string,"valor_total": number
            }[]
                           },
"monto_neto":
{ Args: { "p_monto_bruto": number }; Returns: number
                           },
"mover_admin":
{ Args: { "p_direccion": string,"p_id": string }; Returns: string
                           },
"parametros_comision":
{ Args: Record<PropertyKey, never>; Returns: {
              "comision_porcentaje": number,"comision_tope": number
            }[]
                           },
"parametros_comprobantes":
{ Args: Record<PropertyKey, never>; Returns: {
              "cuota_subidas": number,"cuota_ventana_min": number,"huerfano_tras_min": number
            }[]
                           },
"parametros_negocio":
{ Args: Record<PropertyKey, never>; Returns: {
              "antelacion_grupal_min": number,"antelacion_individual_min": number,"cancelacion_grupal_min": number,"cancelacion_individual_min": number,"cierre_automatico_min": number,"desembolso_min": number,"diferencia_min": number,"pago_integrantes_min": number,"reporte_inasistencia_min": number,"resena_grupal_min": number,"reserva_min": number,"revision_min": number
            }[]
                           },
"plazo_alcanzado":
{ Args: { "p_ahora": string,"p_desde": string }; Returns: boolean
                           },
"reasignar_casos_de_admin":
{ Args: { "p_id_admin": string }; Returns: number
                           },
"registrar_lead":
{ Args: { "p_acepta_contacto": boolean,"p_correo": string,"p_fecha_consentimiento": string,"p_id_sesion": string,"p_nombre": string,"p_numero_telefono": string,"p_origen": string }; Returns: string
                           },
"registrar_monitor":
{ Args: { "p_correo": string,"p_id_usuario": string,"p_llave": string,"p_nombre": string,"p_numero_telefono": string,"p_token_hash": string }; Returns: boolean
                           },
"registrar_pago":
{ Args: { "p_comprobante": string,"p_contacto": string,"p_id_monitoria": string,"p_nombre": string }; Returns: {
              "id_pago": string,"resultado": string
            }[]
                           },
"registrar_resena":
{ Args: { "p_calificacion": number,"p_comentario": string,"p_token": string }; Returns: string
                           },
"reportar_inasistencia_de_mi_cita":
{ Args: { "p_id_monitoria": string }; Returns: string
                           },
"reportar_inasistencia_por_token":
{ Args: { "p_token": string }; Returns: string
                           },
"reporte_inasistencia_hasta":
{ Args: { "p_fin_programado": string }; Returns: string
                           },
"resena_por_token":
{ Args: { "p_token": string }; Returns: {
              "estado": string,"inicio": string,"nombre_materia": string,"nombre_monitor": string
            }[]
                           },
"reserva_hasta":
{ Args: { "p_fecha_creacion": string }; Returns: string
                           },
"revisar_pago":
{ Args: { "p_decision": string,"p_id_pago": string,"p_observaciones"?: string }; Returns: {
              "cancelo_monitoria": boolean,"resultado": string
            }[]
                           },
"revision_hasta":
{ Args: { "p_fecha_asignacion": string }; Returns: string
                           },
"tomar_comprobantes_huerfanos":
{ Args: { "p_limite"?: number }; Returns: {
              "ruta": string
            }[]
                           },
"ventana_resena_hasta":
{ Args: { "p_fecha_finalizacion": string }; Returns: string
                           }
          }
          Enums: {
            "estado_correo": "pendiente"|"enviado"|"fallido","estado_desembolso": "pendiente"|"desembolsado"|"anulado","estado_lead": "nuevo"|"contactado"|"descartado","estado_monitoria": "pendiente_pago"|"confirmada"|"realizada"|"cancelada","estado_pago": "en_revision"|"aprobado"|"rechazado","estado_pregunta": "borrador"|"revisada"|"retirada","estado_reembolso": "esperando_llave"|"pendiente"|"reembolsado","estado_reporte": "en_revision"|"aceptado"|"rechazado","estado_solicitud_monitor": "nueva"|"contactada"|"evaluada"|"descartada","modalidad_pago": "unico"|"dividido","motivo_cancelacion": "reserva_expirada"|"pago_rechazado"|"estudiante"|"monitor_no_asistio"|"diferencia_no_cubierta"
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
            "estado_correo": ["pendiente", "enviado", "fallido"],"estado_desembolso": ["pendiente", "desembolsado", "anulado"],"estado_lead": ["nuevo", "contactado", "descartado"],"estado_monitoria": ["pendiente_pago", "confirmada", "realizada", "cancelada"],"estado_pago": ["en_revision", "aprobado", "rechazado"],"estado_pregunta": ["borrador", "revisada", "retirada"],"estado_reembolso": ["esperando_llave", "pendiente", "reembolsado"],"estado_reporte": ["en_revision", "aceptado", "rechazado"],"estado_solicitud_monitor": ["nueva", "contactada", "evaluada", "descartada"],"modalidad_pago": ["unico", "dividido"],"motivo_cancelacion": ["reserva_expirada", "pago_rechazado", "estudiante", "monitor_no_asistio", "diferencia_no_cubierta"]
          }
        }
} as const

