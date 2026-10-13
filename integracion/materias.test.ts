import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desactivarCuenta } from "@/lib/auth/cuentas";
import {
  borrarEvaluacion,
  borrarMateria,
  cargarMateria,
  crearMateria,
  guardarEvaluacion,
  guardarMateria,
  ligadoDeEvaluacion,
  ligadoDeMateria,
  listarMaterias,
  materiaGuardada,
  quienTieneElCodigo,
} from "@/lib/materias/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, rolDe, type Cliente, type UsuarioPrueba } from "./utilidades";

// HU-055 contra el Supabase LOCAL: el admin crea, corrige y borra materias y evaluaciones con su sesión real (rol `authenticated`),
// que es la que pasa por los permisos por columna, las políticas, los triggers y las funciones de borrar. Las cuentas son de
// verdad (dos admins, un monitor, un Lead, una sesión anónima y un admin desactivado, más quien no tiene sesión). Los datos de
// cada prueba los crea el cliente de confianza (llave secreta) y los borra `afterEach`.
//
// Las dos carreras de la carga contra un admin que guarda están en integracion/banco.test.ts. Aquí van las de borrar: con dos
// conexiones `pg` (A liga algo sin confirmar, B borra con la sesión simulada de un admin) se comprueba que el borrado espera,
// vuelve a mirar lo ligado y no pierde lo que A confirmó.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
/** Las letras fijas de los códigos que estas pruebas crean por la Data API: ninguna materia del banco real las usa. */
const LETRAS = "ZZIN";

type Actor = { nombre: string; id: string; cliente: Cliente };

let bd: pg.Client;
/** Las cuentas, que viven todo el archivo. */
let cuentas: Fixtures;
/** Lo que crea cada prueba. */
let fx: Fixtures;
let adminA: Actor;
let adminB: Actor;
let monitor: Actor;
let lead: Actor;
let anonima: Actor;
let desactivado: Actor;

/** Las materias que creó un admin por la Data API (Fixtures no las conoce) y lo que se les colgó. */
let materiasDelAdmin: string[];
let evaluacionesExtra: string[];
let solicitudes: string[];

const usados = new Set<string>();

/** Un código con forma Uniandes y letras que el banco real no usa, distinto en cada llamada. */
function codigoNuevo(): string {
  for (;;) {
    const codigo = `${LETRAS}-${String(randomInt(0, 10_000)).padStart(4, "0")}`;
    if (!usados.has(codigo)) {
      usados.add(codigo);
      return codigo;
    }
  }
}

const nombreUnico = (prefijo = "Materia HU-055") => `${prefijo} ${randomUUID().slice(0, 8)}`;

async function sesionDe(nombre: string, usuario: UsuarioPrueba): Promise<Actor> {
  return { nombre, id: usuario.id, cliente: await cuentas.iniciarSesion(usuario) };
}

/** Lo que una corrida cortada pudo dejar con las letras de estas pruebas. */
async function borrarLasDeUnaCorridaCortada() {
  const delasPruebas = `select id from public.materia where codigo like '${LETRAS}-%'`;
  await bd.query(`delete from public.solicitud_monitor_materia where id_materia in (${delasPruebas})`);
  await bd.query(`delete from public.certificado where id_materia in (${delasPruebas})`);
  await bd.query(`delete from public.diagnostico where id_materia in (${delasPruebas})`);
  await bd.query(`delete from public.evaluacion where id_materia in (${delasPruebas})`);
  await bd.query(`delete from public.materia where codigo like '${LETRAS}-%'`);
}

beforeAll(async () => {
  await exigirSupabaseLocal();
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  cuentas = new Fixtures();
  try {
    await borrarLasDeUnaCorridaCortada();
    adminA = await sesionDe("el admin A", await cuentas.crearAdmin());
    adminB = await sesionDe("el admin B", await cuentas.crearAdmin());
    monitor = await sesionDe("un monitor", await cuentas.crearMonitor());

    const delLead = await cuentas.crearAnonimo();
    await cuentas.crearLeadDeSesion(delLead.id);
    lead = { nombre: "un Lead", id: delLead.id, cliente: delLead.cliente };

    const sinContacto = await cuentas.crearAnonimo();
    anonima = { nombre: "una sesión anónima", id: sinContacto.id, cliente: sinContacto.cliente };

    // El token de un admin desactivado sigue vigente: la base ya no lo reconoce como admin.
    const baneado = await cuentas.crearAdmin();
    desactivado = await sesionDe("un admin desactivado", baneado);
    await desactivarCuenta(baneado.id);
  } catch (error) {
    await cuentas.limpiar();
    await bd.end();
    throw error;
  }
}, 120_000);

afterAll(async () => {
  try {
    await cuentas?.limpiar();
  } finally {
    await bd?.end();
  }
}, 60_000);

beforeEach(() => {
  fx = new Fixtures();
  materiasDelAdmin = [];
  evaluacionesExtra = [];
  solicitudes = [];
});

