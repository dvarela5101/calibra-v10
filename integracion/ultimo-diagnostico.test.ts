import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ponerContrasena, vincularCorreo } from "@/lib/auth/convertir";
import { leerMiDiagnostico, leerMiUltimoDiagnostico } from "@/lib/diagnostico/lectura";
import { CLAVES_DEL_RESULTADO, type ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { CLAVES_INTERNAS_DE_EJEMPLO, GUARDADO_DE_EJEMPLO, sembrarDiagnostico } from "../pruebas/diagnostico-sembrado";
import { centinelasDeLasRespuestas, respuestasConCentinelas } from "../pruebas/respuestas-con-centinelas";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, iniciarSesionConClave, rolDe, type Cliente } from "./utilidades";

/**
 * HU-011 contra el Supabase LOCAL: `public.mi_ultimo_diagnostico()` con sesiones de verdad (la Data API con el JWT de cada una).
 * Es la prueba con JWT reales que pgTAP (`supabase/tests/ultimo_diagnostico.test.sql`) simula con `request.jwt.claims`.
 *
 * - D.3-1: la sesión dueña recibe su último diagnóstico (el de la materia B, aunque otra sesión y un Lead tengan uno más nuevo),
 *   con los valores sembrados, igual a lo que da `mi_diagnostico(id)` de HU-009, y la fila de PostgREST trae exactamente 8 claves.
 * - D.3-2 (D-53 e): la sesión ligada al Lead por `lead_sesion` (el enlace de P-23) y la que lo creó reciben `null`, aunque la
 *   fila es del Lead; desde HU-095 la política de `diagnostico` tampoco se la deja leer.
 * - D.3-3: la cuenta de Estudiante del Lead que es otro usuario recibe `null` en la portada y sí el resultado con
 *   `leerMiDiagnostico(cliente, id)`. En cambio la cuenta que nació de convertir la sesión que hizo el diagnóstico
 *   (el flujo de HU-032, `vincularCorreo` y `ponerContrasena`: el id no cambia) recibe el suyo, en el mismo navegador y en otro, y no el más reciente de su Lead.
 * - D.3-4: un monitor y un admin con una fila a su nombre reciben `null` (el rol real dentro de dos `security definer`).
 * - D.3-5: sin sesión se lanza con 42501, y la llave secreta tampoco la ejecuta (no tiene grant): la portada no podría usarla.
 *
 * Las materias y Evaluaciones se renombran (`Fixtures.crearEvaluacion` deja siempre los mismos nombres): con nombres iguales, una
 * proyección que intercambie `nombre_materia` y `nombre_evaluacion`, o que devuelva la materia equivocada, pasaría.
 *
 * Presupuesto del Auth local (150 sesiones anónimas por hora y 30 inicios con contraseña cada 5 minutos, de toda la suite): las
 * cinco sesiones anónimas y los tres inicios con contraseña de `beforeAll` se crean una sola vez para todo el archivo; la prueba de
 * la cuenta convertida suma dos sesiones anónimas y un inicio con contraseña.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SEMILLA_CENTINELA = 3141592653;

/** Los ids de los diagnósticos llevan un prefijo aleatorio por corrida y los dos últimos dígitos fijos: un resto no choca con la siguiente. */
const base = randomUUID().slice(0, 34);
const idDe = (final: string) => `${base}${final}`;

type Persona = { cliente: Cliente; id: string };

let bd: pg.Client;
let fx: Fixtures | undefined;

/** La materia B y las dos Evaluaciones, todo con nombre propio (la A, «Alfa», ordena antes que la B, «Beta»). */
let materiaB: { id: string; codigo: string; nombre: string };
let evaluacionA: { id: string; nombre: string };
let evaluacionB: { id: string; nombre: string };

let creadora: Persona;
let duena: Persona;
let ligada: Persona;
let otra: Persona;
let empate: Persona;
let estudianteDelLead: Cliente;
let monitor: Persona;
let admin: Persona;
let lead: { id: string };

