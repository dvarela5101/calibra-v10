import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { cargarAsignacionDeReporte, cargarReporte, resolverReporte } from "./reportes";

// HU-030 sin base: cargarReporte, cargarAsignacionDeReporte y resolverReporte con un cliente falso. Aquí se fija qué pide
// cada lectura (nunca la llave del monitor, la del desembolso ni su bruto, comisión o neto), cómo arma el reporte con
// sus pagos y el caso P-24 de cada uno, y qué manda y qué guarda la resolución (las observaciones no van al error).
// Lo que responde la base de verdad lo cubre integracion/resolver-reportes.test.ts.

const ID = "30303030-0000-4000-8000-000000000030";
const MONITORIA = "40404040-0000-4000-8000-000000000030";
const ADMIN = "a0a0a0a0-0000-4000-8000-000000000030";

type Tablas = Record<string, unknown>;

const FILA_DEL_REPORTE = {
  id: ID,
  estado: "en_revision",
  id_admin: ADMIN,
  fecha_reporte: "2030-01-07T17:00:00+00:00",
  fecha_decision: null,
  observaciones: null,
  admin: { nombre: "Admin Uno" },
  monitoria: {
    id: MONITORIA,
    estado: "realizada",
    motivo_cancelacion: null,
    fecha: "2030-01-07",
    fecha_finalizacion: "2030-01-07T18:30:00+00:00",
    id_franja: "franja",
    id_materia: "materia",
    id_monitor: "monitor",
    id_lead: "lead",
  },
  monitoria_plazos: { desembolsable_desde: "2030-01-08T16:00:00+00:00", es_grupal: false },
};

const PAGO_APROBADO = {
  id: "pago-1",
  nombre_pagador: "Camila Rojas",
  monto: 32_000,
  estado: "aprobado",
  cierre_rechazo: null,
  reembolso: { id: "reembolso-1", estado: "esperando_llave" },
  resena: { calificacion: 4, comentario: "Se demoró en conectarse." },
};

const TABLAS: Tablas = {
  reporte_inasistencia: FILA_DEL_REPORTE,
  franja: { hora: "10:00:00", duracion_min: 60 },
  materia: { nombre: "Cálculo Diferencial" },
  monitor: { nombre: "Andrés Gómez" },
  monitor_privado: { correo: "andres@uniandes.edu.co", numero_telefono: "3109876543" },
  lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: null },
  desembolso: { estado: "pendiente" },
  pago: [PAGO_APROBADO],
};

/** Un cliente que responde `tablas` y anota qué pidió de cada una. */
function clienteConLectura(tablas: Tablas, errores: Record<string, string> = {}) {
  const pedidos: { tabla: string; columnas: string; filtros: [string, unknown][] }[] = [];
  const from = (tabla: string) => {
    const pedido = { tabla, columnas: "", filtros: [] as [string, unknown][] };
    pedidos.push(pedido);
    const respuesta = async () => ({ data: tablas[tabla] ?? null, error: errores[tabla] ? { message: errores[tabla] } : null });
    const consulta = {
      select: (columnas: string) => {
        pedido.columnas = columnas;
        return consulta;
      },
      eq: (columna: string, valor: unknown) => {
        pedido.filtros.push([columna, valor]);
        return consulta;
      },
      order: () => consulta,
      maybeSingle: respuesta,
      single: respuesta,
      // Los pagos se leen sin `single`: la consulta misma se espera.
      then: (resolver: (valor: Awaited<ReturnType<typeof respuesta>>) => unknown) => respuesta().then(resolver),
    };
    return consulta;
  };
  return { cliente: { from } as unknown as SupabaseClient<Database>, pedidos };
}

