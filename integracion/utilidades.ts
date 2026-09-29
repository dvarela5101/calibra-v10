import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";

/** Cliente tipado con la sesión de quien lo use (o sin sesión). */
export type Cliente = SupabaseClient<Database>;

export type UsuarioPrueba = { id: string; correo: string; contrasena: string };

const AYUDA = "corre npm run db:iniciar y npm run db:env";
const HOSTS_LOCALES = ["127.0.0.1", "localhost", "[::1]", "::1"];

/**
 * Comprueba que estén las llaves del Supabase local y que la URL sea local: estas
 * pruebas crean y borran usuarios, así que jamás deben apuntar a un proyecto remoto.
 */
export function exigirEntorno() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llavePublica = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const llaveSecreta = process.env.SUPABASE_SECRET_KEY;
  const faltan = [
    ["NEXT_PUBLIC_SUPABASE_URL", url],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", llavePublica],
    ["SUPABASE_SECRET_KEY", llaveSecreta],
  ]
    .filter(([, valor]) => !valor)
    .map(([nombre]) => nombre);
  if (!url || !llavePublica || !llaveSecreta) {
    throw new Error(`Faltan variables de entorno (${faltan.join(", ")}): ${AYUDA}.`);
  }
  if (!HOSTS_LOCALES.includes(new URL(url).hostname)) {
    throw new Error(
      "Las pruebas de integración solo corren contra el Supabase local, pero NEXT_PUBLIC_SUPABASE_URL apunta a otro host " +
        `(regenera .env.local: ${AYUDA}).`,
    );
  }
  return { url, llavePublica, llaveSecreta };
}

/** Falla con un mensaje claro si el Supabase local no está corriendo. */
export async function exigirSupabaseLocal(): Promise<void> {
  const { url, llavePublica } = exigirEntorno();
  try {
    const respuesta = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: llavePublica },
      signal: AbortSignal.timeout(5_000),
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(`El Supabase local no responde en ${url} (${detalle}): ${AYUDA}.`);
  }
}

