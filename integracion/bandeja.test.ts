import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarBandeja, MAX_FILAS_POR_SECCION } from "@/lib/admin/bandeja";
import { crearCliente, exigirSupabaseLocal, Fixtures, rolDe } from "./utilidades";

// HU-012 contra el Supabase LOCAL: la bandeja del admin y la semilla de admins iniciales.
// Cada prueba crea sus propios datos y los borra al final.

let fx: Fixtures;

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

const MINUTO = 60_000;
const AHORA = new Date("2026-10-05T15:00:00.000Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * MINUTO).toISOString();

// La semilla (supabase/seed.sql) crea estos admins de prueba. Corre con `npm run db:reiniciar`.
const CONTRASENA_SEMILLA = "calibra-admin-local";
const ADMINS_SEMILLA = [
  { correo: "admin1@calibra.test", orden: 1 },
  { correo: "admin2@calibra.test", orden: 2 },
];

describe("criterio 3: la semilla deja los admins iniciales con su orden de revisión", () => {
  it("existen, con su ordenRevision, y el primero de la lista es admin1", async () => {
    const { data, error } = await fx.admin.from("admin").select("correo, orden_revision").in("correo", ADMINS_SEMILLA.map((a) => a.correo));
    expect(error).toBeNull();
    expect(
      [...(data ?? [])].sort((a, b) => a.orden_revision - b.orden_revision).map((a) => ({ correo: a.correo, orden: a.orden_revision })),
      "faltan los admins de la semilla: corre npm run db:reiniciar",
    ).toEqual(ADMINS_SEMILLA);
  });

  it.each(ADMINS_SEMILLA)("$correo entra con correo y contraseña y la base lo reconoce como admin", async ({ correo }) => {
    const cliente = crearCliente();
    const { error } = await cliente.auth.signInWithPassword({ email: correo, password: CONTRASENA_SEMILLA });
    expect(error).toBeNull();
    expect(await rolDe(cliente)).toBe("admin");

    // Y su bandeja carga: vacía, porque la semilla no le asigna nada.
    const { data: yo } = await cliente.auth.getUser();
    const bandeja = await cargarBandeja(cliente, yo.user!.id, AHORA);
    expect(bandeja.contadores).toEqual({
      pagos: 0,
      // HU-077: los pagos vencidos de otros admins los ve cualquiera: puede haber de otras pruebas.
      pagosVencidosDeOtros: bandeja.pagosVencidosDeOtros.length,
      reembolsos: 0,
      reembolsosEsperandoLlave: 0,
      reembolsosPendientes: 0,
      reportes: 0,
      desembolsos: bandeja.desembolsos.length, // los ejecutables son de todos: puede haber de otras pruebas
      correosSinEnviar: bandeja.correosSinEnviar.length, // los correos sin enviar también: puede haber de otras pruebas
    });
  });
});

/** Un mundo con dos admins y de todo un poco, para comprobar qué ve cada uno. */
async function armarMundo() {
  const a = await fx.crearAdmin();
  const b = await fx.crearAdmin();
  const contexto = await fx.crearContextoDeMonitoria(a.id);

  // Una monitoría futura para colgarle pagos, y monitorías pasadas para los desembolsos y los reportes.
  const futura = await fx.crearMonitoria(contexto, { fecha: "2030-01-14" });
  const pasada = (fecha: string) => fx.crearMonitoria(contexto, { fecha, estado: "realizada", fechaFinalizacion: `${fecha}T16:30:00+00:00` });
  const mEjecutable = await pasada("2020-01-06");
  const mReporteEnRevision = await pasada("2020-01-13");
  const mReporteAceptado = await pasada("2020-01-20");
  const mReporteRechazado = await pasada("2020-01-27");
  const mYaDesembolsada = await pasada("2020-02-03");
  const mReporteDeB = await pasada("2020-02-10");
  const mAnulada = await pasada("2020-02-17");

  // Pagos en revisión de A, insertados a propósito fuera de orden.
  const p3 = await fx.crearPagoDe(futura.id, { idAdmin: a.id, fechaAsignacion: hace(10), nombrePagador: "Tercera", monto: 30_000 });
  const p1 = await fx.crearPagoDe(futura.id, { idAdmin: a.id, fechaAsignacion: hace(90), nombrePagador: "Primera", monto: 10_000 });
  const p2 = await fx.crearPagoDe(futura.id, { idAdmin: a.id, fechaAsignacion: hace(30), nombrePagador: "Segunda", monto: 20_000 });
  const pAprobadoDeA = await fx.crearPagoDe(futura.id, { idAdmin: a.id, estado: "aprobado" });
  const pDeB = await fx.crearPagoDe(futura.id, { idAdmin: b.id, fechaAsignacion: hace(5), nombrePagador: "De B" });

  // Reembolsos: dos esperando llave y uno pendiente de A (más uno ya reembolsado y uno de B).
  const pagoParaReembolso = () => fx.crearPagoDe(futura.id, { idAdmin: a.id, estado: "aprobado" });
  const r1 = await fx.crearReembolso({ idPago: (await pagoParaReembolso()).id, idAdmin: a.id, estado: "esperando_llave" });
  const r2 = await fx.crearReembolso({ idPago: (await pagoParaReembolso()).id, idAdmin: a.id, estado: "esperando_llave" });
  const r3 = await fx.crearReembolso({ idPago: (await pagoParaReembolso()).id, idAdmin: a.id, estado: "pendiente" });
  await fx.crearReembolso({ idPago: (await pagoParaReembolso()).id, idAdmin: a.id, estado: "reembolsado" });
  await fx.crearReembolso({ idPago: (await pagoParaReembolso()).id, idAdmin: b.id, estado: "pendiente" });

  // Reportes: uno en revisión de A; uno aceptado y uno rechazado de A; uno en revisión de B.
  const reporteEnRevision = await fx.crearReporte({ idMonitoria: mReporteEnRevision.id, idAdmin: a.id, estado: "en_revision" });
  await fx.crearReporte({ idMonitoria: mReporteAceptado.id, idAdmin: a.id, estado: "aceptado" });
  await fx.crearReporte({ idMonitoria: mReporteRechazado.id, idAdmin: a.id, estado: "rechazado" });
  await fx.crearReporte({ idMonitoria: mReporteDeB.id, idAdmin: b.id, estado: "en_revision" });

  // Desembolsos: ejecutable si la ventana venció y no hay reporte en revisión ni aceptado.
  const dEjecutable = await fx.crearDesembolso({ idMonitoria: mEjecutable.id });
  await fx.crearDesembolso({ idMonitoria: mReporteEnRevision.id }); // bloqueado: reporte en revisión
  await fx.crearDesembolso({ idMonitoria: mReporteAceptado.id }); // bloqueado: reporte aceptado
  const dRechazado = await fx.crearDesembolso({ idMonitoria: mReporteRechazado.id }); // ejecutable: el reporte se rechazó
  await fx.crearDesembolso({ idMonitoria: mYaDesembolsada.id, estado: "desembolsado", idAdmin: a.id }); // ya salió
  await fx.crearDesembolso({ idMonitoria: mAnulada.id, estado: "anulado" });
  await fx.crearDesembolso({ idMonitoria: futura.id }); // la ventana de 24 h no ha vencido

  return { a, b, p1, p2, p3, pAprobadoDeA, pDeB, r1, r2, r3, reporteEnRevision, dEjecutable, dRechazado };
}

describe("criterio 1: el admin ve contadores y listas de lo que tiene asignado", () => {
  it("pagos en revisión de A, ordenados por vencimiento (el que vence primero arriba)", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);

    expect(bandeja.pagos.map((p) => p.id)).toEqual([m.p1.id, m.p2.id, m.p3.id]);
    expect(bandeja.pagos.map((p) => p.nombrePagador)).toEqual(["Primera", "Segunda", "Tercera"]);
    expect(bandeja.pagos.map((p) => p.monto)).toEqual([10_000, 20_000, 30_000]);
    expect(bandeja.contadores.pagos).toBe(3);
    // No aparecen el aprobado de A ni el pago en revisión de B.
    expect(bandeja.pagos.map((p) => p.id)).not.toContain(m.pAprobadoDeA.id);
    expect(bandeja.pagos.map((p) => p.id)).not.toContain(m.pDeB.id);
  });

  it("reembolsos activos de A separados por estado, con su conteo; ni los reembolsados ni los de B", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);

    expect(bandeja.reembolsos.esperandoLlave.map((r) => r.id).sort()).toEqual([m.r1.id, m.r2.id].sort());
    expect(bandeja.reembolsos.pendientes.map((r) => r.id)).toEqual([m.r3.id]);
    expect(bandeja.reembolsos.pendientes[0]).toEqual({ id: m.r3.id, monto: 25_000, motivo: "Cancelación de prueba" });
    expect(bandeja.contadores).toMatchObject({ reembolsos: 3, reembolsosEsperandoLlave: 2, reembolsosPendientes: 1 });
  });

  it("reportes de A que siguen en revisión, con la fecha de la sesión", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);

    expect(bandeja.reportes.map((r) => r.id)).toEqual([m.reporteEnRevision.id]);
    expect(bandeja.reportes[0].fechaSesion).toBe("2020-01-13");
    expect(bandeja.contadores.reportes).toBe(1);
  });

  it("desembolsos ejecutables: solo los que cumplen RN-83, con el neto y sin bruto ni comisión", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);

    // Los ejecutables del mundo de esta prueba, en orden de fecha (puede haber otros de otras pruebas: se filtra).
    const nuestros = bandeja.desembolsos.filter((d) => [m.dEjecutable.id, m.dRechazado.id].includes(d.id));
    expect(nuestros.map((d) => d.id)).toEqual([m.dEjecutable.id, m.dRechazado.id]);
    expect(nuestros.map((d) => d.montoNeto)).toEqual([22_500, 22_500]);
    expect(nuestros.map((d) => d.fechaSesion)).toEqual(["2020-01-06", "2020-01-27"]);
    // Los bloqueados, el ya desembolsado, el anulado y el que aún no cumple 24 h no aparecen.
    expect(bandeja.desembolsos.filter((d) => d.fechaSesion.startsWith("2020-01-13") || d.fechaSesion.startsWith("2020-01-20"))).toEqual([]);
    expect(bandeja.desembolsos.map((d) => d.fechaSesion)).not.toContain("2030-01-14");
    expect(bandeja.desembolsos.map((d) => d.fechaSesion)).not.toContain("2020-02-03");
    expect(bandeja.desembolsos.map((d) => d.fechaSesion)).not.toContain("2020-02-17");
    // La bandeja no recibe el bruto ni la comisión (P-32).
    expect(Object.keys(bandeja.desembolsos[0]).sort()).toEqual(["desembolsableDesde", "fechaSesion", "id", "montoNeto"]);
    // El contador cuenta lo que hay (al menos los dos de este mundo) y coincide con la lista, que aquí no se corta.
    expect(bandeja.contadores.desembolsos).toBeGreaterThanOrEqual(2);
    expect(bandeja.contadores.desembolsos).toBe(bandeja.desembolsos.length);
  });

  it("los desembolsos ejecutables son los mismos para cualquier admin (no tienen dueño hasta ejecutarse)", async () => {
    const m = await armarMundo();
    const deA = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);
    const deB = await cargarBandeja(await fx.iniciarSesion(m.b), m.b.id, AHORA);
    expect(deB.desembolsos.map((d) => d.id)).toEqual(deA.desembolsos.map((d) => d.id));
  });

  it("cada admin ve solo lo suyo: B no ve los pagos ni los reembolsos de A, ni A los de B", async () => {
    const m = await armarMundo();
    const deB = await cargarBandeja(await fx.iniciarSesion(m.b), m.b.id, AHORA);

    expect(deB.pagos.map((p) => p.id)).toEqual([m.pDeB.id]);
    expect(deB.contadores).toMatchObject({ pagos: 1, reembolsos: 1, reembolsosPendientes: 1, reembolsosEsperandoLlave: 0, reportes: 1 });
  });
});

