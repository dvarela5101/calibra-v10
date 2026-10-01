import { randomInt, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enviarSolicitud, type EstadoSolicitud } from "@/app/quiero-ser-monitor/acciones";
import { cambiarEstadoDeSolicitud, listarSolicitudes, paginaDeLaPrimeraAbierta } from "@/lib/solicitudes/admin";
import { CAMPO_MATERIAS, CAMPO_TRAMPA, ERROR_SIN_AUTORIZACION_ASPIRANTE } from "@/lib/solicitudes/reglas";
import { crearSolicitudMonitor } from "@/lib/solicitudes/servidor";
import { exigirSupabaseLocal, Fixtures } from "./utilidades";

// HU-062 contra el Supabase LOCAL: la solicitud del aspirante a monitor se guarda entera o no se guarda, y
// solo los admins la leen y le cambian el estado. Cada prueba crea sus materias, correos y cuentas y los borra.
// Los teléfonos son al azar: una solicitud abierta con el mismo teléfono haría que la base devolviera esa.

let fx: Fixtures;
const correos: string[] = [];
const materias: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  // Las solicitudes antes que las materias: sus materias tienen llave foránea a materia.
  if (correos.length) await fx.admin.from("solicitud_monitor").delete().in("correo", correos.splice(0));
  if (materias.length) await fx.admin.from("materia").delete().in("id", materias.splice(0));
  await fx.limpiar();
});

async function materia(nombre = `Materia HU-062 ${randomUUID().slice(0, 6)}`): Promise<{ id: string; nombre: string }> {
  const { data, error } = await fx.admin.from("materia").insert({ nombre, codigo: `HU062-${randomUUID().slice(0, 12)}` }).select("id, nombre").single();
  if (error) throw new Error(`crear materia: ${error.message}`);
  materias.push(data.id);
  return data;
}

function correoNuevo(): string {
  const correo = `aspirante-${randomUUID()}@calibra.test`;
  correos.push(correo);
  return correo;
}

