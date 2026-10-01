import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarEquipo, desactivarAdmin, moverAdmin } from "@/lib/admin/equipo";
import { siguienteActivo } from "@/lib/admin/equipo-reglas";
import { exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

/**
 * HU-054 contra el Supabase local: `cargarEquipo`, `moverAdmin` y `desactivarAdmin` (el mismo código de
 * `/admin/equipo`) con la sesión de verdad de cada admin, y `desactivarCuenta()` reasignando los casos abiertos
 * (P-44) antes de banear. La base local puede tener otros admins (de otras pruebas o del desarrollo): el turno
 * recorre a todos, así que quién recibe los casos se calcula con el equipo que ve el admin, igual que la pantalla.
 */

let fx: Fixtures;
let e: Awaited<ReturnType<typeof construirEscenario>>;

beforeAll(async () => {
  await exigirSupabaseLocal();
  fx = new Fixtures();
  try {
    e = await construirEscenario();
  } catch (error) {
    await fx.limpiar();
    throw error;
  }
}, 90_000);

afterAll(async () => {
  await fx?.limpiar();
});

async function construirEscenario() {
  // A: el que se desactiva, con casos. B: quien desactiva. C: otro admin para ordenar.
  const a = await fx.crearAdmin();
  const b = await fx.crearAdmin();
  const c = await fx.crearAdmin();
  const sesionB = await fx.iniciarSesion(b);
  const sesionC = await fx.iniciarSesion(c);

  const contexto = await fx.crearContextoDeMonitoria(a.id);
  const sesionMonitor = await fx.iniciarSesion(contexto.monitor);
  const monitoria = await fx.crearMonitoria(contexto, { fecha: "2030-01-14" });
  const realizada = await fx.crearMonitoria(contexto, { fecha: "2030-01-07", estado: "realizada", fechaFinalizacion: "2030-01-07T16:30:00+00:00" });
  const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, estado: "aprobado" });
  const reembolsoAbierto = await fx.crearReembolso({ idPago: pago.id, idAdmin: a.id, estado: "esperando_llave" });
  const reporteAbierto = await fx.crearReporte({ idMonitoria: realizada.id, idAdmin: a.id, estado: "en_revision" });
  const certificado = exito(
    await fx.admin.from("certificado").select("id").eq("id_admin", a.id).limit(1).single(),
    "leer el certificado que emitió A",
  );

  return { a, b, c, sesionB, sesionC, idMonitor: contexto.monitor.id, sesionMonitor, pago, reembolsoAbierto, reporteAbierto, certificado };
}

async function ordenDe(id: string): Promise<number> {
  return exito(await fx.admin.from("admin").select("orden_revision").eq("id", id).single(), "leer el orden").orden_revision;
}

describe("el equipo solo lo ve y lo ordena un admin activo", () => {
  it("un admin ve a todo el equipo en su orden de revisión, con quién está activo y sus casos abiertos", async () => {
    const equipo = await cargarEquipo(e.sesionB);
    const ordenes = equipo.map((m) => m.ordenRevision);
    expect(ordenes).toEqual([...ordenes].sort((x, y) => x - y));
    const a = equipo.find((m) => m.id === e.a.id);
    expect(a).toMatchObject({ activo: true, casosAbiertos: 2, correo: e.a.correo });
  });

  it("un monitor no ve el equipo ni puede moverlo", async () => {
    expect(await cargarEquipo(e.sesionMonitor)).toEqual([]);
    expect(await moverAdmin(e.sesionMonitor, e.a.id, "abajo")).toBe("sin_permiso");
  });

  it("criterio 1: mover cambia el orden con el vecino, y el turno sigue el orden nuevo", async () => {
    const antes = await cargarEquipo(e.sesionB);
    const i = antes.findIndex((m) => m.id === e.c.id);
    const vecino = antes[i - 1];
    if (!vecino) {
      expect(await moverAdmin(e.sesionB, e.c.id, "arriba")).toBe("en_el_borde");
      return;
    }
    const [ordenC, ordenVecino] = [antes[i].ordenRevision, vecino.ordenRevision];

    expect(await moverAdmin(e.sesionB, e.c.id, "arriba")).toBe("movido");

    expect(await ordenDe(e.c.id)).toBe(ordenVecino);
    expect(await ordenDe(vecino.id)).toBe(ordenC);
    // Vuelve a su sitio: el resto de las pruebas no depende de este cambio.
    expect(await moverAdmin(e.sesionB, e.c.id, "abajo")).toBe("movido");
    expect(await ordenDe(e.c.id)).toBe(ordenC);
  });

  it("al primero no se le sube ni al último se le baja", async () => {
    const equipo = await cargarEquipo(e.sesionB);
    expect(await moverAdmin(e.sesionB, equipo[0].id, "arriba")).toBe("en_el_borde");
    expect(await moverAdmin(e.sesionB, equipo[equipo.length - 1].id, "abajo")).toBe("en_el_borde");
  });
});