describe("cargarReporte (HU-030)", () => {
  it("arma el reporte con la monitoría, los contactos, el desembolso y cada pago con su reembolso y su reseña", async () => {
    const { cliente } = clienteConLectura(TABLAS);
    expect(await cargarReporte(cliente, ID)).toEqual({
      id: ID,
      estado: "en_revision",
      idAdmin: ADMIN,
      nombreAdmin: "Admin Uno",
      fechaReporte: new Date("2030-01-07T17:00:00.000Z"),
      fechaDecision: null,
      observaciones: null,
      lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: null },
      monitor: { nombre: "Andrés Gómez", correo: "andres@uniandes.edu.co", telefono: "3109876543" },
      desembolso: "pendiente",
      desembolsableDesde: new Date("2030-01-08T16:00:00.000Z"),
      monitoria: {
        id: MONITORIA,
        estado: "realizada",
        motivoCancelacion: null,
        fecha: "2030-01-07",
        hora: "10:00:00",
        duracionMin: 60,
        nombreMateria: "Cálculo Diferencial",
        fechaFinalizacion: new Date("2030-01-07T18:30:00.000Z"),
        grupal: false,
      },
      pagos: [
        {
          id: "pago-1",
          nombrePagador: "Camila Rojas",
          monto: 32_000,
          estado: "aprobado",
          caso: null,
          cierre: null,
          reembolso: { id: "reembolso-1", estado: "esperando_llave" },
          resena: { calificacion: 4, comentario: "Se demoró en conectarse." },
        },
      ],
    });
  });

  it("un reporte decidido trae su fecha y sus observaciones", async () => {
    const decidido = { ...FILA_DEL_REPORTE, estado: "rechazado", fecha_decision: "2030-01-08T15:00:00+00:00", observaciones: "No hay cómo comprobarlo." };
    const { cliente } = clienteConLectura({ ...TABLAS, reporte_inasistencia: decidido });
    expect(await cargarReporte(cliente, ID)).toMatchObject({
      estado: "rechazado",
      fechaDecision: new Date("2030-01-08T15:00:00.000Z"),
      observaciones: "No hay cómo comprobarlo.",
    });
  });

  it("nunca pide la llave del monitor, la del desembolso ni su bruto, comisión o neto: del desembolso, solo el estado", async () => {
    const { cliente, pedidos } = clienteConLectura(TABLAS);
    await cargarReporte(cliente, ID);
    const todo = pedidos.map((p) => p.columnas).join(" | ");
    expect(todo).not.toMatch(/llave|comision|bruto|neto/i);
    expect(pedidos.find((p) => p.tabla === "desembolso")?.columnas).toBe("estado");
    expect(pedidos.find((p) => p.tabla === "monitor_privado")?.columnas).toBe("correo, numero_telefono");
    // Ni de los pagos se piden el comprobante ni el contacto del pagador.
    expect(pedidos.find((p) => p.tabla === "pago")?.columnas).not.toMatch(/comprobante|contacto/);
  });

  it("lee los pagos, el desembolso y el monitor de la monitoría del reporte, no de otra", async () => {
    const { cliente, pedidos } = clienteConLectura(TABLAS);
    await cargarReporte(cliente, ID);
    expect(pedidos.find((p) => p.tabla === "reporte_inasistencia")?.filtros).toEqual([["id", ID]]);
    expect(pedidos.find((p) => p.tabla === "pago")?.filtros).toEqual([["id_monitoria", MONITORIA]]);
    expect(pedidos.find((p) => p.tabla === "desembolso")?.filtros).toEqual([["id_monitoria", MONITORIA]]);
    expect(pedidos.find((p) => p.tabla === "monitor_privado")?.filtros).toEqual([["id_monitor", "monitor"]]);
    expect(pedidos.find((p) => p.tabla === "lead")?.filtros).toEqual([["id", "lead"]]);
  });

  it("sin desembolso (la monitoría no se ha realizado) da null; sin monitor_privado, contacto vacío", async () => {
    const { cliente } = clienteConLectura({ ...TABLAS, desembolso: null, monitor_privado: null });
    expect(await cargarReporte(cliente, ID)).toMatchObject({ desembolso: null, monitor: { nombre: "Andrés Gómez", correo: null, telefono: null } });
  });

  it("el caso P-24 de un pago rechazado: abierto mientras nadie lo cierre, cerrado con su cierre, y nulo si la monitoría se canceló", async () => {
    const rechazado = { ...PAGO_APROBADO, id: "pago-2", estado: "rechazado", reembolso: null, resena: null };
    const abierto = clienteConLectura({ ...TABLAS, pago: [rechazado] });
    expect((await cargarReporte(abierto.cliente, ID))?.pagos[0]).toMatchObject({ estado: "rechazado", caso: "abierto", cierre: null });

    const cerrado = clienteConLectura({ ...TABLAS, pago: [{ ...rechazado, cierre_rechazo: "cobrado" }] });
    expect((await cargarReporte(cerrado.cliente, ID))?.pagos[0]).toMatchObject({ caso: "cerrado", cierre: "cobrado" });

    const cancelada = {
      ...FILA_DEL_REPORTE,
      monitoria: { ...FILA_DEL_REPORTE.monitoria, estado: "cancelada", motivo_cancelacion: "estudiante" },
    };
    const sinCaso = clienteConLectura({ ...TABLAS, reporte_inasistencia: cancelada, pago: [rechazado] });
    expect((await cargarReporte(sinCaso.cliente, ID))?.pagos[0]).toMatchObject({ caso: null });
  });

  it("un pago aprobado o en revisión nunca es un caso P-24", async () => {
    const enRevision = { ...PAGO_APROBADO, id: "pago-3", estado: "en_revision", reembolso: null, resena: null };
    const { cliente } = clienteConLectura({ ...TABLAS, pago: [PAGO_APROBADO, enRevision] });
    expect((await cargarReporte(cliente, ID))?.pagos.map((p) => p.caso)).toEqual([null, null]);
  });

  it("una monitoría sin pagos da la lista vacía", async () => {
    const { cliente } = clienteConLectura({ ...TABLAS, pago: [] });
    expect((await cargarReporte(cliente, ID))?.pagos).toEqual([]);
  });

  it("un reporte que no existe (o que la sesión no lee) da null", async () => {
    const { cliente } = clienteConLectura({ ...TABLAS, reporte_inasistencia: null });
    expect(await cargarReporte(cliente, ID)).toBeNull();
  });

  it("un reporte incompleto (sin plazos de la monitoría) lanza en vez de inventar la fecha del desembolso", async () => {
    const { cliente } = clienteConLectura({ ...TABLAS, reporte_inasistencia: { ...FILA_DEL_REPORTE, monitoria_plazos: null } });
    await expect(cargarReporte(cliente, ID)).rejects.toThrow("El reporte está incompleto.");
    const sinGrupal = { ...FILA_DEL_REPORTE, monitoria_plazos: { desembolsable_desde: "2030-01-08T16:00:00+00:00", es_grupal: null } };
    await expect(cargarReporte(clienteConLectura({ ...TABLAS, reporte_inasistencia: sinGrupal }).cliente, ID)).rejects.toThrow("incompleto");
  });

  it("si una lectura falla, lanza con el mensaje de la base", async () => {
    await expect(cargarReporte(clienteConLectura(TABLAS, { reporte_inasistencia: "se cayó la base" }).cliente, ID)).rejects.toThrow(
      "No se pudo leer el reporte: se cayó la base",
    );
    await expect(cargarReporte(clienteConLectura(TABLAS, { pago: "se cayó la base" }).cliente, ID)).rejects.toThrow(
      "No se pudo leer la monitoría del reporte: se cayó la base",
    );
  });
});