describe("HU-077 (supuesto 2): los pagos vencidos de otros admins", () => {
  // Cualquier admin ve los vencidos de todos, así que puede haber de otras pruebas: se mira solo lo de cada una.
  const soloDe = <T extends { id: string }>(lista: T[], ...pagos: { id: string }[]) => lista.filter((p) => pagos.some((q) => q.id === p.id));

  it("B ve el pago vencido de A, aparte de los suyos, con quién lo tiene y cuánto lleva vencido; no los de A en hora ni el aprobado", async () => {
    const m = await armarMundo();
    const nombreDeA = `Admin A ${randomUUID().slice(0, 6)}`;
    expect((await fx.admin.from("admin").update({ nombre: nombreDeA }).eq("id", m.a.id)).error).toBeNull();
    const deB = await cargarBandeja(await fx.iniciarSesion(m.b), m.b.id, AHORA);

    expect(soloDe(deB.pagosVencidosDeOtros, m.p1, m.p2, m.p3, m.pAprobadoDeA, m.pDeB)).toEqual([
      {
        id: m.p1.id,
        nombrePagador: "Primera",
        monto: 10_000,
        // Asignado hace 90 min: la hora de A terminó hace 30.
        revisionHasta: new Date(AHORA.getTime() - 30 * MINUTO),
        restante: { texto: "Vencido hace 30 min", vencido: true },
        nombreAdmin: nombreDeA,
      },
    ]);
    // Los suyos no cambian: siguen solo los asignados a B.
    expect(deB.pagos.map((p) => p.id)).toEqual([m.pDeB.id]);
    expect(deB.contadores.pagos).toBe(1);
    // El contador cuenta todos los vencidos de otros (al menos el de este mundo) y coincide con la lista, que no se corta.
    expect(deB.contadores.pagosVencidosDeOtros).toBeGreaterThanOrEqual(1);
    expect(deB.contadores.pagosVencidosDeOtros).toBe(deB.pagosVencidosDeOtros.length);
  });

  it("A no ve sus propios vencidos entre los de otros (ya están en los suyos), ni el de B, que sigue en hora", async () => {
    const m = await armarMundo();
    const deA = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);
    expect(deA.pagos.map((p) => p.id)).toContain(m.p1.id);
    expect(soloDe(deA.pagosVencidosDeOtros, m.p1, m.p2, m.p3, m.pDeB)).toEqual([]);
  });

  it("supuesto 1 (P-40): justo en el límite el pago todavía es solo del asignado; un microsegundo después, de todos", async () => {
    const a = await fx.crearAdmin();
    const b = await fx.crearAdmin();
    const monitoria = await fx.crearMonitoria(await fx.crearContextoDeMonitoria(a.id), { fecha: "2030-01-14" });
    // La hora de revisión es 1 h (RN-42): asignado hace 60 min exactos, su límite es AHORA. La base guarda microsegundos.
    const enElLimite = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: "2026-10-05T14:00:00.000000Z" });
    const unMicroAntes = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: "2026-10-05T13:59:59.999999Z" });
    const unMicroDespues = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: "2026-10-05T14:00:00.000001Z" });

    const deB = await cargarBandeja(await fx.iniciarSesion(b), b.id, AHORA);
    expect(soloDe(deB.pagosVencidosDeOtros, enElLimite, unMicroAntes, unMicroDespues).map((p) => p.id)).toEqual([unMicroAntes.id]);
    expect(soloDe(deB.pagosVencidosDeOtros, unMicroAntes)[0].restante).toEqual({ texto: "Venció hace menos de 1 min", vencido: true });
  });

  it("el que lleva más tiempo vencido va arriba", async () => {
    const a = await fx.crearAdmin();
    const b = await fx.crearAdmin();
    const monitoria = await fx.crearMonitoria(await fx.crearContextoDeMonitoria(a.id), { fecha: "2030-01-14" });
    const p70 = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: hace(70) });
    const p150 = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: hace(150) });
    const p120 = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: hace(120) });

    const deB = await cargarBandeja(await fx.iniciarSesion(b), b.id, AHORA);
    expect(soloDe(deB.pagosVencidosDeOtros, p70, p150, p120).map((p) => p.restante.texto)).toEqual([
      "Vencido hace 1 h 30 min",
      "Vencido hace 1 h",
      "Vencido hace 10 min",
    ]);
  });

  it("su lista se corta por su cuenta y su contador sigue exacto", async () => {
    const m = await armarMundo();
    const monitoria = await fx.crearMonitoria(await fx.crearContextoDeMonitoria(m.a.id), { fecha: "2030-01-21" });
    await fx.crearPagoDe(monitoria.id, { idAdmin: m.a.id, fechaAsignacion: hace(100) });
    await fx.crearPagoDe(monitoria.id, { idAdmin: m.a.id, fechaAsignacion: hace(110) });

    const deB = await cargarBandeja(await fx.iniciarSesion(m.b), m.b.id, AHORA, { maxFilas: 1 });
    expect(deB.pagosVencidosDeOtros).toHaveLength(1);
    // Los tres vencidos de A en este mundo, y los de otras pruebas si los hay.
    expect(deB.contadores.pagosVencidosDeOtros).toBeGreaterThanOrEqual(3);
    // La lista propia no se come el lugar de la otra, ni al revés.
    expect(deB.pagos.map((p) => p.id)).toEqual([m.pDeB.id]);
  });
});