/** Cliente con la llave publicable y sin persistencia: cada uno es una "pestaña" distinta. */
export function crearCliente(): Cliente {
  const { url, llavePublica } = exigirEntorno();
  return createClient<Database>(url, llavePublica, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Desenvuelve `{ data, error }` de supabase-js y falla con contexto si hubo error. */
export function exito<T>(resultado: { data: T; error: { message: string } | null }, contexto: string): NonNullable<T> {
  if (resultado.error) throw new Error(`${contexto}: ${resultado.error.message}`);
  if (resultado.data === null || resultado.data === undefined) throw new Error(`${contexto}: sin datos`);
  return resultado.data;
}

/** Rol que la base le reconoce al cliente (`public.mi_rol()`), o null si ninguno. */
export async function rolDe(cliente: Cliente): Promise<string | null> {
  const { data, error } = await cliente.rpc("mi_rol");
  if (error) throw new Error(`mi_rol: ${error.message}`);
  return data as string | null;
}

/** Ids de las filas que el cliente ve en una tabla, filtrando por id (RLS decide qué llega). */
export async function idsVisibles(
  cliente: Cliente,
  tabla: "diagnostico" | "lead" | "monitor_privado" | "monitor" | "admin" | "certificado",
  columna: string,
  valor: string,
): Promise<string[]> {
  const { data, error } = await cliente.from(tabla).select(columna).eq(columna, valor);
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return (data as unknown as Record<string, string>[]).map((fila) => fila[columna]);
}

const contrasenaAleatoria = () => randomBytes(18).toString("base64url");
const correoUnico = () => `prueba-${randomUUID()}@calibra.test`;
const sinBorrar = (mensaje: string) => /not found/i.test(mensaje);

/**
 * Crea datos de prueba con la llave secreta y los borra al final con `limpiar()`.
 * Una instancia por prueba: registra cada id que crea, así la limpieza también cubre
 * pruebas que fallan a medias.
 */
export class Fixtures {
  readonly admin = crearClienteAdmin();
  private readonly usuarios: string[] = [];
  private readonly materias: string[] = [];
  private readonly evaluaciones: string[] = [];
  private readonly leads: string[] = [];
  private readonly franjas: string[] = [];
  private readonly monitorias: string[] = [];
  private readonly pagos: string[] = [];
  private readonly archivos: string[] = [];

  constructor() {
    exigirEntorno();
  }

  /** Usuario permanente con correo y contraseña aleatorios. */
  async crearUsuario(): Promise<UsuarioPrueba> {
    const correo = correoUnico();
    const contrasena = contrasenaAleatoria();
    const { data, error } = await this.admin.auth.admin.createUser({ email: correo, password: contrasena, email_confirm: true });
    if (error) throw new Error(`crearUsuario: ${error.message}`);
    this.usuarios.push(data.user.id);
    return { id: data.user.id, correo, contrasena };
  }

  /** Visitante anónimo: devuelve el cliente con la sesión activa y su id. */
  async crearAnonimo(): Promise<{ cliente: Cliente; id: string }> {
    const cliente = crearCliente();
    const { data, error } = await cliente.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`signInAnonymously: ${error?.message ?? "sin usuario"}`);
    this.usuarios.push(data.user.id);
    return { cliente, id: data.user.id };
  }

  /** Cliente nuevo con la sesión real de esa cuenta (nada de claims simulados). */
  async iniciarSesion(usuario: UsuarioPrueba): Promise<Cliente> {
    const cliente = crearCliente();
    const { error } = await cliente.auth.signInWithPassword({ email: usuario.correo, password: usuario.contrasena });
    if (error) throw new Error(`signInWithPassword: ${error.message}`);
    return cliente;
  }

  async crearAdmin() {
    const usuario = await this.crearUsuario();
    const fila = {
      id: usuario.id,
      nombre: "Admin de prueba",
      correo: usuario.correo,
      // Único y alto para no chocar con los admins reales de la base.
      orden_revision: randomInt(1_000_000, 2_000_000_000),
    };
    exito(await this.admin.from("admin").insert(fila).select().single(), "insertar admin");
    return usuario;
  }

  async crearMonitor(opciones: { conContacto?: boolean } = {}) {
    const usuario = await this.crearUsuario();
    exito(await this.admin.from("monitor").insert({ id: usuario.id, nombre: "Monitor de prueba" }).select().single(), "insertar monitor");
    if (opciones.conContacto) {
      exito(
        await this.admin
          .from("monitor_privado")
          .insert({ id_monitor: usuario.id, numero_telefono: "3000000000", correo: usuario.correo, llave: `llave-${randomUUID()}` })
          .select()
          .single(),
        "insertar monitor_privado",
      );
    }
    return usuario;
  }

  async crearLead() {
    const lead = exito(
      await this.admin
        .from("lead")
        .insert({
          nombre: "Lead de prueba",
          correo: correoUnico(),
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        })
        .select()
        .single(),
      "insertar lead",
    );
    this.leads.push(lead.id);
    return lead;
  }

  async crearEstudiante() {
    const usuario = await this.crearUsuario();
    const lead = await this.crearLead();
    exito(await this.admin.from("estudiante").insert({ id: usuario.id, id_lead: lead.id }).select().single(), "insertar estudiante");
    return usuario;
  }

  async crearEvaluacion() {
    const materia = exito(
      await this.admin
        .from("materia")
        .insert({ nombre: "Materia de prueba", codigo: `INT-${randomUUID().slice(0, 12)}` })
        .select()
        .single(),
      "insertar materia",
    );
    this.materias.push(materia.id);
    const evaluacion = exito(
      await this.admin.from("evaluacion").insert({ id_materia: materia.id, semana: 1, nombre: "Parcial de prueba" }).select().single(),
      "insertar evaluacion",
    );
    this.evaluaciones.push(evaluacion.id);
    return { materia, evaluacion };
  }

  async crearCertificado(datos: { idMonitor: string; idMateria: string; idAdmin: string }) {
    return exito(
      await this.admin
        .from("certificado")
        .insert({ id_monitor: datos.idMonitor, id_materia: datos.idMateria, id_admin: datos.idAdmin })
        .select()
        .single(),
      "insertar certificado",
    );
  }

  /** Diagnóstico de una sesión anónima (id_lead nulo, RN de P-33); id_materia lo llena un trigger. */
  async crearDiagnostico(datos: { idSesionAnonima: string; idEvaluacion: string; idMateria: string }) {
    return exito(
      await this.admin
        .from("diagnostico")
        .insert({
          id_sesion_anonima: datos.idSesionAnonima,
          id_evaluacion: datos.idEvaluacion,
          id_materia: datos.idMateria,
          respuestas: { p1: "a", p2: "c" },
          puntaje: 62.5,
          resultado_por_tema: { algebra: 0.5, calculo: 0.75 },
        })
        .select()
        .single(),
      "insertar diagnostico",
    );
  }

  /** Anota un archivo del bucket de comprobantes para que `limpiar()` lo borre con la API de Storage. */
  registrarComprobante(ruta: string): void {
    this.archivos.push(ruta);
  }

  /**
   * Un pago de una individual, con la cadena mínima que exige el modelo: materia, monitor
   * certificado, franja del lunes, lead y monitoría. `comprobante` es la ruta que guarda el pago.
   */
  async crearPago(datos: { idAdmin: string; comprobante: string }) {
    const { materia } = await this.crearEvaluacion();
    const monitor = await this.crearMonitor();
    await this.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: datos.idAdmin });
    const franja = exito(
      await this.admin
        .from("franja")
        .insert({ id_monitor: monitor.id, dia: 1, hora: "10:00", presencial: true, precio: 25_000, duracion_min: 60 })
        .select()
        .single(),
      "insertar franja",
    );
    this.franjas.push(franja.id);
    const lead = await this.crearLead();
    // 2030-01-07 cae en lunes, el día de la franja.
    const monitoria = exito(
      await this.admin
        .from("monitoria")
        .insert({
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha: "2030-01-07",
          valor_total: 25_000,
        })
        .select()
        .single(),
      "insertar monitoria",
    );
    this.monitorias.push(monitoria.id);
    const pago = exito(
      await this.admin
        .from("pago")
        .insert({
          id_monitoria: monitoria.id,
          monto: 25_000,
          nombre_pagador: "Pagador de prueba",
          contacto: "pagador@calibra.test",
          id_admin: datos.idAdmin,
          comprobante: datos.comprobante,
        })
        .select()
        .single(),
      "insertar pago",
    );
    this.pagos.push(pago.id);
    return { pago, monitor, materia };
  }

  /**
   * Borra todo lo creado, de las filas dependientes hacia los usuarios. Los diagnósticos
   * van antes que el usuario anónimo: ver el informe (diagnostico_tiene_dueno impide
   * borrar a un anónimo que aún tiene diagnósticos).
   */
  async limpiar(): Promise<void> {
    const errores: string[] = [];
    const intentar = async (contexto: string, accion: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await accion;
      if (error && !sinBorrar(error.message)) errores.push(`${contexto}: ${error.message}`);
    };
    const { usuarios, materias, evaluaciones, leads, franjas, monitorias, pagos, archivos } = this;

    // Storage no deja borrar por SQL: los comprobantes se quitan con su API y la llave secreta.
    // Además de los anotados, se barre la carpeta de cada usuario creado: así una subida que una regresión
    // deje pasar, o una prueba que falle antes de anotarla, no deja huérfanos en la base local.
    const porBorrar = new Set(archivos);
    for (const id of usuarios) {
      const { data } = await this.admin.storage.from("comprobantes").list(id, { limit: 1000 });
      for (const archivo of data ?? []) porBorrar.add(`${id}/${archivo.name}`);
    }
    if (porBorrar.size) {
      const { error } = await this.admin.storage.from("comprobantes").remove([...porBorrar]);
      if (error && !sinBorrar(error.message)) errores.push(`borrar comprobantes: ${error.message}`);
    }
    if (pagos.length) await intentar("borrar pago", this.admin.from("pago").delete().in("id", pagos));
    if (monitorias.length) await intentar("borrar monitoria", this.admin.from("monitoria").delete().in("id", monitorias));
    if (franjas.length) await intentar("borrar franja", this.admin.from("franja").delete().in("id", franjas));

    if (usuarios.length || materias.length) {
      const filtros = [
        usuarios.length && `id_monitor.in.(${usuarios.join(",")})`,
        usuarios.length && `id_admin.in.(${usuarios.join(",")})`,
        materias.length && `id_materia.in.(${materias.join(",")})`,
      ].filter(Boolean);
      await intentar("borrar certificado", this.admin.from("certificado").delete().or(filtros.join(",")));
    }
    if (usuarios.length || evaluaciones.length || leads.length) {
      const filtros = [
        usuarios.length && `id_sesion_anonima.in.(${usuarios.join(",")})`,
        evaluaciones.length && `id_evaluacion.in.(${evaluaciones.join(",")})`,
        leads.length && `id_lead.in.(${leads.join(",")})`,
      ].filter(Boolean);
      await intentar("borrar diagnostico", this.admin.from("diagnostico").delete().or(filtros.join(",")));
    }
    if (usuarios.length) await intentar("borrar estudiante", this.admin.from("estudiante").delete().in("id", usuarios));
    if (leads.length) await intentar("borrar lead", this.admin.from("lead").delete().in("id", leads));
    if (evaluaciones.length) await intentar("borrar evaluacion", this.admin.from("evaluacion").delete().in("id", evaluaciones));
    if (materias.length) await intentar("borrar materia", this.admin.from("materia").delete().in("id", materias));

    // admin, monitor y monitor_privado se van en cascada con el usuario de Auth.
    for (const id of usuarios) {
      await intentar(`borrar usuario ${id}`, this.admin.auth.admin.deleteUser(id));
    }

    usuarios.length = materias.length = evaluaciones.length = leads.length = 0;
    franjas.length = monitorias.length = pagos.length = archivos.length = 0;
    if (errores.length) throw new Error(`La limpieza dejó datos de prueba en la base local:\n- ${errores.join("\n- ")}`);
  }
}