const ganador = idDe("b1");
const FECHA_DEL_GANADOR = "2026-10-05T03:30:00.000Z";

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();

  fx = new Fixtures();
  const sufijo = randomUUID().slice(0, 6);
  const a = await fx.crearEvaluacion();
  const b = await fx.crearEvaluacion();
  const renombrarMateria = async (id: string, nombre: string) =>
    exito(await fx!.admin.from("materia").update({ nombre }).eq("id", id).select("nombre").single(), "renombrar la materia");
  const renombrarEvaluacion = async (id: string, nombre: string) =>
    exito(await fx!.admin.from("evaluacion").update({ nombre }).eq("id", id).select("nombre").single(), "renombrar la Evaluación");
  await renombrarMateria(a.materia.id, `Materia Integración Alfa ${sufijo}`);
  await renombrarMateria(b.materia.id, `Materia Integración Beta ${sufijo}`);
  await renombrarEvaluacion(a.evaluacion.id, `Parcial Integración Uno ${sufijo}`);
  await renombrarEvaluacion(b.evaluacion.id, `Parcial Integración Dos ${sufijo}`);
  materiaB = { id: b.materia.id, codigo: b.materia.codigo, nombre: `Materia Integración Beta ${sufijo}` };
  evaluacionA = { id: a.evaluacion.id, nombre: `Parcial Integración Uno ${sufijo}` };
  evaluacionB = { id: b.evaluacion.id, nombre: `Parcial Integración Dos ${sufijo}` };

  creadora = await fx.crearAnonimo();
  duena = await fx.crearAnonimo();
  ligada = await fx.crearAnonimo();
  otra = await fx.crearAnonimo();
  empate = await fx.crearAnonimo();

  // El Lead lo creó `creadora` (como al dejar el contacto); la dueña y `ligada` lo confirmaron por el enlace de P-23 (`lead_sesion`);
  // y su cuenta de Estudiante es un usuario aparte, con contraseña.
  lead = await fx.crearLeadDeSesion(creadora.id);
  for (const sesion of [duena, ligada]) {
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: sesion.id, id_lead: lead.id }).select().single(), "ligar la sesión al Lead");
  }
  const cuenta = await fx.crearUsuario();
  exito(await fx.admin.from("estudiante").insert({ id: cuenta.id, id_lead: lead.id }).select().single(), "insertar la cuenta de Estudiante del Lead");
  estudianteDelLead = await fx.iniciarSesion(cuenta);

  const cuentaDelMonitor = await fx.crearMonitor();
  monitor = { cliente: await fx.iniciarSesion(cuentaDelMonitor), id: cuentaDelMonitor.id };
  const cuentaDelAdmin = await fx.crearAdmin();
  admin = { cliente: await fx.iniciarSesion(cuentaDelAdmin), id: cuentaDelAdmin.id };

  // La dueña: tres diagnósticos, uno por uno y en este orden (el orden físico no puede delatar un `limit 1` sin `order by`). El
  // ganador no es el primero ni el último insertado, ni el de materia de nombre menor, ni el de id mayor. Lleva lo que nadie con
  // sesión debe leer: el repetido, la semilla, el token (lo pone la base), la marca de falta de material y las copias de las preguntas.
  await sembrarDiagnostico(bd, {
    id: idDe("b3"),
    idSesionAnonima: duena.id,
    idEvaluacion: evaluacionA.id,
    fecha: "2026-10-02T03:30:00.000Z",
    claves: ["P1", "P2", "P3"],
    aciertos: 1,
    repetido: true,
  });
  await sembrarDiagnostico(bd, {
    id: ganador,
    idSesionAnonima: duena.id,
    idLead: lead.id,
    idEvaluacion: evaluacionB.id,
    fecha: FECHA_DEL_GANADOR,
    repetido: true,
    semilla: SEMILLA_CENTINELA,
    respuestas: respuestasConCentinelas(8),
  });
  await sembrarDiagnostico(bd, {
    id: idDe("b2"),
    idSesionAnonima: duena.id,
    idLead: lead.id,
    idEvaluacion: evaluacionA.id,
    fecha: "2026-10-03T03:30:00.000Z",
    claves: ["P1", "P2", "P3", "P4"],
    aciertos: 2,
  });
  // Trampa de «el último del Lead»: un diagnóstico del Lead, sin sesión, más reciente que todos los de la dueña.
  await sembrarDiagnostico(bd, {
    id: idDe("c3"),
    idLead: lead.id,
    idEvaluacion: evaluacionA.id,
    fecha: "2026-10-06T03:30:00.000Z",
    claves: ["P1", "P2", "P3", "P4", "P5"],
    aciertos: 4,
  });
  // Trampa de «el último de todos»: otra sesión, más reciente que todo lo demás.
  await sembrarDiagnostico(bd, {
    id: idDe("c2"),
    idSesionAnonima: otra.id,
    idEvaluacion: evaluacionB.id,
    fecha: "2026-10-06T15:30:00.000Z",
    claves: ["P1", "P2", "P3", "P4", "P5", "P6"],
    aciertos: 3,
  });
  // Empate: la misma fecha exacta, materias distintas, el id menor insertado primero.
  await sembrarDiagnostico(bd, {
    id: idDe("0a"),
    idSesionAnonima: empate.id,
    idEvaluacion: evaluacionA.id,
    fecha: "2026-10-04T12:00:00.000Z",
    claves: ["P1", "P2", "P3"],
    aciertos: 2,
  });
  await sembrarDiagnostico(bd, {
    id: idDe("ff"),
    idSesionAnonima: empate.id,
    idEvaluacion: evaluacionB.id,
    fecha: "2026-10-04T12:00:00.000Z",
    claves: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
    aciertos: 6,
  });
  // Un monitor y un admin que son, además, la sesión dueña de una fila.
  await sembrarDiagnostico(bd, { id: idDe("e7"), idSesionAnonima: monitor.id, idEvaluacion: evaluacionA.id, fecha: "2026-10-03T10:00:00.000Z" });
  await sembrarDiagnostico(bd, { id: idDe("e6"), idSesionAnonima: admin.id, idEvaluacion: evaluacionA.id, fecha: "2026-10-03T11:00:00.000Z" });
});