/** Un celular colombiano al azar: como lo escribe la persona y como lo guarda la base. */
function telefonoNuevo(): { escrito: string; guardado: string } {
  const cifras = `3${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  return { escrito: `${cifras.slice(0, 3)} ${cifras.slice(3, 6)} ${cifras.slice(6)}`, guardado: `+57${cifras}` };
}

async function solicitudesDe(correo: string) {
  const { data, error } = await fx.admin
    .from("solicitud_monitor")
    .select("id, nombre, correo, numero_telefono, estado, acepta_tratamiento_datos, fecha_consentimiento, solicitud_monitor_materia(id_materia)")
    .eq("correo", correo);
  expect(error).toBeNull();
  return data ?? [];
}

async function crear(correo: string, idsMaterias: string[], nombre = correo) {
  const r = await crearSolicitudMonitor({ nombre, correo, numeroTelefono: telefonoNuevo().guardado, materias: idsMaterias }, new Date().toISOString(), fx.admin);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

function formulario(campos: Record<string, string | string[]>): FormData {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) for (const v of Array.isArray(valor) ? valor : [valor]) datos.append(nombre, v);
  return datos;
}

const INICIAL: EstadoSolicitud = {
  error: null,
  enviada: false,
  valores: { nombre: "", correo: "", numero_telefono: "", materias: [], autorizado: false },
};

describe("criterios 1 y 3: el aspirante deja sus datos y la solicitud queda nueva", () => {
  it("con nombre, teléfono, correo, dos materias y la autorización, queda guardada con su fecha", async () => {
    const [calculo, fisica] = [await materia(), await materia()];
    const correo = correoNuevo();
    const telefono = telefonoNuevo();
    const antes = Date.now();

    const estado = await enviarSolicitud(
      INICIAL,
      formulario({
        nombre: "Ana Aspirante",
        correo: correo.toUpperCase(),
        numero_telefono: telefono.escrito,
        [CAMPO_MATERIAS]: [calculo.id, fisica.id],
        acepta_tratamiento_datos: "si",
      }),
    );

    expect(estado).toMatchObject({ error: null, enviada: true });
    const [guardada, ...otras] = await solicitudesDe(correo);
    expect(otras).toEqual([]);
    expect(guardada).toMatchObject({
      nombre: "Ana Aspirante",
      correo,
      numero_telefono: telefono.guardado,
      estado: "nueva",
      acepta_tratamiento_datos: true,
    });
    expect(guardada.solicitud_monitor_materia.map((m) => m.id_materia).sort()).toEqual([calculo.id, fisica.id].sort());
    const fecha = new Date(guardada.fecha_consentimiento).getTime();
    expect(fecha).toBeGreaterThanOrEqual(antes - 1000);
    expect(fecha).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("si la envía dos veces, queda una sola y las dos veces ve que la recibimos", async () => {
    const calculo = await materia();
    const correo = correoNuevo();
    const campos = {
      nombre: "Ana Dos Veces",
      correo,
      numero_telefono: telefonoNuevo().escrito,
      [CAMPO_MATERIAS]: [calculo.id],
      acepta_tratamiento_datos: "si",
    };

    expect(await enviarSolicitud(INICIAL, formulario(campos))).toMatchObject({ error: null, enviada: true });
    expect(await enviarSolicitud(INICIAL, formulario(campos))).toMatchObject({ error: null, enviada: true });

    expect(await solicitudesDe(correo)).toHaveLength(1);
  });
});

describe("criterio 2: con un dato que falta o no sirve, no se guarda nada", () => {
  it.each([
    ["sin autorización de datos", {}, ERROR_SIN_AUTORIZACION_ASPIRANTE],
    ["sin nombre", { nombre: "" }, "Escribe tu nombre."],
    ["con un correo inválido", { correo: "no-es-correo" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["con parámetros de mailto en el correo", { correo: "ana@calibra.test?bcc=otro@calibra.test" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["sin teléfono", { numero_telefono: "" }, "Escribe tu teléfono: lo necesitamos para agendar tu evaluación."],
    ["sin materias", { [CAMPO_MATERIAS]: [] }, "Elige al menos una materia."],
  ])("%s", async (_nombre, cambio, error) => {
    const calculo = await materia();
    const correo = correoNuevo();
    const campos: Record<string, string | string[]> = {
      nombre: "Beto Aspirante",
      correo,
      numero_telefono: telefonoNuevo().escrito,
      [CAMPO_MATERIAS]: [calculo.id],
      ...(cambio as Record<string, string | string[]>),
    };
    // La autorización solo va cuando el caso no es justamente su falta.
    const autorizo = error !== ERROR_SIN_AUTORIZACION_ASPIRANTE;
    if (autorizo) campos.acepta_tratamiento_datos = "si";

    const estado = await enviarSolicitud(INICIAL, formulario(campos));

    expect(estado.enviada).toBe(false);
    expect(estado.error).toBe(error);
    // Devuelve lo escrito para no vaciar el formulario, con la autorización como estaba.
    expect(estado.valores.nombre).toBe(String(campos.nombre));
    expect(estado.valores.autorizado).toBe(autorizo);
    if (correo === campos.correo) expect(await solicitudesDe(correo)).toEqual([]);
  });

  it("con una materia que no existe (la borraron mientras llenaba el formulario), no queda ni la solicitud", async () => {
    const calculo = await materia();
    const correo = correoNuevo();
    const resultado = await crearSolicitudMonitor(
      { nombre: "Carla", correo, numeroTelefono: telefonoNuevo().guardado, materias: [calculo.id, randomUUID()] },
      new Date().toISOString(),
      fx.admin,
    );
    expect(resultado).toEqual({ ok: false, error: "Alguna materia ya no está disponible. Recarga la página y elige de nuevo." });
    expect(await solicitudesDe(correo)).toEqual([]);
  });

  it("con la sesión de una persona no se puede crear una solicitud: solo el servidor", async () => {
    const calculo = await materia();
    const { cliente } = await fx.crearAnonimo();
    const correo = correoNuevo();
    const telefono = telefonoNuevo().guardado;
    const resultado = await crearSolicitudMonitor(
      { nombre: "Dani", correo, numeroTelefono: telefono, materias: [calculo.id] },
      new Date().toISOString(),
      cliente,
    );
    expect(resultado.ok).toBe(false);
    const directo = await cliente.from("solicitud_monitor").insert({
      nombre: "Dani",
      correo,
      numero_telefono: telefono,
      acepta_tratamiento_datos: true,
      fecha_consentimiento: new Date().toISOString(),
    });
    expect(directo.error).not.toBeNull();
    expect(await solicitudesDe(correo)).toEqual([]);
  });
});

describe("envíos masivos", () => {
  it("si un programa llena el campo trampa, ve la misma respuesta que una persona y no se guarda nada", async () => {
    const calculo = await materia();
    const correo = correoNuevo();

    const estado = await enviarSolicitud(
      INICIAL,
      formulario({
        nombre: "Robot",
        correo,
        numero_telefono: telefonoNuevo().escrito,
        [CAMPO_MATERIAS]: [calculo.id],
        acepta_tratamiento_datos: "si",
        [CAMPO_TRAMPA]: "https://spam.example",
      }),
    );

    expect(estado).toMatchObject({ error: null, enviada: true });
    expect(await solicitudesDe(correo)).toEqual([]);
  });

  it("con 30 solicitudes en la última hora, la siguiente no se guarda y la persona sabe cuándo volver", async () => {
    const calculo = await materia();
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await fx.admin.from("solicitud_monitor").select("id", { count: "exact", head: true }).gt("creada_en", haceUnaHora);
    expect(error).toBeNull();
    const faltan = Math.max(0, 30 - (count ?? 0));
    if (faltan) {
      const relleno = Array.from({ length: faltan }, (_, i) => ({
        nombre: `Relleno ${i}`,
        correo: correoNuevo(),
        numero_telefono: telefonoNuevo().guardado,
        acepta_tratamiento_datos: true,
        fecha_consentimiento: new Date().toISOString(),
      }));
      const { error: errorRelleno } = await fx.admin.from("solicitud_monitor").insert(relleno);
      expect(errorRelleno).toBeNull();
    }
    const correo = correoNuevo();

    const estado = await enviarSolicitud(
      INICIAL,
      formulario({ nombre: "Tarde", correo, numero_telefono: telefonoNuevo().escrito, [CAMPO_MATERIAS]: [calculo.id], acepta_tratamiento_datos: "si" }),
    );

    expect(estado).toMatchObject({ enviada: false, error: "Recibimos muchas solicitudes en este momento. Intenta de nuevo en una hora." });
    expect(await solicitudesDe(correo)).toEqual([]);
  });
});

describe("criterio 4: el admin las ve de la más antigua a la más nueva y les cambia el estado", () => {
  async function dosSolicitudes() {
    const calculo = await materia(`Cálculo ${randomUUID().slice(0, 4)}`);
    const algebra = await materia(`Álgebra ${randomUUID().slice(0, 4)}`);
    const nueva = correoNuevo();
    const vieja = correoNuevo();
    await crear(nueva, [calculo.id]);
    await crear(vieja, [calculo.id, algebra.id]);
    // La "vieja" se creó después, pero lleva una fecha anterior: el orden sale de la fecha, no del orden de inserción.
    await fx.admin.from("solicitud_monitor").update({ creada_en: "2020-01-01T00:00:00Z" }).eq("correo", vieja);
    return { nueva, vieja, calculo, algebra };
  }

  it("las lista de la más antigua a la más nueva, con sus materias, esté abierta o cerrada", async () => {
    const { nueva, vieja, calculo, algebra } = await dosSolicitudes();
    // Una cerrada, más antigua que las dos: va primero, porque el orden no depende del estado.
    const cerrada = correoNuevo();
    await crear(cerrada, [calculo.id]);
    await fx.admin.from("solicitud_monitor").update({ creada_en: "2019-01-01T00:00:00Z", estado: "descartada" }).eq("correo", cerrada);
    const admin = await fx.iniciarSesion(await fx.crearAdmin());

    const todas = [];
    for (let pagina = 1; ; pagina++) {
      const resultado = await listarSolicitudes(admin, { pagina, porPagina: 1000 });
      todas.push(...resultado.solicitudes);
      if (todas.length >= resultado.total) break;
    }
    const propias = todas.filter((s) => [nueva, vieja, cerrada].includes(s.correo));

    expect(propias.map((s) => s.correo)).toEqual([cerrada, vieja, nueva]);
    expect(propias[1].materias).toEqual([algebra.nombre, calculo.nombre].sort((a, b) => a.localeCompare(b, "es")));
    expect(propias.map((s) => s.estado)).toEqual(["descartada", "nueva", "nueva"]);
    // Toda la lista, no solo las de esta prueba, va por fecha (y por id en un empate).
    const clave = todas.map((s) => [s.creadaEn.getTime(), s.id] as const);
    expect(clave).toEqual([...clave].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
    // Y dice cuántas siguen abiertas en todas las páginas.
    const { count } = await fx.admin.from("solicitud_monitor").select("id", { count: "exact", head: true }).in("estado", ["nueva", "contactada"]);
    expect((await listarSolicitudes(admin)).abiertas).toBe(count);
  });

  it("abre en la página de la abierta más antigua, aunque otras tengan su misma fecha", async () => {
    // Tres cerradas y la abierta con la misma fecha, más antigua que cualquier otra. Las cerradas tienen ids
    // menores, así que van antes que ella: sin contar el empate, la página saldría corrida.
    const fecha = "1985-01-01T00:00:00Z";
    const sufijo = randomUUID().slice(-12);
    const filas = [
      ...["0", "1", "2"].map((n) => ({ id: `0000000${n}-0000-4000-8000-${sufijo}`, estado: "descartada" as const })),
      { id: `ffffffff-ffff-4fff-bfff-${sufijo}`, estado: "nueva" as const },
    ].map((f, i) => ({
      ...f,
      nombre: `Empate ${i}`,
      correo: correoNuevo(),
      numero_telefono: telefonoNuevo().guardado,
      acepta_tratamiento_datos: true,
      fecha_consentimiento: fecha,
      creada_en: fecha,
    }));
    const { error } = await fx.admin.from("solicitud_monitor").insert(filas);
    expect(error).toBeNull();
    const admin = await fx.iniciarSesion(await fx.crearAdmin());

    for (const porPagina of [1, 2, 3, 50]) {
      const pagina = await paginaDeLaPrimeraAbierta(admin, porPagina);
      const ids = (await listarSolicitudes(admin, { pagina, porPagina })).solicitudes.map((s) => s.id);
      expect(ids, `de a ${porPagina}`).toContain(filas[3].id);
    }
    expect(await paginaDeLaPrimeraAbierta(admin, 1)).toBe(4);
  });

  it("va por páginas: cada página sigue a la anterior, y una después de la última viene vacía con el total", async () => {
    const calculo = await materia();
    const tres = [correoNuevo(), correoNuevo(), correoNuevo()];
    for (const [i, correo] of tres.entries()) {
      await crear(correo, [calculo.id]);
      // Las más antiguas de todas las abiertas: ocupan las tres primeras posiciones.
      await fx.admin.from("solicitud_monitor").update({ creada_en: `1990-01-0${i + 1}T00:00:00Z` }).eq("correo", correo);
    }
    const admin = await fx.iniciarSesion(await fx.crearAdmin());

    const paginas = [];
    for (const pagina of [1, 2, 3]) paginas.push(await listarSolicitudes(admin, { pagina, porPagina: 1 }));

    expect(paginas.map((p) => p.solicitudes.map((s) => s.correo))).toEqual(tres.map((c) => [c]));
    const total = paginas[0].total;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(paginas.map((p) => p.total)).toEqual([total, total, total]);

    // Justo después de la última la API responde vacío; más allá responde 416 (PGRST103). Las dos van vacías.
    for (const pagina of [total + 1, total + 5]) {
      expect(await listarSolicitudes(admin, { pagina, porPagina: 1 }), `página ${pagina}`).toEqual({
        solicitudes: [],
        total,
        abiertas: expect.any(Number),
        pagina,
        porPagina: 1,
      });
    }
  });

  it("la marca contactada, evaluada o descartada a su nombre, y la fecha del cambio la pone la base", async () => {
    const { nueva } = await dosSolicitudes();
    const cuenta = await fx.crearAdmin();
    const admin = await fx.iniciarSesion(cuenta);
    const [{ id }] = await solicitudesDe(nueva);
    const fechaDelCambio = async () => {
      const { data } = await fx.admin.from("solicitud_monitor").select("estado, id_admin_actualizo, actualizada_en").eq("id", id).single();
      return data!;
    };
    let anterior = new Date((await fechaDelCambio()).actualizada_en).getTime();

    for (const estado of ["contactada", "evaluada", "descartada"] as const) {
      expect(await cambiarEstadoDeSolicitud(admin, { idSolicitud: id, estado, idAdmin: cuenta.id })).toEqual({ ok: true });
      const data = await fechaDelCambio();
      expect(data).toMatchObject({ estado, id_admin_actualizo: cuenta.id });
      // Cada cambio la mueve hacia adelante.
      const ahora = new Date(data.actualizada_en).getTime();
      expect(ahora, estado).toBeGreaterThan(anterior);
      anterior = ahora;
    }
  });

  it("no puede dejar el cambio a nombre de otro admin", async () => {
    const { nueva } = await dosSolicitudes();
    const cuenta = await fx.crearAdmin();
    const otro = await fx.crearAdmin();
    const admin = await fx.iniciarSesion(cuenta);
    const [{ id }] = await solicitudesDe(nueva);
    expect((await cambiarEstadoDeSolicitud(admin, { idSolicitud: id, estado: "contactada", idAdmin: otro.id })).ok).toBe(false);
    expect((await solicitudesDe(nueva))[0].estado).toBe("nueva");
  });
});

describe("criterio 5: nadie que no sea admin lee ni cambia una solicitud", () => {
  it("un monitor, un visitante con sesión anónima y un admin desactivado no ven ninguna ni cambian ninguna", async () => {
    const calculo = await materia();
    const correo = correoNuevo();
    const id = await crear(correo, [calculo.id], "Eva");

    const monitor = await fx.crearMonitor();
    const sesiones = [
      ["monitor", await fx.iniciarSesion(monitor), monitor.id],
      ["visitante", (await fx.crearAnonimo()).cliente, null],
    ] as const;
    for (const [quien, cliente, idQuien] of sesiones) {
      expect(await listarSolicitudes(cliente), quien).toMatchObject({ solicitudes: [], total: 0 });
      const cambio = await cambiarEstadoDeSolicitud(cliente, { idSolicitud: id, estado: "descartada", idAdmin: idQuien ?? id });
      expect(cambio.ok, quien).toBe(false);
    }

    const admin = await fx.crearAdmin();
    const sesionAdmin = await fx.iniciarSesion(admin);
    const laVe = async () => (await listarSolicitudes(sesionAdmin, { porPagina: 1000 })).solicitudes.some((s) => s.id === id);
    expect(await laVe()).toBe(true);
    const { error } = await fx.admin.auth.admin.updateUserById(admin.id, { ban_duration: "876000h" });
    expect(error).toBeNull();
    expect(await laVe(), "admin desactivado (RN-23)").toBe(false);

    expect((await solicitudesDe(correo))[0].estado).toBe("nueva");
  });
});
