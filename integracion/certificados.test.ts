import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desactivarCuenta, reactivarCuenta } from "@/lib/auth/cuentas";
import { diaDelNegocio } from "@/lib/fechas";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, rolDe, type Cliente, type UsuarioPrueba } from "./utilidades";

// HU-014 contra el Supabase LOCAL: el admin certifica a un monitor por materia con su sesión real (rol
// `authenticated`), que es la que pasa por los permisos por columna y por la política "admin certifica".
// Las cuentas y las materias las crea el cliente de confianza (llave secreta). Cada prueba borra lo suyo.

type Actor = { usuario: UsuarioPrueba; cliente: Cliente };

let fx: Fixtures;
let franjas: string[];

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
  franjas = [];
});

afterEach(async () => {
  // Las franjas que abre el monitor con su sesión no las conoce Fixtures: se borran antes que su cuenta.
  try {
    if (franjas.length) exito(await fx.admin.from("franja").delete().in("id", franjas).select("id"), "borrar franjas de prueba");
  } finally {
    await fx.limpiar();
  }
});

// ---------------------------------------------------------------------------
// Fechas: siempre en la zona del negocio (America/Bogota), nunca en la del servidor.
// ---------------------------------------------------------------------------
const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
/** Un admin con su sesión abierta. Si la prueba lo desactiva, la sesión sigue teniendo token vigente. */
async function adminConSesion(): Promise<Actor> {
  const usuario = await fx.crearAdmin();
  return { usuario, cliente: await fx.iniciarSesion(usuario) };
}

async function monitorConSesion(): Promise<Actor> {
  const usuario = await fx.crearMonitor();
  return { usuario, cliente: await fx.iniciarSesion(usuario) };
}

/** Una materia de prueba (con su código único); `limpiar()` la borra. */
async function materiaNueva() {
  return (await fx.crearEvaluacion()).materia;
}

type Pedido = { idMonitor: string; idMateria: string; fechaEvaluacion?: string };

/**
 * Lo que hace la acción del admin: inserta con su sesión, a su nombre, con la fecha de la evaluación, y lee de
 * vuelta el certificado. Sin fecha, la evaluación es hoy (el día de la emisión).
 */
function certificar(admin: Actor, pedido: Pedido) {
  return admin.cliente
    .from("certificado")
    .insert({
      id_monitor: pedido.idMonitor,
      id_materia: pedido.idMateria,
      id_admin: admin.usuario.id,
      fecha_evaluacion: pedido.fechaEvaluacion ?? hoy(),
    })
    .select()
    .single();
}

async function certificadosDe(idMonitor: string) {
  return exito(await fx.admin.from("certificado").select("*").eq("id_monitor", idMonitor).order("id_materia"), "leer certificados");
}

async function certificadoEnLaBase(id: string) {
  return exito(await fx.admin.from("certificado").select("*").eq("id", id).single(), "leer certificado");
}

/** Lo que el monitor manda para abrir una franja presencial cualquiera. */
const franjaDe = (idMonitor: string) => ({
  id_monitor: idMonitor,
  dia: 2,
  hora: "10:00",
  presencial: true,
  precio: 25_000,
  duracion_min: 60,
  lugar: "Edificio ML, salón 101",
});