describe("criterio 2: un ítem con plazo muestra el tiempo restante", () => {
  it("cada pago dice cuánto le queda para revisarlo o hace cuánto venció (RN-42: 1 hora)", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA);

    expect(bandeja.pagos.map((p) => p.restante)).toEqual([
      { texto: "Vencido hace 30 min", vencido: true }, // asignado hace 90 min: la hora terminó hace 30
      { texto: "Quedan 30 min", vencido: false }, // asignado hace 30 min
      { texto: "Quedan 50 min", vencido: false }, // asignado hace 10 min
    ]);
    // El vencimiento es la fecha de asignación más 1 h, calculado con el motor de HU-003.
    expect(bandeja.pagos[0].revisionHasta.toISOString()).toBe(new Date(AHORA.getTime() - 30 * MINUTO).toISOString());
  });
});

describe("quién puede leer la bandeja", () => {
  it("con la sesión de un monitor las cinco listas salen vacías (las políticas son solo de admins)", async () => {
    const m = await armarMundo();
    const monitor = await fx.crearMonitor();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(monitor), m.a.id, AHORA);

    expect(bandeja.pagos).toEqual([]);
    expect(bandeja.pagosVencidosDeOtros).toEqual([]);
    expect(bandeja.reembolsos).toEqual({ esperandoLlave: [], pendientes: [] });
    expect(bandeja.reportes).toEqual([]);
    expect(bandeja.desembolsos).toEqual([]);
    expect(bandeja.correosSinEnviar).toEqual([]);
    expect(bandeja.contadores).toEqual({
      pagos: 0,
      pagosVencidosDeOtros: 0,
      reembolsos: 0,
      reembolsosEsperandoLlave: 0,
      reembolsosPendientes: 0,
      reportes: 0,
      desembolsos: 0,
      correosSinEnviar: 0,
    });
  });

  it("las políticas dejan leer a todo admin: el filtro por admin lo pone quien llama (la página usa el id de la sesión)", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.b), m.a.id, AHORA);
    // Por eso la página nunca pasa un id que venga del navegador: solo el de la sesión (src/app/admin/page.tsx).
    expect(bandeja.pagos).toHaveLength(3);
  });

  it("sin sesión (solo la llave publicable) la carga falla en vez de devolver datos", async () => {
    const m = await armarMundo();
    await expect(cargarBandeja(crearCliente(), m.a.id, AHORA)).rejects.toThrow(/No se pudo|parámetros/);
  });
});