describe("desactivar a un admin", () => {
  it("nadie se desactiva a sí mismo", async () => {
    expect(await desactivarAdmin(e.sesionB, e.b.id, e.b.id)).toEqual({ ok: false, motivo: "propio" });
  });

  it("criterio 3 (P-44): sus casos abiertos pasan al siguiente activo, que los ve en su bandeja; los cerrados y su historia se quedan", async () => {
    const equipoAntes = await cargarEquipo(e.sesionB);
    const recibe = siguienteActivo(equipoAntes, e.a.id);
    expect(recibe, "debía haber otro admin activo").not.toBeNull();

    const resultado = await desactivarAdmin(e.sesionB, e.b.id, e.a.id);
    expect(resultado).toEqual({ ok: true, nombre: "Admin de prueba", recibe: recibe!.nombre });

    const reembolso = exito(await fx.admin.from("reembolso").select("id_admin").eq("id", e.reembolsoAbierto.id).single(), "leer el reembolso");
    const reporte = exito(await fx.admin.from("reporte_inasistencia").select("id_admin").eq("id", e.reporteAbierto.id).single(), "leer el reporte");
    expect(reembolso.id_admin).toBe(recibe!.id);
    expect(reporte.id_admin).toBe(recibe!.id);

    const bandeja = await cargarBandeja(fx.admin, recibe!.id, new Date());
    expect(bandeja.reembolsos.esperandoLlave.map((r) => r.id)).toContain(e.reembolsoAbierto.id);
    expect(bandeja.reportes.map((r) => r.id)).toContain(e.reporteAbierto.id);

    // Criterio 2: su pago revisado y su certificado se conservan a su nombre.
    expect(exito(await fx.admin.from("pago").select("id_admin").eq("id", e.pago.id).single(), "leer el pago").id_admin).toBe(e.a.id);
    expect(exito(await fx.admin.from("certificado").select("id_admin").eq("id", e.certificado.id).single(), "leer el certificado").id_admin).toBe(e.a.id);

    // Queda desactivado: el equipo lo muestra así, sin casos, y ya no se puede volver a desactivar.
    const equipoDespues = await cargarEquipo(e.sesionB);
    expect(equipoDespues.find((m) => m.id === e.a.id)).toMatchObject({ activo: false, casosAbiertos: 0 });
    expect(await desactivarAdmin(e.sesionB, e.b.id, e.a.id)).toEqual({ ok: false, motivo: "ya_inactivo" });
  });

  it("criterio 1: el turno se salta al desactivado", async () => {
    const equipo = await cargarEquipo(e.sesionB);
    for (const m of equipo) expect(siguienteActivo(equipo, m.id)?.id).not.toBe(e.a.id);
  });

  it("un admin desactivado ya no ve el equipo", async () => {
    const sesionA = await fx.iniciarSesion(e.a).catch(() => null);
    // Baneado no puede iniciar sesión; si el Auth local lo dejara, igual no vería nada.
    if (sesionA) expect(await cargarEquipo(sesionA)).toEqual([]);
  });

  it("a quien no está en el equipo no se le desactiva", async () => {
    expect(await desactivarAdmin(e.sesionB, e.b.id, e.idMonitor)).toEqual({ ok: false, motivo: "no_encontrado" });
  });
});