describe("cargarAsignacionDeReporte (HU-030)", () => {
  it("da el admin asignado y el estado, y nada más", async () => {
    const { cliente, pedidos } = clienteConLectura(TABLAS);
    expect(await cargarAsignacionDeReporte(cliente, ID)).toEqual({ idAdmin: ADMIN, estado: "en_revision" });
    expect(pedidos[0].columnas).toBe("id_admin, estado");
    expect(pedidos[0].filtros).toEqual([["id", ID]]);
  });

  it("un reporte que no existe da null y una lectura que falla lanza", async () => {
    expect(await cargarAsignacionDeReporte(clienteConLectura({ reporte_inasistencia: null }).cliente, ID)).toBeNull();
    await expect(cargarAsignacionDeReporte(clienteConLectura(TABLAS, { reporte_inasistencia: "se cayó" }).cliente, ID)).rejects.toThrow(
      "No se pudo leer el reporte: se cayó",
    );
  });
});

describe("resolverReporte (HU-030)", () => {
  function clienteConRpc(respuesta: { data: unknown; error: { code?: string; message: string; details?: string } | null }) {
    const rpc = vi.fn(async () => respuesta);
    return { cliente: { rpc } as unknown as SupabaseClient<Database>, rpc };
  }

  it("llama a la función de la puerta con la decisión y las observaciones", async () => {
    const { cliente, rpc } = clienteConRpc({ data: "aceptado", error: null });
    expect(await resolverReporte(cliente, { idReporte: ID, decision: "aceptar", observaciones: "No llegó." })).toBe("aceptado");
    expect(rpc).toHaveBeenCalledWith("resolver_reporte_inasistencia", { p_id_reporte: ID, p_decision: "aceptar", p_observaciones: "No llegó." });
  });

  it("sin observaciones manda el texto vacío, que la base toma como ninguna (el parámetro no admite nulo)", async () => {
    const { cliente, rpc } = clienteConRpc({ data: "rechazado", error: null });
    expect(await resolverReporte(cliente, { idReporte: ID, decision: "rechazar", observaciones: null })).toBe("rechazado");
    expect(rpc).toHaveBeenCalledWith("resolver_reporte_inasistencia", { p_id_reporte: ID, p_decision: "rechazar", p_observaciones: "" });
  });

  it("devuelve cualquiera de los resultados de la base tal cual", async () => {
    for (const resultado of ["ya_decidido", "no_asignado", "no_individual", "no_aceptable", "sin_permiso"]) {
      const { cliente } = clienteConRpc({ data: resultado, error: null });
      expect(await resolverReporte(cliente, { idReporte: ID, decision: "aceptar", observaciones: null })).toBe(resultado);
    }
  });

  it("un error de la base lanza con el código y el mensaje, nunca con el detalle ni las observaciones", async () => {
    const { cliente } = clienteConRpc({
      data: null,
      error: { code: "42501", message: "permission denied for function", details: "observaciones: Dato sensible de quien reportó" },
    });
    const error = await resolverReporte(cliente, { idReporte: ID, decision: "rechazar", observaciones: "Dato sensible de quien reportó" }).catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("No se pudo resolver el reporte: 42501 permission denied for function");
    expect((error as Error).message).not.toContain("Dato sensible");
  });

  it("una respuesta que no es un resultado conocido lanza en vez de darse por buena", async () => {
    for (const data of ["resuelto", null, 3, ["aceptado"]]) {
      const { cliente } = clienteConRpc({ data, error: null });
      await expect(resolverReporte(cliente, { idReporte: ID, decision: "aceptar", observaciones: null })).rejects.toThrow(
        "Respuesta inesperada al resolver el reporte",
      );
    }
  });
});