// ---------------------------------------------------------------------------
// Criterio 1: el admin certifica
// ---------------------------------------------------------------------------
describe("criterio 1: el admin certifica a un monitor en una materia", () => {
  it("crea el certificado con el admin, hoy como fecha de emisión y la fecha de la evaluación, sin vencimiento", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const evaluacion = sumarDias(hoy(), -3);

    const antes = hoy();
    const { data: certificado, error } = await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: evaluacion });
    const despues = hoy();

    expect(error).toBeNull();
    expect(certificado).toMatchObject({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.usuario.id, fecha_evaluacion: evaluacion });
    // La fecha de emisión la pone la base: hoy en Bogotá (se acepta el día de al lado solo si la prueba cruzó la medianoche).
    expect([antes, despues]).toContain(certificado!.fecha_emision);
    expect(evaluacion < certificado!.fecha_emision).toBe(true);
    // Sin vencimiento (RN-21): ninguna columna dice cuándo caduca.
    expect(Object.keys(certificado!).filter((columna) => /venc|expir|caduc/i.test(columna))).toEqual([]);

    // Es lo que quedó guardado.
    expect(await certificadosDe(monitor.id)).toEqual([certificado]);
  });

  it("la acción lee de vuelta el nombre del monitor y el de la materia con la misma sesión del admin", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    // Los monitores de prueba se llaman igual: se le da un nombre propio para reconocerlo en la respuesta.
    const nombreDelMonitor = `Camila ${randomUUID().slice(0, 8)}`;
    exito(await fx.admin.from("monitor").update({ nombre: nombreDelMonitor }).eq("id", monitor.id).select("id").single(), "renombrar al monitor");

    // La misma consulta que acciones.ts arma para el mensaje "<monitor> quedó certificado en <materia>".
    const { data, error } = await admin.cliente
      .from("certificado")
      .insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.usuario.id, fecha_evaluacion: hoy() })
      .select("monitor(nombre), materia(nombre)")
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({ monitor: { nombre: nombreDelMonitor }, materia: { nombre: materia.nombre } });
  });

  it("varias materias por monitor, y una misma materia para varios monitores", async () => {
    const admin = await adminConSesion();
    const uno = await fx.crearMonitor();
    const otro = await fx.crearMonitor();
    const [calculo, fisica] = [await materiaNueva(), await materiaNueva()];

    const c1 = exito(await certificar(admin, { idMonitor: uno.id, idMateria: calculo.id }), "uno en cálculo");
    const c2 = exito(await certificar(admin, { idMonitor: uno.id, idMateria: fisica.id }), "uno en física");
    const c3 = exito(await certificar(admin, { idMonitor: otro.id, idMateria: calculo.id }), "otro en cálculo");

    expect((await certificadosDe(uno.id)).map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(await certificadosDe(otro.id)).toEqual([c3]);
  });

  it("un monitor sin certificado no abre franjas y en cuanto un admin lo certifica, sí (F2)", async () => {
    const admin = await adminConSesion();
    const monitor = await monitorConSesion();
    const materia = await materiaNueva();

    const antes = await monitor.cliente.from("franja").insert(franjaDe(monitor.usuario.id));
    expect(antes.error?.code).toBe("P0001");
    expect(antes.error?.message).toContain("necesitas al menos un certificado");

    exito(await certificar(admin, { idMonitor: monitor.usuario.id, idMateria: materia.id }), "certificar");

    const despues = await monitor.cliente.from("franja").insert(franjaDe(monitor.usuario.id)).select("id").single();
    expect(despues.error).toBeNull();
    franjas.push(despues.data!.id);
  });
});

// ---------------------------------------------------------------------------
// Criterio 2: una sola vez por monitor y materia (RN-21)
// ---------------------------------------------------------------------------
describe("criterio 2 (RN-21): un monitor no se certifica dos veces en la misma materia", () => {
  it("certificarlo de nuevo falla con 23505 y deja el primer certificado como estaba", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const primero = exito(await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), -5) }), "primero");

    const repetido = await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), -1) });

    expect(repetido.error).toMatchObject({ code: "23505" });
    expect(await certificadosDe(monitor.id)).toEqual([primero]);
  });

  it("la restricción es por pareja, no por admin: otro admin activo tampoco puede repetirla", async () => {
    const uno = await adminConSesion();
    const otro = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const primero = exito(await certificar(uno, { idMonitor: monitor.id, idMateria: materia.id }), "primero");

    const repetido = await certificar(otro, { idMonitor: monitor.id, idMateria: materia.id });

    expect(repetido.error).toMatchObject({ code: "23505" });
    expect(await certificadosDe(monitor.id)).toEqual([primero]);
  });
});

