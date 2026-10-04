import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { cargarReembolso } from "./reembolsos";

// HU-026 sin base: cargarReembolso con un cliente falso que responde la fila del reembolso, estado_de_reembolso, la
// franja y la materia. Aquí se fija cómo junta las dos lecturas (cada una es una petición con su propia foto de la base)
// y el día en Bogotá en que se creó. Lo que responde la base de verdad lo cubre la integración.

const ID = "70000000-0000-4000-8000-000000000026";
const ADMIN = "a0a0a0a0-0000-4000-8000-000000000026";
const REGISTRADOR = "a0a0a0a0-0000-4000-8000-000000002601";
const LLAVE = "3001234567";

type FilaDeReembolso = {
  estado: Database["public"]["Enums"]["estado_reembolso"];
  llave_destino: string | null;
  id_admin_registro?: string | null;
  registrador?: { nombre: string } | null;
  fecha_generacion: string;
  cerrado_en: string | null;
  fecha_reembolso: string | null;
  referencia_transferencia: string | null;
};

const ESPERANDO: FilaDeReembolso = {
  estado: "esperando_llave",
  llave_destino: null,
  // 9:00 a. m. del 6 de enero de 2030 en Bogotá.
  fecha_generacion: "2030-01-06T14:00:00+00:00",
  cerrado_en: null,
  fecha_reembolso: null,
  referencia_transferencia: null,
};
const PENDIENTE: FilaDeReembolso = { ...ESPERANDO, estado: "pendiente", llave_destino: LLAVE };

/** El fin de los 7 días que da la base para ESPERANDO: 9:00 a. m. del 13 de enero en Bogotá. */
const VENCE = "2030-01-13T14:00:00+00:00";

/** Un cliente que responde `fila` para el reembolso y `estado` para estado_de_reembolso. */
function clienteQueResponde(fila: FilaDeReembolso | null, estado: { estado: string; vence_en: string } | null) {
  const tablas: Record<string, unknown> = {
    reembolso: fila && {
      id: ID,
      monto: 25_000,
      motivo: "Cancelaste la monitoría dentro del plazo.",
      id_admin: ADMIN,
      admin: { nombre: "Admin Uno" },
      id_admin_registro: null,
      registrador: null,
      pago: {
        nombre_pagador: "Laura Pérez",
        contacto: "laura@uniandes.edu.co",
        monitoria: { estado: "cancelada", motivo_cancelacion: "estudiante", fecha: "2030-01-14", id_franja: "f", id_materia: "m" },
      },
      ...fila,
    },
    franja: { hora: "10:00:00", duracion_min: 60 },
    materia: { nombre: "Cálculo Diferencial" },
  };
  const from = (tabla: string) => {
    const respuesta = async () => ({ data: tablas[tabla], error: null });
    const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: respuesta, single: respuesta };
    return consulta;
  };
  const rpc = vi.fn(async () => ({ data: estado ? [estado] : [], error: null }));
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