afterEach(async () => {
  try {
    if (solicitudes.length) exito(await fx.admin.from("solicitud_monitor").delete().in("id", solicitudes).select("id"), "borrar solicitudes");
    if (evaluacionesExtra.length) exito(await fx.admin.from("evaluacion").delete().in("id", evaluacionesExtra).select("id"), "borrar evaluaciones");
    await fx.limpiar();
  } finally {
    // Las que creó un admin por la Data API: sin certificados ni evaluaciones (la prueba que se los puso los borró arriba).
    if (materiasDelAdmin.length) await fx.admin.from("materia").delete().in("id", materiasDelAdmin);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Lo que las pruebas hacen con la sesión de un admin y leen de vuelta con la llave secreta
// ---------------------------------------------------------------------------
async function crearPorLaDataApi(actor: Actor, datos: { nombre: string; codigo: string }) {
  const resultado = await actor.cliente.from("materia").insert(datos).select("id, nombre, codigo").single();
  if (resultado.data) materiasDelAdmin.push(resultado.data.id);
  return resultado;
}

/** Una materia creada por el admin A por la Data API, con un código nuevo. */
async function materiaDelAdmin(nombre = nombreUnico()) {
  const codigo = codigoNuevo();
  const fila = exito(await crearPorLaDataApi(adminA, { nombre, codigo }), "crear la materia");
  return { id: fila.id, nombre, codigo };
}

const materiaEnLaBase = async (id: string) => exito(await fx.admin.from("materia").select("*").eq("id", id).single(), "leer la materia");
const evaluacionEnLaBase = async (id: string) => exito(await fx.admin.from("evaluacion").select("*").eq("id", id).single(), "leer la evaluación");

async function existeLaMateria(id: string): Promise<boolean> {
  return (await fx.admin.from("materia").select("id").eq("id", id)).data?.length === 1;
}

async function existeLaEvaluacion(id: string): Promise<boolean> {
  return (await fx.admin.from("evaluacion").select("id").eq("id", id)).data?.length === 1;
}

/** Un tema de la materia, confirmado, con la conexión directa (el cliente de confianza no lo necesita para otra cosa). */
async function nuevoTema(idMateria: string, clave = "tema-hu055"): Promise<string> {
  const { rows } = await bd.query<{ id: string }>(
    "insert into public.tema (id_materia, clave, nombre, orden) values ($1, $2, 'Tema de la prueba', 1) returning id",
    [idMateria, clave],
  );
  return rows[0].id;
}

async function evaluacionConTema(idMateria: string, idEvaluacion: string): Promise<string> {
  const idTema = await nuevoTema(idMateria);
  await bd.query("insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values ($1, $2, $3)", [idEvaluacion, idTema, idMateria]);
  return idTema;
}

// ---------------------------------------------------------------------------
// Criterios 2 y 3: el admin crea con su sesión, y la base normaliza y valida por si se salta la app
// ---------------------------------------------------------------------------
describe("criterios 2 y 3: el admin crea una materia con su sesión", () => {
  it("la guarda con el código en mayúsculas y el nombre sin espacios en los bordes, marcada como editada en la app y sin carpeta; cualquiera la lee", async () => {
    const codigo = codigoNuevo();
    const nombre = nombreUnico();

    const { data, error } = await crearPorLaDataApi(adminA, { nombre: `  ${nombre}  `, codigo: ` ${codigo.toLowerCase()} ` });

    expect(error).toBeNull();
    expect(data).toMatchObject({ nombre, codigo });
    expect(await materiaEnLaBase(data!.id)).toMatchObject({ nombre, codigo, carpeta: null, editada_en_app: true });
    const sinSesion = exito(await crearCliente().from("materia").select("id, nombre, codigo").eq("id", data!.id).single(), "leer sin sesión");
    expect(sinSesion).toEqual({ id: data!.id, nombre, codigo });
  });

  it("nace sin evaluaciones y la lista del admin la cuenta así (RN-20 con la excepción de D-62 b)", async () => {
    const creada = await materiaDelAdmin();

    const lista = await listarMaterias(adminA.cliente);
    expect(lista.find((m) => m.id === creada.id)).toEqual({ id: creada.id, nombre: creada.nombre, codigo: creada.codigo, evaluaciones: 0, activas: 0 });
    expect(await cargarMateria(adminA.cliente, creada.id)).toEqual({ id: creada.id, nombre: creada.nombre, codigo: creada.codigo, evaluaciones: [] });
  });

  it("rechaza con 23514 y la pista del campo un nombre vacío o de más de 120 caracteres y un código sin forma Uniandes, y no guarda nada", async () => {
    const marca = `Rechazada ${randomUUID().slice(0, 8)}`;
    const rechazos: { caso: string; nombre: string; codigo: string; hint: "nombre" | "codigo" }[] = [
      { caso: "un nombre vacío", nombre: "   ", codigo: codigoNuevo(), hint: "nombre" },
      { caso: "un nombre de 121 caracteres", nombre: `${marca}${"x".repeat(121 - marca.length)}`, codigo: codigoNuevo(), hint: "nombre" },
      { caso: "un código de dos letras", nombre: marca, codigo: "ZZ-1234", hint: "codigo" },
      { caso: "un código con tres números", nombre: marca, codigo: "ZZIN-123", hint: "codigo" },
      { caso: "un código con cinco números", nombre: marca, codigo: "ZZIN-12345", hint: "codigo" },
      { caso: "un código con una letra con tilde", nombre: marca, codigo: "ÁZIN-1234", hint: "codigo" },
      { caso: "un código sin guion", nombre: marca, codigo: "ZZIN1234", hint: "codigo" },
    ];

    for (const rechazo of rechazos) {
      const resultado = await adminA.cliente.from("materia").insert({ nombre: rechazo.nombre, codigo: rechazo.codigo }).select("id");
      expect(resultado.error, rechazo.caso).toMatchObject({ code: "23514", hint: rechazo.hint });
      expect(resultado.data, rechazo.caso).toBeNull();
    }

    const intentados = rechazos.flatMap((r) => [r.codigo, r.codigo.toUpperCase()]);
    expect(exito(await fx.admin.from("materia").select("id").in("codigo", intentados), "buscar lo rechazado")).toEqual([]);
    expect(exito(await fx.admin.from("materia").select("id").like("nombre", `${marca}%`), "buscar por nombre")).toEqual([]);
  });

  it("cuenta el largo del nombre por puntos de código, como la app: 120 emojis caben y 121 no", async () => {
    const cabe = await crearPorLaDataApi(adminA, { nombre: "😀".repeat(120), codigo: codigoNuevo() });
    expect(cabe.error).toBeNull();
    expect(cabe.data!.nombre).toBe("😀".repeat(120));

    const sobra = await adminA.cliente.from("materia").insert({ nombre: "😀".repeat(121), codigo: codigoNuevo() });
    expect(sobra.error).toMatchObject({ code: "23514", hint: "nombre" });
  });

  it("la función de servidor crea con la misma sesión y devuelve la fila guardada", async () => {
    const codigo = codigoNuevo();
    const nombre = nombreUnico();

    const resultado = await crearMateria(adminB.cliente, { nombre, codigo });

    expect(resultado.tipo).toBe("guardada");
    if (resultado.tipo === "guardada") materiasDelAdmin.push(resultado.fila.id);
    expect(resultado).toMatchObject({ tipo: "guardada", fila: { nombre, codigo } });
  });
});

// ---------------------------------------------------------------------------
// Criterio 4: un código repetido, aunque solo difiera en mayúsculas o en espacios
// ---------------------------------------------------------------------------
describe("criterio 4: un código que otra materia ya tiene", () => {
  it("la base lo rechaza con 23505 al crear y al editar, aunque solo difiera en mayúsculas o en los espacios de los bordes", async () => {
    const dueña = await materiaDelAdmin();
    const otra = await materiaDelAdmin();

    for (const variante of [dueña.codigo, dueña.codigo.toLowerCase(), ` ${dueña.codigo} `, `  ${dueña.codigo.toLowerCase()}  `]) {
      const creada = await adminB.cliente.from("materia").insert({ nombre: nombreUnico("Repetida"), codigo: variante });
      expect(creada.error, `crear con ${JSON.stringify(variante)}`).toMatchObject({ code: "23505" });

      const editada = await adminB.cliente.from("materia").update({ codigo: variante }).eq("id", otra.id).select("id");
      expect(editada.error, `editar con ${JSON.stringify(variante)}`).toMatchObject({ code: "23505" });
    }

    expect((await materiaEnLaBase(otra.id)).codigo).toBe(otra.codigo);
    expect(exito(await fx.admin.from("materia").select("id").ilike("codigo", dueña.codigo), "buscar el código")).toHaveLength(1);
  });

  it("las funciones de servidor devuelven el error y dicen de quién es el código", async () => {
    const dueña = await materiaDelAdmin(nombreUnico("Dueña del código"));
    const otra = await materiaDelAdmin();

    const alCrear = await crearMateria(adminB.cliente, { nombre: "Otra", codigo: dueña.codigo });
    const alEditar = await guardarMateria(adminB.cliente, otra.id, { nombre: otra.nombre, codigo: dueña.codigo });
    expect(alCrear).toMatchObject({ tipo: "error", error: { code: "23505" } });
    expect(alEditar).toMatchObject({ tipo: "error", error: { code: "23505" } });

    // El nombre para el aviso «Ya existe una materia con ese código: {nombre}.»: sin distinguir mayúsculas, y sin contar a la propia.
    expect(await quienTieneElCodigo(adminB.cliente, dueña.codigo)).toBe(dueña.nombre);
    expect(await quienTieneElCodigo(adminB.cliente, dueña.codigo.toLowerCase())).toBe(dueña.nombre);
    expect(await quienTieneElCodigo(adminB.cliente, dueña.codigo, dueña.id)).toBeNull();
    expect(await quienTieneElCodigo(adminB.cliente, codigoNuevo())).toBeNull();
  });

  it("guardar una materia sin cambiar su código no choca consigo misma", async () => {
    const materia = await materiaDelAdmin();

    const resultado = await guardarMateria(adminB.cliente, materia.id, { nombre: nombreUnico("Con otro nombre"), codigo: materia.codigo });

    expect(resultado).toMatchObject({ tipo: "guardada", fila: { id: materia.id, codigo: materia.codigo } });
  });

  it("también para quien se salta la sesión: la llave secreta no guarda dos materias cuyo código difiere solo en mayúsculas o en espacios", async () => {
    // Con la llave secreta el trigger no normaliza nada: el que impide el duplicado es el índice sobre lower(btrim(codigo)).
    const codigo = codigoNuevo();
    const primera = exito(
      await fx.admin.from("materia").insert({ nombre: nombreUnico("Primera"), codigo: codigo.toLowerCase() }).select("id").single(),
      "crear la primera",
    );
    materiasDelAdmin.push(primera.id);

    for (const variante of [codigo, ` ${codigo.toLowerCase()} `, ` ${codigo} `]) {
      const repetida = await fx.admin.from("materia").insert({ nombre: nombreUnico("Repetida"), codigo: variante }).select("id");
      if (repetida.data) materiasDelAdmin.push(...repetida.data.map((m) => m.id));
      expect(repetida.error, `crear con ${JSON.stringify(variante)}`).toMatchObject({ code: "23505" });
    }
    expect(exito(await fx.admin.from("materia").select("id").ilike("codigo", `%${codigo}%`), "buscar el código")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterio 5: corregir una materia; lo ligado sigue ligado
// ---------------------------------------------------------------------------
describe("criterio 5: el admin corrige el nombre y el código de una materia", () => {
  it("el certificado y la franja siguen ligados: se encuentran por el código nuevo y ya no por el viejo", async () => {
    const contexto = await fx.crearContextoDeMonitoria(adminA.id);
    const { materia, monitor: elMonitor, franja } = contexto;
    const viejo = materia.codigo;
    const nuevoCodigo = codigoNuevo();
    const nuevoNombre = nombreUnico("Con el nombre nuevo");

    const semanas = { p_semanas: 4 };
    const antes = exito(await crearCliente().rpc("fechas_libres_de_materia", { p_codigo_materia: viejo, ...semanas }), "fechas con el código viejo");
    expect(antes.some((f) => f.id_franja === franja.id)).toBe(true);

    const guardada = await guardarMateria(adminA.cliente, materia.id, { nombre: nuevoNombre, codigo: nuevoCodigo });
    expect(guardada).toEqual({ tipo: "guardada", fila: { id: materia.id, nombre: nuevoNombre, codigo: nuevoCodigo } });
    expect(await materiaEnLaBase(materia.id)).toMatchObject({ nombre: nuevoNombre, codigo: nuevoCodigo, editada_en_app: true });

    // Con el código nuevo, la lista de fechas libres encuentra al monitor, una vez por fecha: dos materias no se juntan.
    const despues = exito(
      await crearCliente().rpc("fechas_libres_de_materia", { p_codigo_materia: ` ${nuevoCodigo.toLowerCase()} `, ...semanas }),
      "fechas con el código nuevo",
    );
    expect(despues.some((f) => f.id_franja === franja.id && f.id_monitor === elMonitor.id)).toBe(true);
    const fechas = despues.map((f) => `${f.id_franja}|${f.fecha}`);
    expect(new Set(fechas).size).toBe(fechas.length);
    expect(exito(await crearCliente().rpc("fechas_libres_de_materia", { p_codigo_materia: viejo, ...semanas }), "fechas con el código viejo")).toEqual([]);

    // El certificado sigue siendo del monitor y de la misma materia, que ahora lleva el nombre y el código nuevos.
    const certificado = exito(
      await monitor.cliente.from("certificado").select("id_materia").eq("id_monitor", elMonitor.id),
      "certificados del monitor (cualquiera los lee)",
    );
    expect(certificado).toEqual([{ id_materia: materia.id }]);
    const conMateria = exito(
      await crearCliente().from("certificado").select("materia(nombre, codigo)").eq("id_monitor", elMonitor.id).single(),
      "el certificado con su materia",
    );
    expect(conMateria).toEqual({ materia: { nombre: nuevoNombre, codigo: nuevoCodigo } });
  });

  it("una materia de confianza sin forma Uniandes deja corregir el nombre sin tocar el código; cambiar el código sí exige la forma", async () => {
    const { materia } = await fx.crearEvaluacion();
    expect(materia.codigo).toMatch(/^INT-/);

    const soloElNombre = await guardarMateria(adminA.cliente, materia.id, { nombre: "Renombrada por el admin", codigo: materia.codigo });
    expect(soloElNombre).toEqual({ tipo: "guardada", fila: { id: materia.id, nombre: "Renombrada por el admin", codigo: materia.codigo } });
    expect(await materiaEnLaBase(materia.id)).toMatchObject({ codigo: materia.codigo, editada_en_app: true });

    const sinForma = await guardarMateria(adminA.cliente, materia.id, { nombre: "Renombrada por el admin", codigo: "SIN-FORMA" });
    expect(sinForma).toMatchObject({ tipo: "error", error: { code: "23514", hint: "codigo" } });
    expect((await materiaEnLaBase(materia.id)).codigo).toBe(materia.codigo);

    const codigo = codigoNuevo();
    const conForma = await guardarMateria(adminA.cliente, materia.id, { nombre: "Renombrada por el admin", codigo: codigo.toLowerCase() });
    expect(conForma).toMatchObject({ tipo: "guardada", fila: { codigo } });
  });

  it("un id que ya no existe da «no existe» y no crea nada", async () => {
    const resultado = await guardarMateria(adminA.cliente, randomUUID(), { nombre: "Fantasma", codigo: codigoNuevo() });
    expect(resultado).toEqual({ tipo: "no_existe" });
    expect(await materiaGuardada(adminA.cliente, randomUUID())).toBeNull();
    expect(await cargarMateria(adminA.cliente, randomUUID())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterios 6 y 7: la materia con sus evaluaciones y corregir una evaluación
// ---------------------------------------------------------------------------
describe("criterios 6 y 7: el admin corrige el nombre y la semana de una evaluación", () => {
  it("lee las evaluaciones por semana con su estado y las cuenta en la lista", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const tercera = exito(
      await fx.admin.from("evaluacion").insert({ id_materia: materia.id, semana: 3, nombre: "Parcial del medio", activa: true, acumulativo: true }).select("id").single(),
      "crear una evaluación activa",
    );
    const primera = exito(
      await fx.admin.from("evaluacion").insert({ id_materia: materia.id, semana: 1, nombre: "A primera hora" }).select("id").single(),
      "crear otra evaluación de la semana 1",
    );
    evaluacionesExtra.push(tercera.id, primera.id);

    const completa = await cargarMateria(adminA.cliente, materia.id);
    expect(completa?.evaluaciones).toEqual([
      { id: primera.id, nombre: "A primera hora", semana: 1, acumulativo: false, activa: false },
      { id: evaluacion.id, nombre: "Parcial de prueba", semana: 1, acumulativo: false, activa: false },
      { id: tercera.id, nombre: "Parcial del medio", semana: 3, acumulativo: true, activa: true },
    ]);
    expect((await listarMaterias(adminA.cliente)).find((m) => m.id === materia.id)).toMatchObject({ evaluaciones: 3, activas: 1 });
  });

  it("cambia el nombre y la semana y lo marca como editado; la clave, activa y acumulativa no se tocan", async () => {
    const { evaluacion } = await fx.crearEvaluacion();
    exito(
      await fx.admin.from("evaluacion").update({ clave: "parcial-de-prueba", activa: true, acumulativo: true }).eq("id", evaluacion.id).select("id").single(),
      "preparar la evaluación",
    );

    const guardada = await guardarEvaluacion(adminB.cliente, evaluacion.id, { nombre: "  Primer parcial  ", semana: 5 });

    expect(guardada).toEqual({ tipo: "guardada", fila: { id: evaluacion.id, nombre: "Primer parcial", semana: 5 } });
    expect(await evaluacionEnLaBase(evaluacion.id)).toMatchObject({
      nombre: "Primer parcial",
      semana: 5,
      editada_en_app: true,
      clave: "parcial-de-prueba",
      activa: true,
      acumulativo: true,
    });
    // Lo ve cualquiera (es lo que lee el selector del diagnóstico).
    const publica = exito(await crearCliente().from("evaluacion").select("nombre, semana").eq("id", evaluacion.id).single(), "leer sin sesión");
    expect(publica).toEqual({ nombre: "Primer parcial", semana: 5 });
  });

  it("guardar los mismos valores no marca la evaluación como editada", async () => {
    const { evaluacion } = await fx.crearEvaluacion();

    const guardada = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: ` ${evaluacion.nombre} `, semana: evaluacion.semana });

    expect(guardada).toMatchObject({ tipo: "guardada" });
    expect(await evaluacionEnLaBase(evaluacion.id)).toMatchObject({ nombre: evaluacion.nombre, semana: evaluacion.semana, editada_en_app: false });
  });

  it("la base rechaza un nombre vacío o largo con la pista del campo y una semana que no es mayor que 0", async () => {
    const { evaluacion } = await fx.crearEvaluacion();

    const vacio = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: "   ", semana: 2 });
    const largo = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: "x".repeat(121), semana: 2 });
    const cero = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: "Con semana cero", semana: 0 });
    const negativa = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: "Con semana negativa", semana: -1 });

    expect(vacio).toMatchObject({ tipo: "error", error: { code: "23514", hint: "nombre" } });
    expect(largo).toMatchObject({ tipo: "error", error: { code: "23514", hint: "nombre" } });
    // La restricción de la tabla no trae pista: el mensaje de la semana sale de la validación de la app (acciones.ts).
    expect(cero).toMatchObject({ tipo: "error", error: { code: "23514" } });
    expect(negativa).toMatchObject({ tipo: "error", error: { code: "23514" } });
    expect(await evaluacionEnLaBase(evaluacion.id)).toMatchObject({ nombre: evaluacion.nombre, semana: evaluacion.semana, editada_en_app: false });
  });

  it("una semana más grande que el entero de la base da 22003", async () => {
    const { evaluacion } = await fx.crearEvaluacion();

    const enorme = await guardarEvaluacion(adminA.cliente, evaluacion.id, { nombre: "Con una semana enorme", semana: 2_147_483_648 });

    expect(enorme).toMatchObject({ tipo: "error", error: { code: "22003" } });
    expect((await evaluacionEnLaBase(evaluacion.id)).semana).toBe(evaluacion.semana);
  });

  it("un id que ya no existe da «no existe»", async () => {
    expect(await guardarEvaluacion(adminA.cliente, randomUUID(), { nombre: "Fantasma", semana: 1 })).toEqual({ tipo: "no_existe" });
  });
});

// ---------------------------------------------------------------------------
// Criterio 11: lo que la Data API deja cambiar
// ---------------------------------------------------------------------------
describe("criterio 11: por la Data API el admin solo cambia nombre y código de la materia y nombre y semana de la evaluación", () => {
  it("clave, activa, acumulativo, id_materia, carpeta, la marca y el id se rechazan con permiso denegado, y no se cambia nada", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const antes = { materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) };
    const otra = await fx.crearMateria();

    const sobreLaMateria = {
      carpeta: { carpeta: "carpeta-inventada" },
      "la marca": { editada_en_app: true },
      id: { id: randomUUID() },
    };
    for (const [campo, cambio] of Object.entries(sobreLaMateria)) {
      const resultado = await adminA.cliente.from("materia").update(cambio).eq("id", materia.id).select("id");
      expect(resultado.error, `materia.${campo}`).toMatchObject({ code: "42501" });
    }
    // Aunque vayan junto a lo permitido: la sentencia entera se rechaza.
    const mezclado = await adminA.cliente.from("materia").update({ nombre: "Mezclado", carpeta: "otra-carpeta" }).eq("id", materia.id).select("id");
    expect(mezclado.error).toMatchObject({ code: "42501" });

    const sobreLaEvaluacion = {
      clave: { clave: "clave-inventada" },
      activa: { activa: true },
      acumulativo: { acumulativo: true },
      id_materia: { id_materia: otra.id },
      "la marca": { editada_en_app: true },
      id: { id: randomUUID() },
    };
    for (const [campo, cambio] of Object.entries(sobreLaEvaluacion)) {
      const resultado = await adminA.cliente.from("evaluacion").update(cambio).eq("id", evaluacion.id).select("id");
      expect(resultado.error, `evaluacion.${campo}`).toMatchObject({ code: "42501" });
    }

    expect({ materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) }).toEqual(antes);
  });

  it("ni delete directo sobre materia o evaluación ni insert de una evaluación: borrar va por las funciones y las evaluaciones las trae el banco", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();

    const borrarMateriaDirecto = await adminA.cliente.from("materia").delete().eq("id", materia.id).select("id");
    const borrarEvaluacionDirecto = await adminA.cliente.from("evaluacion").delete().eq("id", evaluacion.id).select("id");
    const crearEvaluacionDirecto = await adminA.cliente.from("evaluacion").insert({ id_materia: materia.id, semana: 2, nombre: "Creada por el admin" }).select("id");

    expect(borrarMateriaDirecto.error).toMatchObject({ code: "42501" });
    expect(borrarEvaluacionDirecto.error).toMatchObject({ code: "42501" });
    expect(crearEvaluacionDirecto.error).toMatchObject({ code: "42501" });
    expect(await existeLaMateria(materia.id)).toBe(true);
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(true);
    expect(exito(await fx.admin.from("evaluacion").select("id").eq("id_materia", materia.id), "evaluaciones de la materia")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterios 10 y 17: quién no escribe, no consulta y no borra
// ---------------------------------------------------------------------------
describe("criterios 10 y 17: solo un admin activo escribe, consulta lo ligado y borra", () => {
  const sinPermiso = () => [monitor, lead, anonima, desactivado];

  it("el admin desactivado ya no es admin para la base aunque su sesión siga abierta", async () => {
    expect(await rolDe(adminA.cliente)).toBe("admin");
    expect(await rolDe(desactivado.cliente)).not.toBe("admin");
  });

  it("monitor, Lead, sesión anónima y admin desactivado no crean, no editan y no borran materias ni evaluaciones por la Data API", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const antes = { materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) };

    for (const actor of sinPermiso()) {
      const creada = await actor.cliente.from("materia").insert({ nombre: nombreUnico("Intrusa"), codigo: codigoNuevo() }).select("id");
      expect(creada.error, `${actor.nombre} crea`).toMatchObject({ code: "42501" });

      // La política no le deja ver la fila para actualizarla: cero filas tocadas y sin error.
      const materiaEditada = await actor.cliente.from("materia").update({ nombre: "Intrusa" }).eq("id", materia.id).select("id");
      expect(materiaEditada.error, `${actor.nombre} edita la materia`).toBeNull();
      expect(materiaEditada.data, `${actor.nombre} edita la materia`).toEqual([]);
      const evaluacionEditada = await actor.cliente.from("evaluacion").update({ semana: 9 }).eq("id", evaluacion.id).select("id");
      expect(evaluacionEditada.error, `${actor.nombre} edita la evaluación`).toBeNull();
      expect(evaluacionEditada.data, `${actor.nombre} edita la evaluación`).toEqual([]);

      const materiaBorrada = await actor.cliente.from("materia").delete().eq("id", materia.id).select("id");
      expect(materiaBorrada.error, `${actor.nombre} borra la materia`).toMatchObject({ code: "42501" });
      const evaluacionBorrada = await actor.cliente.from("evaluacion").delete().eq("id", evaluacion.id).select("id");
      expect(evaluacionBorrada.error, `${actor.nombre} borra la evaluación`).toMatchObject({ code: "42501" });
    }

    expect({ materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) }).toEqual(antes);
  });

  it("sin sesión (rol anon) la base rechaza escribir y borrar", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const antes = { materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) };
    const cliente = crearCliente();

    const resultados = {
      "crea una materia": await cliente.from("materia").insert({ nombre: nombreUnico("Intrusa"), codigo: codigoNuevo() }).select("id"),
      "edita una materia": await cliente.from("materia").update({ nombre: "Intrusa" }).eq("id", materia.id).select("id"),
      "edita una evaluación": await cliente.from("evaluacion").update({ semana: 9 }).eq("id", evaluacion.id).select("id"),
      "borra una materia": await cliente.from("materia").delete().eq("id", materia.id).select("id"),
      "borra una evaluación": await cliente.from("evaluacion").delete().eq("id", evaluacion.id).select("id"),
    };
    for (const [que, resultado] of Object.entries(resultados)) expect(resultado.error, `sin sesión ${que}`).toMatchObject({ code: "42501" });

    expect({ materia: await materiaEnLaBase(materia.id), evaluacion: await evaluacionEnLaBase(evaluacion.id) }).toEqual(antes);
  });

  it("las funciones de servidor con la sesión de quien no es admin no escriben: cero filas tocadas", async () => {
    const materia = await materiaDelAdmin();
    const { evaluacion } = await fx.crearEvaluacion();

    for (const actor of sinPermiso()) {
      expect(await guardarMateria(actor.cliente, materia.id, { nombre: "Intrusa", codigo: codigoNuevo() }), actor.nombre).toEqual({ tipo: "no_existe" });
      expect(await guardarEvaluacion(actor.cliente, evaluacion.id, { nombre: "Intrusa", semana: 9 }), actor.nombre).toEqual({ tipo: "no_existe" });
    }
    expect((await materiaEnLaBase(materia.id)).nombre).toBe(materia.nombre);
    expect(await evaluacionEnLaBase(evaluacion.id)).toMatchObject({ nombre: evaluacion.nombre, semana: evaluacion.semana });
  });

  it("las cuatro funciones: un admin recibe la verdad; los demás no se enteran de lo ligado y no borran nada", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const elMonitor = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: elMonitor.id, idMateria: materia.id, idAdmin: adminA.id });
    await evaluacionConTema(materia.id, evaluacion.id);
    const vacia = await fx.crearMateria();

    // Un admin activo (los dos): ve lo ligado, no borra lo ligado y distingue lo que no existe.
    for (const admin of [adminA, adminB]) {
      expect(exito(await admin.cliente.rpc("ligado_de_materia", { p_id: materia.id }), `${admin.nombre} lee lo ligado a la materia`)).toEqual([
        "evaluaciones",
        "temas",
        "certificados",
      ]);
      expect(exito(await admin.cliente.rpc("ligado_de_evaluacion", { p_id: evaluacion.id }), `${admin.nombre} lee lo ligado a la evaluación`)).toEqual(["temas"]);
      expect(exito(await admin.cliente.rpc("ligado_de_materia", { p_id: vacia.id }), `${admin.nombre} lee una materia vacía`)).toEqual([]);
      expect(exito(await admin.cliente.rpc("borrar_materia", { p_id: materia.id }), `${admin.nombre} borra la materia ligada`)).toBe(
        "ligada:evaluaciones,temas,certificados",
      );
      expect(exito(await admin.cliente.rpc("borrar_evaluacion", { p_id: evaluacion.id }), `${admin.nombre} borra la evaluación ligada`)).toBe("ligada:temas");
      expect(exito(await admin.cliente.rpc("borrar_materia", { p_id: randomUUID() }), `${admin.nombre} borra una materia que no existe`)).toBe("no_existe");
      expect(exito(await admin.cliente.rpc("borrar_evaluacion", { p_id: randomUUID() }), `${admin.nombre} borra una evaluación que no existe`)).toBe("no_existe");
    }

    // Quien no es admin activo: listas vacías y `no_autorizado`, aunque la materia esté vacía y se pudiera borrar.
    for (const actor of sinPermiso()) {
      expect(exito(await actor.cliente.rpc("ligado_de_materia", { p_id: materia.id }), `${actor.nombre} lee lo ligado a la materia`)).toEqual([]);
      expect(exito(await actor.cliente.rpc("ligado_de_evaluacion", { p_id: evaluacion.id }), `${actor.nombre} lee lo ligado a la evaluación`)).toEqual([]);
      expect(exito(await actor.cliente.rpc("borrar_materia", { p_id: materia.id }), `${actor.nombre} borra la materia ligada`)).toBe("no_autorizado");
      expect(exito(await actor.cliente.rpc("borrar_evaluacion", { p_id: evaluacion.id }), `${actor.nombre} borra la evaluación ligada`)).toBe("no_autorizado");
      expect(exito(await actor.cliente.rpc("borrar_materia", { p_id: vacia.id }), `${actor.nombre} borra una materia vacía`)).toBe("no_autorizado");
      expect(exito(await actor.cliente.rpc("borrar_materia", { p_id: randomUUID() }), `${actor.nombre} borra una que no existe`)).toBe("no_autorizado");
    }

    // Sin sesión, el rol `anon` no tiene permiso de ejecutar ninguna de las cuatro.
    const sinSesion = crearCliente();
    const llamadas = {
      ligado_de_materia: await sinSesion.rpc("ligado_de_materia", { p_id: materia.id }),
      ligado_de_evaluacion: await sinSesion.rpc("ligado_de_evaluacion", { p_id: evaluacion.id }),
      borrar_materia: await sinSesion.rpc("borrar_materia", { p_id: vacia.id }),
      borrar_evaluacion: await sinSesion.rpc("borrar_evaluacion", { p_id: evaluacion.id }),
    };
    for (const [funcion, resultado] of Object.entries(llamadas)) expect(resultado.error, `sin sesión ${funcion}`).toMatchObject({ code: "42501" });

    expect(await existeLaMateria(materia.id)).toBe(true);
    expect(await existeLaMateria(vacia.id)).toBe(true);
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(true);
  });

  it("las funciones de servidor con la sesión de quien no es admin: nada ligado a la vista y nada borrado", async () => {
    const vacia = await fx.crearMateria();
    const { materia, evaluacion } = await fx.crearEvaluacion();

    for (const actor of sinPermiso()) {
      expect(await ligadoDeMateria(actor.cliente, materia.id), actor.nombre).toEqual([]);
      expect(await ligadoDeEvaluacion(actor.cliente, evaluacion.id), actor.nombre).toEqual([]);
      expect(await borrarMateria(actor.cliente, vacia.id), actor.nombre).toEqual({ tipo: "no_autorizado" });
      expect(await borrarEvaluacion(actor.cliente, evaluacion.id), actor.nombre).toEqual({ tipo: "no_autorizado" });
    }
    expect(await existeLaMateria(vacia.id)).toBe(true);
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterios 12 a 16: qué cuenta como ligado y borrar
// ---------------------------------------------------------------------------
describe("criterios 12 a 15: borrar solo lo que no tiene nada ligado", () => {
  it("una materia sin nada ligado se borra: la lista, la lectura pública y los selectores ya no la tienen", async () => {
    const creada = await materiaDelAdmin(nombreUnico("Por borrar"));
    expect(await ligadoDeMateria(adminA.cliente, creada.id)).toEqual([]);

    const resultado = await borrarMateria(adminA.cliente, creada.id);

    expect(resultado).toEqual({ tipo: "borrada", nombre: creada.nombre });
    expect(await existeLaMateria(creada.id)).toBe(false);
    expect((await listarMaterias(adminA.cliente)).some((m) => m.id === creada.id)).toBe(false);
    expect(exito(await crearCliente().from("materia").select("id").eq("id", creada.id), "leer sin sesión")).toEqual([]);
    // Una segunda vez ya no existe.
    expect(await borrarMateria(adminB.cliente, creada.id)).toEqual({ tipo: "no_existe" });
  });

  it("una evaluación sin nada ligado se borra y devuelve su materia; sus hermanas siguen", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const hermana = exito(
      await fx.admin.from("evaluacion").insert({ id_materia: materia.id, semana: 2, nombre: "Hermana de la borrada" }).select("id").single(),
      "crear la hermana",
    );
    evaluacionesExtra.push(hermana.id);

    const resultado = await borrarEvaluacion(adminA.cliente, evaluacion.id);

    expect(resultado).toEqual({ tipo: "borrada", nombre: evaluacion.nombre, idMateria: materia.id });
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(false);
    expect(await existeLaEvaluacion(hermana.id)).toBe(true);
    expect(await borrarEvaluacion(adminA.cliente, evaluacion.id)).toEqual({ tipo: "no_existe" });
  });

  it("una materia con evaluaciones no se borra, y quitadas las evaluaciones ya se puede", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();

    expect(await borrarMateria(adminA.cliente, materia.id)).toEqual({ tipo: "ligada", ligado: ["evaluaciones"] });
    expect(await existeLaMateria(materia.id)).toBe(true);

    expect(await borrarEvaluacion(adminA.cliente, evaluacion.id)).toMatchObject({ tipo: "borrada" });
    expect(await borrarMateria(adminA.cliente, materia.id)).toEqual({ tipo: "borrada", nombre: materia.nombre });
    expect(await existeLaMateria(materia.id)).toBe(false);
  });

  it("los seis hijos de una materia cuentan, en el orden de la base, y no se borra nada: ni la materia ni su banco", async () => {
    const contexto = await fx.crearContextoDeMonitoria(adminA.id);
    const { materia } = contexto;
    const evaluacion = exito(await fx.admin.from("evaluacion").select("id").eq("id_materia", materia.id).single(), "leer la evaluación");
    const idTema = await evaluacionConTema(materia.id, evaluacion.id);
    // Una monitoría cancelada también cuenta: la HU pide cualquier estado.
    await fx.crearMonitoria(contexto, { fecha: "2030-01-07", estado: "cancelada" });
    const { id: idSolicitud } = exito(
      await fx.admin
        .from("solicitud_monitor")
        .insert({
          nombre: "Aspirante de prueba",
          correo: `aspirante-${randomUUID()}@calibra.test`,
          numero_telefono: `+573${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        })
        .select("id")
        .single(),
      "crear la solicitud",
    );
    solicitudes.push(idSolicitud);
    exito(await fx.admin.from("solicitud_monitor_materia").insert({ id_solicitud: idSolicitud, id_materia: materia.id }).select("id_solicitud"), "ligar la solicitud");
    await fx.crearDiagnostico({ idSesionAnonima: anonima.id, idEvaluacion: evaluacion.id, idMateria: materia.id });

    const todo = ["evaluaciones", "temas", "certificados", "solicitudes", "diagnosticos", "monitorias"];
    expect(await ligadoDeMateria(adminA.cliente, materia.id)).toEqual(todo);
    expect(await ligadoDeEvaluacion(adminA.cliente, evaluacion.id)).toEqual(["temas", "diagnosticos"]);

    expect(await borrarMateria(adminA.cliente, materia.id)).toEqual({ tipo: "ligada", ligado: todo });
    expect(await borrarEvaluacion(adminA.cliente, evaluacion.id)).toEqual({ tipo: "ligada", ligado: ["temas", "diagnosticos"] });

    // Nada se perdió, tampoco lo que habría caído en cascada.
    expect(await existeLaMateria(materia.id)).toBe(true);
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(true);
    const { rows } = await bd.query<{ temas: number; vinculos: number }>(
      `select (select count(*) from public.tema where id = $1)::int as temas,
              (select count(*) from public.evaluacion_tema where id_evaluacion = $2)::int as vinculos`,
      [idTema, evaluacion.id],
    );
    expect(rows[0]).toEqual({ temas: 1, vinculos: 1 });
  });

  it("una materia sola con un tema no se borra: sus temas no caen en cascada", async () => {
    const materia = await fx.crearMateria();
    const idTema = await nuevoTema(materia.id);

    expect(await borrarMateria(adminA.cliente, materia.id)).toEqual({ tipo: "ligada", ligado: ["temas"] });

    expect(await existeLaMateria(materia.id)).toBe(true);
    const { rows } = await bd.query("select 1 from public.tema where id = $1", [idTema]);
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterio 16: la carrera entre ligar algo y borrar
// ---------------------------------------------------------------------------
describe("criterio 16: si entre la comprobación y el borrado alguien liga algo, no se borra", () => {
  type Carrera = { esperoAlCandado: boolean; resultado: string };

  /**
   * A (conexión directa, sin sesión) liga algo y no confirma todavía. B llama a la función de borrar con la sesión simulada de un
   * admin (`set local role authenticated` y sus claims dentro de una transacción) y tiene que quedar esperando. A confirma
   * 400 ms después y B contesta con lo que vio al despertar. Si B contestara antes de que A confirmara, la prueba no habría
   * medido la espera.
   */
  async function carrera(ligarSinConfirmar: (a: pg.Client) => Promise<unknown>, borrarComoAdmin: (b: pg.Client) => Promise<string>): Promise<Carrera> {
    const A = new pg.Client({ connectionString: URL_BD });
    const B = new pg.Client({ connectionString: URL_BD });
    await Promise.all([A.connect(), B.connect()]);
    let respuesta: Promise<string> | undefined;
    try {
      await A.query("begin");
      await ligarSinConfirmar(A);

      await B.query("begin");
      await B.query("set local role authenticated");
      await B.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminA.id, role: "authenticated" })]);
      let terminada = false;
      respuesta = borrarComoAdmin(B)
        .catch((error: { code?: string }) => `ERROR ${error.code ?? "sin código"}`)
        .finally(() => {
          terminada = true;
        });
      await new Promise((resolver) => setTimeout(resolver, 400));
      const esperoAlCandado = !terminada;
      await A.query("commit");
      const resultado = await respuesta;
      // B confirma lo que hizo (si borró, el borrado es real); tras un error de la base, `commit` equivale a `rollback`.
      await B.query("commit");
      return { esperoAlCandado, resultado };
    } finally {
      // Si algo falló antes del commit, suelta los candados para que B termine.
      await A.query("rollback").catch(() => {});
      await respuesta?.catch(() => {});
      await B.query("rollback").catch(() => {});
      await Promise.all([A.end(), B.end()]);
    }
  }

  const borrar = (funcion: "borrar_materia" | "borrar_evaluacion", id: string) => async (b: pg.Client) =>
    (await b.query<{ r: string }>(`select public.${funcion}($1) as r`, [id])).rows[0].r;

  it("se liga un tema mientras se borra la materia: ligada:temas, y el tema sigue (sin el candado se iría en cascada)", async () => {
    const materia = await fx.crearMateria();

    const { esperoAlCandado, resultado } = await carrera(
      (a) => a.query("insert into public.tema (id_materia, clave, nombre, orden) values ($1, 'carrera', 'Tema de la carrera', 1)", [materia.id]),
      borrar("borrar_materia", materia.id),
    );

    expect(esperoAlCandado, "el borrado debía quedar esperando a que A confirmara").toBe(true);
    expect(resultado).toBe("ligada:temas");
    expect(await existeLaMateria(materia.id)).toBe(true);
    expect((await bd.query("select 1 from public.tema where id_materia = $1", [materia.id])).rows).toHaveLength(1);
  });

  it("se certifica a un monitor mientras se borra la materia: ligada:certificados, no un error de llave foránea", async () => {
    const materia = await fx.crearMateria();
    const elMonitor = await fx.crearMonitor();

    const { esperoAlCandado, resultado } = await carrera(
      (a) => a.query("insert into public.certificado (id_monitor, id_materia, id_admin) values ($1, $2, $3)", [elMonitor.id, materia.id, adminA.id]),
      borrar("borrar_materia", materia.id),
    );

    expect(esperoAlCandado, "el borrado debía quedar esperando a que A confirmara").toBe(true);
    expect(resultado).toBe("ligada:certificados");
    expect(await existeLaMateria(materia.id)).toBe(true);
    expect((await bd.query("select 1 from public.certificado where id_materia = $1", [materia.id])).rows).toHaveLength(1);
  });

  it("se liga un tema a la evaluación mientras se borra: ligada:temas, y el vínculo y el tema siguen", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const idTema = await nuevoTema(materia.id);

    const { esperoAlCandado, resultado } = await carrera(
      (a) => a.query("insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values ($1, $2, $3)", [evaluacion.id, idTema, materia.id]),
      borrar("borrar_evaluacion", evaluacion.id),
    );

    expect(esperoAlCandado, "el borrado debía quedar esperando a que A confirmara").toBe(true);
    expect(resultado).toBe("ligada:temas");
    expect(await existeLaEvaluacion(evaluacion.id)).toBe(true);
    expect((await bd.query("select 1 from public.evaluacion_tema where id_evaluacion = $1", [evaluacion.id])).rows).toHaveLength(1);
  });

  it("sin carrera, la misma llamada borra: el candado no estorba cuando nadie liga nada", async () => {
    const materia = await fx.crearMateria();

    const { resultado } = await carrera(async () => undefined, borrar("borrar_materia", materia.id));

    expect(resultado).toBe("borrada");
    expect(await existeLaMateria(materia.id)).toBe(false);
  });
});