// ---------------------------------------------------------------------------
// Lo que la base no deja escribir
// ---------------------------------------------------------------------------
describe("lo que el admin no puede escribir", () => {
  it("una evaluación posterior a hoy se rechaza con 23514; la de hoy sí se acepta", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const [materia, otraMateria] = [await materiaNueva(), await materiaNueva()];

    const futura = await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), 1) });
    expect(futura.error).toMatchObject({ code: "23514" });
    expect(await certificadosDe(monitor.id)).toEqual([]);

    const deHoy = await certificar(admin, { idMonitor: monitor.id, idMateria: otraMateria.id, fechaEvaluacion: hoy() });
    expect(deHoy.error).toBeNull();
    expect(deHoy.data!.fecha_evaluacion).toBe(deHoy.data!.fecha_emision);
  });

  it("un admin no certifica a nombre de otro admin (42501)", async () => {
    const admin = await adminConSesion();
    const otroAdmin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();

    const { error } = await admin.cliente
      .from("certificado")
      .insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: otroAdmin.id, fecha_evaluacion: hoy() });

    expect(error).toMatchObject({ code: "42501" });
    expect(await certificadosDe(monitor.id)).toEqual([]);

    // Control: era el nombre de otro, no el pedido. A su propio nombre, el mismo pedido pasa.
    const propio = exito(await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id }), "certificar a su nombre");
    expect(propio.id_admin).toBe(admin.usuario.id);
  });

  it.each([
    ["fecha_emision", () => ({ fecha_emision: sumarDias(hoy(), -30) })],
    ["id", () => ({ id: randomUUID() })],
  ] as const)("la columna %s no la escribe el admin: la pone la base (42501)", async (_columna, extra) => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const forzado = extra();

    const { error } = await admin.cliente
      .from("certificado")
      .insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.usuario.id, fecha_evaluacion: hoy(), ...forzado });

    expect(error).toMatchObject({ code: "42501" });
    expect(await certificadosDe(monitor.id)).toEqual([]);

    // Control: era esa columna, no el pedido. Sin ella, el mismo pedido pasa y la base pone su propio valor.
    const sinLaColumna = exito(await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id }), "certificar sin la columna");
    expect(sinLaColumna).not.toMatchObject(forzado);
  });

  it("un monitor o una materia que no existen se rechazan con 23503; un admin tampoco cuenta como monitor", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();

    for (const [caso, pedido] of [
      ["monitor inexistente", { idMonitor: randomUUID(), idMateria: materia.id }],
      ["materia inexistente", { idMonitor: monitor.id, idMateria: randomUUID() }],
      ["un admin como monitor", { idMonitor: admin.usuario.id, idMateria: materia.id }],
    ] as const) {
      const { error } = await certificar(admin, pedido);
      expect(error, caso).toMatchObject({ code: "23503" });
    }
    expect(await certificadosDe(monitor.id)).toEqual([]);
  });

  it("un certificado emitido no se cambia ni se borra, ni siquiera por el admin que lo emitió", async () => {
    const admin = await adminConSesion();
    const otroAdmin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const emitido = exito(await certificar(admin, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), -5) }), "certificar");
    const certificados = () => admin.cliente.from("certificado");

    // Revocar está fuera de alcance: cada intento falla o no toca ninguna fila.
    const intentos: [string, () => PromiseLike<{ data: { id: string }[] | null; error: unknown }>][] = [
      ["cambiar la fecha de la evaluación", () => certificados().update({ fecha_evaluacion: sumarDias(hoy(), -30) }).eq("id", emitido.id).select("id")],
      ["cambiar la fecha de emisión", () => certificados().update({ fecha_emision: sumarDias(hoy(), -30) }).eq("id", emitido.id).select("id")],
      ["pasarlo a otro admin", () => certificados().update({ id_admin: otroAdmin.id }).eq("id", emitido.id).select("id")],
      ["borrarlo", () => certificados().delete().eq("id", emitido.id).select("id")],
    ];
    for (const [intento, ejecutar] of intentos) {
      const { data, error } = await ejecutar();
      expect(error !== null || data?.length === 0, `${intento}: la base lo rechaza o no alcanza ninguna fila`).toBe(true);
    }

    expect(await certificadoEnLaBase(emitido.id)).toEqual(emitido);
  });
});