afterAll(async () => {
  try {
    await fx?.limpiar();
  } finally {
    await bd?.end();
  }
});

/** Todas las claves de un valor, anidadas incluidas. */
function clavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(clavesDe);
  if (typeof valor !== "object" || valor === null) return [];
  return Object.entries(valor).flatMap(([clave, interior]) => [clave, ...clavesDe(interior)]);
}

/** El `token_hash` del correo con el que Auth pide confirmar la cuenta de Estudiante (HU-032), leído de Mailpit. Borra el correo. */
async function tokenDelCorreoDeCuenta(correo: string): Promise<string> {
  const mailpit = process.env.MAILPIT_URL;
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  const limite = Date.now() + 15_000;
  for (;;) {
    const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    const { messages } = (await busqueda.json()) as { messages?: { ID: string; Subject: string }[] };
    const mensaje = messages?.find((m) => m.Subject === "Confirma tu correo para crear tu cuenta de Calibra");
    if (mensaje) {
      const { HTML } = (await (await fetch(`${mailpit}/api/v1/message/${mensaje.ID}`)).json()) as { HTML: string };
      await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: [mensaje.ID] }) });
      const token = /token_hash=([^&"' ]+)/.exec(HTML.replaceAll("&amp;", "&"))?.[1];
      if (!token) throw new Error(`El correo para confirmar la cuenta no trae token_hash: ${correo}`);
      return token;
    }
    if (Date.now() > limite) throw new Error(`No llegó a ${correo} el correo para confirmar la cuenta.`);
    await new Promise((listo) => setTimeout(listo, 250));
  }
}

/** Cuántas filas de `diagnostico` ve esa sesión con un `select` por id: lo que deja la política de la tabla. */
async function filasVisibles(cliente: Cliente, id: string): Promise<number> {
  return exito(await cliente.from("diagnostico").select("id").eq("id", id), "leer diagnostico con la sesión").length;
}

// ---------------------------------------------------------------------------------------------------------------
// D.3-1: la sesión dueña
// ---------------------------------------------------------------------------------------------------------------