describe("cargarReembolso (HU-026): el estado sale de la misma foto que la llave y la transferencia", () => {
  it("si quien pagó entregó la llave entre las dos lecturas, sigue esperando la llave (la fila no la trae)", async () => {
    const r = await cargarReembolso(clienteQueResponde(ESPERANDO, { estado: "pendiente", vence_en: VENCE }), ID);
    expect(r).toMatchObject({ estadoVista: "esperando_llave", llaveDestino: null, venceEn: new Date(VENCE) });
  });

  it("si otra pestaña registró la transferencia entre las dos lecturas, sigue pendiente (la fila no trae referencia ni fecha)", async () => {
    const r = await cargarReembolso(clienteQueResponde(PENDIENTE, { estado: "reembolsado", vence_en: VENCE }), ID);
    expect(r).toMatchObject({ estadoVista: "pendiente", llaveDestino: LLAVE, transferencia: null });
  });

  it("uno que espera la llave y venció es cerrado según la base, aunque pg_cron todavía no lo cierre", async () => {
    const r = await cargarReembolso(clienteQueResponde(ESPERANDO, { estado: "cerrado", vence_en: VENCE }), ID);
    expect(r).toMatchObject({ estadoVista: "cerrado", cerradoEn: null, venceEn: new Date(VENCE) });
  });

  it("si se reabrió entre las dos lecturas, espera la llave con el plazo nuevo: el estado y el plazo son de la misma foto", async () => {
    const nuevo = "2030-01-20T14:00:00+00:00";
    const cerrado = { ...ESPERANDO, cerrado_en: "2030-01-13T14:10:00+00:00" };
    const r = await cargarReembolso(clienteQueResponde(cerrado, { estado: "esperando_llave", vence_en: nuevo }), ID);
    expect(r).toMatchObject({ estadoVista: "esperando_llave", venceEn: new Date(nuevo) });
  });

  it("un reembolsado trae su referencia y su fecha", async () => {
    const fila = { ...PENDIENTE, estado: "reembolsado" as const, referencia_transferencia: "REF-26-1", fecha_reembolso: "2030-01-09T17:00:00+00:00" };
    const r = await cargarReembolso(clienteQueResponde(fila, { estado: "reembolsado", vence_en: VENCE }), ID);
    expect(r).toMatchObject({ estadoVista: "reembolsado", transferencia: { referencia: "REF-26-1", fecha: new Date("2030-01-09T17:00:00.000Z") } });
  });
});

describe("cargarReembolso (HU-082): quién lo registró", () => {
  const REEMBOLSADO = { ...PENDIENTE, estado: "reembolsado" as const, referencia_transferencia: "REF-82", fecha_reembolso: "2030-01-09T17:00:00+00:00" };
  const reembolsado = (extra: Partial<FilaDeReembolso>) =>
    cargarReembolso(clienteQueResponde({ ...REEMBOLSADO, ...extra }, { estado: "reembolsado", vence_en: VENCE }), ID);

  it("trae el admin que registró, distinto del asignado", async () => {
    const r = await reembolsado({ id_admin_registro: REGISTRADOR, registrador: { nombre: "Admin Dos" } });
    expect(r?.registradoPor).toEqual({ id: REGISTRADOR, nombre: "Admin Dos" });
    expect(r?.asignado).toEqual({ id: ADMIN, nombre: "Admin Uno" });
  });

  it("un pendiente no lo trae", async () => {
    const r = await cargarReembolso(clienteQueResponde(PENDIENTE, { estado: "pendiente", vence_en: VENCE }), ID);
    expect(r?.registradoPor).toBeNull();
  });

  it("un reembolsado sin dato (id_admin_registro nulo) da null", async () => {
    expect((await reembolsado({}))?.registradoPor).toBeNull();
  });
});

describe("cargarReembolso: el día en que se creó", () => {
  it("es el día en Bogotá, no el de UTC: creado a las 11:30 p. m. del 6 (en UTC ya es el 7), el mínimo es el 6", async () => {
    const fila = { ...PENDIENTE, fecha_generacion: "2030-01-07T04:30:00+00:00" };
    const r = await cargarReembolso(clienteQueResponde(fila, { estado: "pendiente", vence_en: VENCE }), ID);
    expect(r?.fechaMinima).toBe("2030-01-06");
  });
});

describe("cargarReembolso: lo que no se puede mostrar", () => {
  it("un reembolso que no existe (o que la sesión no puede leer) es null", async () => {
    expect(await cargarReembolso(clienteQueResponde(null, null), ID)).toBeNull();
  });

  it("lanza si la base no da el estado a quien sí leyó el reembolso", async () => {
    await expect(cargarReembolso(clienteQueResponde(PENDIENTE, null), ID)).rejects.toThrow("Respuesta inesperada al ver el estado del reembolso");
  });
});