describe("quién no certifica", () => {
  it("un monitor no se certifica a sí mismo ni pide a un admin que lo haga a su nombre (42501)", async () => {
    const admin = await fx.crearAdmin();
    const monitor = await monitorConSesion();
    const materia = await materiaNueva();

    for (const [caso, idAdmin] of [
      ["a su nombre", monitor.usuario.id],
      ["con el id de un admin real", admin.id],
    ] as const) {
      const { error } = await monitor.cliente
        .from("certificado")
        .insert({ id_monitor: monitor.usuario.id, id_materia: materia.id, id_admin: idAdmin, fecha_evaluacion: hoy() });
      expect(error, caso).toMatchObject({ code: "42501" });
    }
    expect(await certificadosDe(monitor.usuario.id)).toEqual([]);
  });

  it.each([
    ["un estudiante", async () => fx.iniciarSesion(await fx.crearEstudiante())],
    ["un visitante con sesión anónima", async () => (await fx.crearAnonimo()).cliente],
    ["un cliente sin sesión", async () => crearCliente()],
  ] as const)("%s tampoco certifica (42501)", async (_quien, crearSesion) => {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    const cliente = await crearSesion();

    const { error } = await cliente
      .from("certificado")
      .insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id, fecha_evaluacion: hoy() });

    expect(error).toMatchObject({ code: "42501" });
    expect(await certificadosDe(monitor.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 3: el monitor ve sus materias certificadas
// ---------------------------------------------------------------------------
describe("criterio 3: el monitor ve sus materias certificadas", () => {
  it("lee sus certificados con la materia (la consulta de su panel) y, sin certificados, no ve ninguno", async () => {
    const admin = await adminConSesion();
    const monitor = await monitorConSesion();
    const sinCertificados = await monitorConSesion();
    const [calculo, fisica] = [await materiaNueva(), await materiaNueva()];
    const c1 = exito(await certificar(admin, { idMonitor: monitor.usuario.id, idMateria: calculo.id, fechaEvaluacion: sumarDias(hoy(), -9) }), "cálculo");
    const c2 = exito(await certificar(admin, { idMonitor: monitor.usuario.id, idMateria: fisica.id }), "física");

    const consulta = (actor: Actor) =>
      actor.cliente
        .from("certificado")
        .select("id, fecha_emision, materia(nombre, codigo)")
        .eq("id_monitor", actor.usuario.id)
        .order("fecha_emision", { ascending: true });

    const propios = exito(await consulta(monitor), "certificados del monitor");
    expect(propios).toHaveLength(2);
    expect(propios).toEqual(
      expect.arrayContaining([
        { id: c1.id, fecha_emision: c1.fecha_emision, materia: { nombre: calculo.nombre, codigo: calculo.codigo } },
        { id: c2.id, fecha_emision: c2.fecha_emision, materia: { nombre: fisica.nombre, codigo: fisica.codigo } },
      ]),
    );

    expect(exito(await consulta(sinCertificados), "certificados del otro monitor")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 (RN-23): un admin desactivado
// ---------------------------------------------------------------------------
describe("criterio 4 (RN-23): un admin desactivado", () => {
  it("ya no certifica aunque su sesión siga abierta (42501); al reactivarlo, vuelve a hacerlo", async () => {
    const admin = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const [antes, durante] = [await materiaNueva(), await materiaNueva()];

    // Con la sesión abierta y activo, certifica.
    expect(await rolDe(admin.cliente)).toBe("admin");
    exito(await certificar(admin, { idMonitor: monitor.id, idMateria: antes.id }), "certificar antes de desactivarlo");

    await desactivarCuenta(admin.usuario.id);

    // El token sigue vigente, pero es_admin() ya no lo reconoce: la política no lo deja pasar.
    expect(await rolDe(admin.cliente)).not.toBe("admin");
    const rechazado = await certificar(admin, { idMonitor: monitor.id, idMateria: durante.id });
    expect(rechazado.error).toMatchObject({ code: "42501" });
    expect(await certificadosDe(monitor.id)).toHaveLength(1);

    // Control: era la desactivación, no el pedido. Reactivado, el mismo pedido pasa.
    await reactivarCuenta(admin.usuario.id);
    exito(await certificar(admin, { idMonitor: monitor.id, idMateria: durante.id }), "certificar al reactivarlo");
    expect(await certificadosDe(monitor.id)).toHaveLength(2);
  });

  it("los certificados que emitió siguen a la vista de cualquiera y el monitor conserva su materia y sigue abriendo franjas", async () => {
    const emisor = await adminConSesion();
    const monitor = await monitorConSesion();
    const materia = await materiaNueva();
    const emitido = exito(
      await certificar(emisor, { idMonitor: monitor.usuario.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), -7) }),
      "certificar",
    );

    await desactivarCuenta(emisor.usuario.id);

    // Cualquiera, sin sesión, los sigue leyendo (lectura pública) y siguen a nombre del admin que los emitió.
    const publicos = exito(await crearCliente().from("certificado").select("*").eq("id_admin", emisor.usuario.id), "lectura sin sesión");
    expect(publicos).toEqual([emitido]);

    // El monitor sigue viendo su materia certificada...
    const propios = exito(
      await monitor.cliente.from("certificado").select("id, materia(nombre, codigo)").eq("id_monitor", monitor.usuario.id),
      "certificados del monitor",
    );
    expect(propios).toEqual([{ id: emitido.id, materia: { nombre: materia.nombre, codigo: materia.codigo } }]);

    // ...y con ese certificado sigue abriendo franjas con su propia sesión.
    const franja = await monitor.cliente.from("franja").insert(franjaDe(monitor.usuario.id)).select("id").single();
    expect(franja.error).toBeNull();
    franjas.push(franja.data!.id);
  });

  it("la lista de otro admin conserva el nombre del admin desactivado que emitió el certificado", async () => {
    const emisor = await adminConSesion();
    const otro = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const materia = await materiaNueva();
    // Los admins de prueba se llaman igual: se le da un nombre propio al emisor para reconocerlo.
    const nombreDelEmisor = `Emisora ${randomUUID().slice(0, 8)}`;
    exito(await fx.admin.from("admin").update({ nombre: nombreDelEmisor }).eq("id", emisor.usuario.id).select("id").single(), "renombrar al emisor");
    const emitido = exito(await certificar(emisor, { idMonitor: monitor.id, idMateria: materia.id, fechaEvaluacion: sumarDias(hoy(), -2) }), "certificar");

    await desactivarCuenta(emisor.usuario.id);

    // La misma consulta que arma /admin/certificados.
    const lista = exito(
      await otro.cliente
        .from("certificado")
        .select("id, id_monitor, fecha_emision, fecha_evaluacion, materia(nombre, codigo), admin(nombre)")
        .eq("id_monitor", monitor.id)
        .order("fecha_emision", { ascending: false }),
      "lista del admin",
    );
    expect(lista).toEqual([
      {
        id: emitido.id,
        id_monitor: monitor.id,
        fecha_emision: emitido.fecha_emision,
        fecha_evaluacion: emitido.fecha_evaluacion,
        materia: { nombre: materia.nombre, codigo: materia.codigo },
        admin: { nombre: nombreDelEmisor },
      },
    ]);
  });
});