describe("la sesión que hizo los diagnósticos recibe el más reciente", () => {
  it("recibe el de la materia B del 5 de octubre, con los valores sembrados, aunque otra sesión y el Lead tengan uno más nuevo", async () => {
    const ultimo = await leerMiUltimoDiagnostico(duena.cliente);
    expect(ultimo).not.toBeNull();
    const resultado = ultimo as ResultadoParaMostrar;

    expect(resultado.idDiagnostico).toBe(ganador);
    expect(resultado.materia).toEqual({ codigo: materiaB.codigo, nombre: materiaB.nombre });
    expect(resultado.evaluacion).toEqual({ nombre: evaluacionB.nombre });
    expect(new Date(resultado.fecha).toISOString()).toBe(FECHA_DEL_GANADOR);
    expect(resultado.respondidas).toBe(8);
    expect(resultado.aciertos).toBe(5);
    expect(resultado.habilidades.map((h) => [h.descripcion, h.nivel, h.respuestas, h.aciertos])).toEqual(
      GUARDADO_DE_EJEMPLO.habilidades.map((h) => [h.descripcion, h.nivel, h.respuestas, h.aciertos]),
    );
    expect(resultado.errores).toHaveLength(GUARDADO_DE_EJEMPLO.errores.length);
    expect(resultado.prerrequisitos).toHaveLength(GUARDADO_DE_EJEMPLO.prerrequisitos.length);
  });

  it("es exactamente lo que da mi_diagnostico(id) de HU-009: la función solo elige el id", async () => {
    expect(await leerMiUltimoDiagnostico(duena.cliente)).toEqual(await leerMiDiagnostico(duena.cliente, ganador));
  });

  it("la fila de PostgREST trae exactamente las 8 columnas y nada que la pantalla no pinte", async () => {
    const { data, error } = await duena.cliente.rpc("mi_ultimo_diagnostico");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const { data: delGanador } = await duena.cliente.rpc("mi_diagnostico", { p_id: ganador });
    expect(data![0]).toEqual(delGanador![0]);
    expect(Object.keys(data![0]).sort()).toEqual([
      "aciertos",
      "codigo_materia",
      "fecha_realizacion",
      "id_diagnostico",
      "nombre_evaluacion",
      "nombre_materia",
      "respondidas",
      "resultado",
    ]);
    expect(data![0]).toMatchObject({ id_diagnostico: ganador, codigo_materia: materiaB.codigo, nombre_materia: materiaB.nombre, nombre_evaluacion: evaluacionB.nombre });
    expect(data![0].resultado).toEqual(GUARDADO_DE_EJEMPLO);

    // Ni la semilla, ni el repetido, ni la marca de falta de material, ni las copias de las preguntas, ni el token de recuperación.
    // (`respuestas` no va en la lista: el resultado guarda cuántas respondió cada habilidad con esa palabra.)
    const { rows } = await bd.query<{ token_recuperacion: string }>("select token_recuperacion from public.diagnostico where id = $1", [ganador]);
    const texto = JSON.stringify(data);
    for (const prohibido of [
      rows[0].token_recuperacion,
      String(SEMILLA_CENTINELA),
      ...centinelasDeLasRespuestas(8),
      "repetido",
      "semilla",
      "falta_material",
      "token_recuperacion",
      "tope_una_respuesta",
    ]) {
      expect(texto.includes(prohibido), `llegó a la fila: ${prohibido}`).toBe(false);
    }
  });

  it("la proyección que ve la portada solo trae claves de CLAVES_DEL_RESULTADO ni claves internas", async () => {
    const ultimo = await leerMiUltimoDiagnostico(duena.cliente);
    expect(clavesDe(ultimo).filter((clave) => !CLAVES_DEL_RESULTADO.includes(clave))).toEqual([]);
    const texto = JSON.stringify(ultimo);
    for (const prohibido of [...CLAVES_INTERNAS_DE_EJEMPLO, ...centinelasDeLasRespuestas(8), "repetido", "faltaMaterial", "semilla"]) {
      expect(texto.includes(prohibido), `llegó a lo que ve la persona: ${prohibido}`).toBe(false);
    }
  });

  it("con dos diagnósticos de la misma fecha exacta, gana el de id mayor aunque el menor se insertó primero", async () => {
    const ultimo = await leerMiUltimoDiagnostico(empate.cliente);
    expect(ultimo?.idDiagnostico).toBe(idDe("ff"));
    expect(ultimo?.materia.codigo).toBe(materiaB.codigo);
  });

  it("otra sesión recibe el suyo, no el de la dueña", async () => {
    expect((await leerMiUltimoDiagnostico(otra.cliente))?.idDiagnostico).toBe(idDe("c2"));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-2: D-53 e
// ---------------------------------------------------------------------------------------------------------------

describe("D-53 e: ni las demás sesiones del Lead ni la que lo creó reciben lo que hizo otro navegador", () => {
  it("la ligada por lead_sesion y la creadora reciben null, y la tabla tampoco les deja leer la fila", async () => {
    // Desde HU-095 (D-53 e) la política de `diagnostico` tampoco les deja leer el diagnóstico ganador, que es del Lead pero lo
    // hizo otra sesión: la función y la tabla dicen lo mismo para ellas.
    expect(await filasVisibles(ligada.cliente, ganador), "la ligada no ve la fila de la tabla").toBe(0);
    expect(await filasVisibles(creadora.cliente, ganador), "la creadora no ve la fila de la tabla").toBe(0);
    expect(await filasVisibles(otra.cliente, ganador), "otra sesión sin relación, no").toBe(0);

    expect(await leerMiUltimoDiagnostico(ligada.cliente), "la sesión ligada por lead_sesion").toBeNull();
    expect(await leerMiUltimoDiagnostico(creadora.cliente), "la sesión que creó el Lead").toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-3: la cuenta de Estudiante
// ---------------------------------------------------------------------------------------------------------------

describe("la cuenta de Estudiante del Lead que es otro usuario que la sesión", () => {
  it("recibe null en la portada y sí el resultado con mi_diagnostico(id) de HU-009 (D-55 c)", async () => {
    expect(await leerMiUltimoDiagnostico(estudianteDelLead), "la portada es por sesión").toBeNull();
    // La diferencia entre las dos funciones queda escrita: `mi_diagnostico` suma la cuenta de Estudiante del Lead; la portada no.
    expect(await leerMiDiagnostico(estudianteDelLead, ganador), "el resultado por id").toMatchObject({ idDiagnostico: ganador });
  });
});

describe("la cuenta de Estudiante que nació de convertir la sesión que hizo el diagnóstico (HU-032)", () => {
  it("conserva el id: la portada le da el suyo, en el mismo navegador y en otro, y no el más reciente de su Lead", async () => {
    const sesion = await fx!.crearAnonimo();
    const otraDelLead = await fx!.crearAnonimo();
    const leadDeLaSesion = await fx!.crearLeadDeSesion(sesion.id);
    exito(await fx!.admin.from("lead_sesion").insert({ id_sesion: otraDelLead.id, id_lead: leadDeLaSesion.id }).select().single(), "ligar la otra sesión al Lead");
    const propio = idDe("f3");
    const delOtroNavegador = idDe("f4");
    await sembrarDiagnostico(bd, {
      id: propio,
      idSesionAnonima: sesion.id,
      idLead: leadDeLaSesion.id,
      idEvaluacion: evaluacionA.id,
      fecha: "2026-10-03T08:00:00.000Z",
      claves: ["P1", "P2", "P3"],
      aciertos: 2,
    });
    // El más reciente del Lead lo hizo otra sesión suya (el enlace de P-23): la cuenta no puede recibirlo.
    await sembrarDiagnostico(bd, {
      id: delOtroNavegador,
      idSesionAnonima: otraDelLead.id,
      idLead: leadDeLaSesion.id,
      idEvaluacion: evaluacionB.id,
      fecha: "2026-10-07T08:00:00.000Z",
      claves: ["P1", "P2", "P3", "P4"],
      aciertos: 3,
    });

    expect(await rolDe(sesion.cliente), "antes de convertir").toBe("anonimo");
    expect((await leerMiUltimoDiagnostico(sesion.cliente))?.idDiagnostico, "la sesión anónima recibe el suyo").toBe(propio);

    // Como al registrarse: la sesión se vuelve cuenta con el mismo id y su fila de Estudiante apunta al Lead.
    exito(await fx!.admin.from("estudiante").insert({ id: sesion.id, id_lead: leadDeLaSesion.id }).select().single(), "insertar la cuenta de Estudiante");
    const correo = `prueba-${randomUUID()}@calibra.test`;
    const contrasena = `Clave-${randomUUID()}`;
    // Como al crear la cuenta (HU-032): la sesión pide el correo, lo confirma con el enlace y elige su contraseña. El navegador que
    // confirma es el que queda dentro de la cuenta, con el mismo id.
    expect(await vincularCorreo(sesion.cliente, correo)).toEqual({ ok: true });
    const navegador = crearCliente();
    const confirmado = await navegador.auth.verifyOtp({ type: "email_change", token_hash: await tokenDelCorreoDeCuenta(correo) });
    expect(confirmado.error, "confirmar el correo con el enlace").toBeNull();
    expect(confirmado.data.user?.id, "el mismo usuario, ya no anónimo").toBe(sesion.id);
    expect(await ponerContrasena(navegador, contrasena)).toEqual({ ok: true });

    expect(await rolDe(navegador), "ya es Estudiante: es el rol que la portada deja pasar a la base").toBe("estudiante");
    const enElMismoNavegador = await leerMiUltimoDiagnostico(navegador);
    expect(enElMismoNavegador?.idDiagnostico, "el mismo navegador, ya convertida").toBe(propio);

    // Otro navegador: inicia sesión con el correo y la contraseña y es el mismo usuario.
    const otroNavegador = await iniciarSesionConClave(correo, contrasena);
    expect(await rolDe(otroNavegador)).toBe("estudiante");
    const enOtroNavegador = await leerMiUltimoDiagnostico(otroNavegador);
    expect(enOtroNavegador?.idDiagnostico, "otro navegador con la misma cuenta").toBe(propio);
    expect(enOtroNavegador).toEqual(enElMismoNavegador);
    expect(enOtroNavegador, "es lo que da mi_diagnostico para ese id").toEqual(await leerMiDiagnostico(otroNavegador, propio));

    // La tabla le deja leer los dos del Lead, y la otra sesión del Lead recibe el suyo, no el de la cuenta.
    expect(await filasVisibles(otroNavegador, delOtroNavegador), "la cuenta ve en la tabla el de la otra sesión").toBe(1);
    expect((await leerMiUltimoDiagnostico(otraDelLead.cliente))?.idDiagnostico).toBe(delOtroNavegador);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-4: el equipo
// ---------------------------------------------------------------------------------------------------------------

describe("un monitor y un admin con una fila a su nombre", () => {
  it("reciben null (el rol real dentro del security definer), aunque el admin lee su fila con un select", async () => {
    expect(await filasVisibles(admin.cliente, idDe("e6")), "la política deja leer al admin").toBe(1);
    expect(await leerMiUltimoDiagnostico(monitor.cliente), "monitor con una fila propia").toBeNull();
    expect(await leerMiUltimoDiagnostico(admin.cliente), "admin con una fila propia").toBeNull();
    // También por la de HU-009: el rol se descarta ahí.
    expect(await leerMiDiagnostico(monitor.cliente, idDe("e7"))).toBeNull();
    expect(await leerMiDiagnostico(admin.cliente, idDe("e6"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-5: sin sesión y la llave secreta
// ---------------------------------------------------------------------------------------------------------------

describe("quien no tiene sesión de usuario", () => {
  it("sin sesión la base niega ejecutarla (42501) y la lectura lanza con solo el código", async () => {
    const error = await leerMiUltimoDiagnostico(crearCliente()).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/código 42501/);
    // Sin contenido: ni el nombre de una materia, ni la semilla, ni un id.
    expect((error as Error).message).not.toContain(materiaB.nombre);
    expect((error as Error).message).not.toContain(ganador);
  });

  it("la llave secreta tampoco la ejecuta (no tiene grant): la portada no podría usarla", async () => {
    await expect(leerMiUltimoDiagnostico(crearClienteAdmin())).rejects.toThrow(/código 42501/);
  });
});