describe("el corte de las listas", () => {
  it("cada lista se corta por su cuenta y todos los contadores siguen exactos", async () => {
    const m = await armarMundo();
    const bandeja = await cargarBandeja(await fx.iniciarSesion(m.a), m.a.id, AHORA, { maxFilas: 1 });

    // Pagos: se queda con el que vence primero, pero el contador cuenta los tres.
    expect(bandeja.pagos.map((p) => p.id)).toEqual([m.p1.id]);
    expect(bandeja.contadores.pagos).toBe(3);
    // Reembolsos: cada estado se corta solo. Con una lista mezclada, los dos que esperan la llave (más antiguos)
    // se comerían el único lugar y el pendiente, que es el accionable, quedaría fuera.
    expect(bandeja.reembolsos.esperandoLlave).toHaveLength(1);
    expect(bandeja.reembolsos.pendientes.map((r) => r.id)).toEqual([m.r3.id]);
    expect(bandeja.contadores).toMatchObject({ reembolsos: 3, reembolsosEsperandoLlave: 2, reembolsosPendientes: 1 });
    // Reportes y desembolsos: el contador supera a la lista.
    expect(bandeja.reportes).toHaveLength(1);
    expect(bandeja.desembolsos).toHaveLength(1);
    expect(bandeja.contadores.desembolsos).toBeGreaterThanOrEqual(2);
  });
});

describe("una lista muy larga", () => {
  it("se corta en el máximo y el contador sigue siendo exacto", async () => {
    const a = await fx.crearAdmin();
    const contexto = await fx.crearContextoDeMonitoria(a.id);
    const monitoria = await fx.crearMonitoria(contexto, { fecha: "2030-01-21" });
    const total = MAX_FILAS_POR_SECCION + 1;
    await Promise.all(
      Array.from({ length: total }, (_, i) => fx.crearPagoDe(monitoria.id, { idAdmin: a.id, fechaAsignacion: hace(i + 1), nombrePagador: `Pagador ${i}` })),
    );

    const bandeja = await cargarBandeja(await fx.iniciarSesion(a), a.id, AHORA);
    expect(bandeja.pagos).toHaveLength(MAX_FILAS_POR_SECCION);
    expect(bandeja.contadores.pagos).toBe(total);
    // Los primeros son los que vencen antes: el asignado hace más tiempo.
    expect(bandeja.pagos[0].nombrePagador).toBe(`Pagador ${total - 1}`);
  });
});
