import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";

// HU-079: el bucle de una bandeja de salida (leer lo que no tiene `procesado_en`, mandar, marcar, sumar intentos) vive una
// sola vez, en src/lib/correo/bandeja.ts. La primera parte lee los fuentes, como pruebas/reconstructores.test.ts, y falla si
// alguien vuelve a copiarlo: una bandeja nueva declara su definición y llama a `procesarBandeja` (README, «Procesadores de
// la bandeja de salida»). La segunda corre las siete bandejas de hoy con un cliente falso y fija lo que ven el log y la base,
// que ninguna otra prueba compara entero. Pasa igual antes y después de unificar los procesadores.

vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => ({}) }));
vi.mock("@/lib/correo/servidor", () => ({ enviarCorreoDesdeServidor: vi.fn(), urlDelSitio: (ruta: string) => `https://calibra.test${ruta}` }));

import { procesarAvisosDePagoNuevo } from "@/lib/admin/avisos-pago-nuevo";
import { procesarAvisosDeRechazoDePago } from "@/lib/admin/avisos-rechazo";
import { procesarAvisosAlMonitor } from "@/lib/avisos/servidor";
import { procesarCancelacionesDeCita } from "@/lib/citas/cancelar";
import { procesarConfirmacionesDeCita } from "@/lib/citas/servidor";
import { procesarPedidosDeLlave } from "@/lib/reembolsos/pedidos";
import { procesarInvitacionesResena } from "@/lib/resenas/servidor";

const RAIZ = join(__dirname, "..");
const SRC = join(RAIZ, "src");

function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const archivos = fuentes(SRC).map((ruta) => ({ ruta: relative(RAIZ, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") }));
const textoDe = (ruta: string) => archivos.find((a) => a.ruta === ruta)?.texto ?? "";

const NUCLEO = "src/lib/correo/bandeja.ts";
const TIPOS = "src/lib/supabase/tipos.ts";

/** Los módulos de las bandejas. Una bandeja nueva se suma aquí al declararla. */
const BANDEJAS = [
  "src/lib/avisos/servidor.ts",
  "src/lib/citas/servidor.ts",
  "src/lib/citas/cancelar.ts",
  "src/lib/reembolsos/pedidos.ts",
  "src/lib/admin/avisos-rechazo.ts",
  "src/lib/admin/avisos-pago-nuevo.ts",
  "src/lib/resenas/servidor.ts",
];

/** Las plantillas que mandan esas bandejas. `pruebas/reconstructores.test.ts` solo las ve si el texto está fuera de src/lib/correo/. */
const PLANTILLAS = [
  "aviso_admin_pago_nuevo",
  "aviso_monitor_cancelada",
  "aviso_monitor_confirmada",
  "aviso_monitor_inasistencia_aceptada",
  "aviso_monitor_pago_rechazado",
  "cancelacion_cita",
  "confirmacion_cita",
  "pago_rechazado_individual",
  "pago_rechazado_sin_reembolso",
  "recordatorio_llave_reembolso",
  "resena_individual",
  "solicitud_llave_reembolso",
];

describe("el bucle de las bandejas vive una sola vez (HU-079)", () => {
  it("`procesado_en` solo aparece en el procesador común y en los tipos generados", () => {
    const con = archivos.filter((a) => a.texto.includes("procesado_en")).map((a) => a.ruta).sort();
    expect(con, "otro archivo marca `procesado_en`: ¿copió el bucle de la bandeja? Declara su definición y usa procesarBandeja").toEqual([NUCLEO, TIPOS]);
  });

  it.each(BANDEJAS)("%s declara su bandeja y la corre con procesarBandeja", (ruta) => {
    const texto = textoDe(ruta);
    expect(texto, `falta ${ruta}`).not.toBe("");
    expect(texto).toMatch(/import\s*\{[^}]*\bprocesarBandeja\b[^}]*\}\s*from\s*"@\/lib\/correo\/bandeja"/);
    expect(texto).toMatch(/\bprocesarBandeja\(/);
  });

  it("las 12 plantillas siguen escritas en el módulo de su bandeja, una vez cada una", () => {
    const escritas = BANDEJAS.flatMap((ruta) => [...textoDe(ruta).matchAll(/plantilla:\s*"([a-z_]+)"/g)].map((m) => m[1])).sort();
    expect(escritas).toEqual([...PLANTILLAS].sort());
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Las siete bandejas, con un cliente falso: qué leen, a qué tabla marcan y qué dicen cuando algo falla.
// ---------------------------------------------------------------------------------------------------------------------

type Cliente = SupabaseClient<Database>;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHORA = new Date("2099-01-12T12:00:00.000Z");

/** Un cliente que apunta lo que le piden. Los datos del correo no existen (la reconstrucción da `null`), salvo la lectura de la bandeja. */
function clienteFalso(filas: unknown[], opciones: { errorAlLeer?: boolean; errorAlMarcar?: boolean } = {}) {
  const llamadas: string[] = [];
  const respuestaDeLectura = opciones.errorAlLeer ? { data: null, error: { message: "sin permiso" } } : { data: filas, error: null };
  const cliente = {
    rpc: async (nombre: string, argumentos: unknown) => {
      llamadas.push(`rpc:${nombre}(${JSON.stringify(argumentos)})`);
      if (nombre === "invitaciones_resena_por_procesar") return respuestaDeLectura;
      if (nombre === "invitacion_resena_en_espera") return { data: false, error: null };
      return { data: [], error: null };
    },
    from: (tabla: string) => ({
      select: (columnas: string) => ({
        is: (columna: string, valor: null) => ({
          order: (orden: string) => ({
            limit: async (limite: number) => {
              llamadas.push(`${tabla}.select(${columnas}).is(${columna},${valor}).order(${orden}).limit(${limite})`);
              return respuestaDeLectura;
            },
          }),
        }),
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      update: (campos: unknown) => ({
        eq: async (columna: string, valor: string) => {
          llamadas.push(`${tabla}.update(${JSON.stringify(campos)}).eq(${columna},${valor})`);
          return { error: opciones.errorAlMarcar ? { message: "sin base" } : null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as Cliente, llamadas };
}

const dependenciasCon = (cliente: Cliente) => ({
  cliente,
  enviar: (() => {
    throw new Error("estas pruebas no mandan correos");
  }) as never,
  reloj: () => 0,
});

type CasoDeBandeja = {
  nombre: string;
  procesar: (dependencias: ReturnType<typeof dependenciasCon>) => Promise<unknown>;
  fila: Record<string, unknown>;
  lectura: string;
  tabla: string;
  leer: string;
  marcar: string;
  prefijo: string;
  sujeto: string;
};

const CASOS: CasoDeBandeja[] = [
  {
    nombre: "avisos al monitor",
    procesar: procesarAvisosAlMonitor,
    fila: { id: id(10), id_monitoria: id(1), evento: "confirmada", intentos: 0 },
    lectura: "aviso_monitor.select(id, id_monitoria, evento, intentos).is(procesado_en,null).order(creado_en).limit(10)",
    tabla: "aviso_monitor",
    leer: "No se pudieron leer los avisos",
    marcar: "No se pudo marcar el aviso",
    prefijo: "avisos",
    sujeto: `el aviso confirmada de la monitoría ${id(1)}`,
  },
  {
    nombre: "confirmaciones de cita",
    procesar: procesarConfirmacionesDeCita,
    fila: { id: id(10), id_monitoria: id(1), intentos: 0 },
    lectura: "confirmacion_cita.select(id, id_monitoria, intentos).is(procesado_en,null).order(creada_en).limit(10)",
    tabla: "confirmacion_cita",
    leer: "No se pudieron leer las confirmaciones",
    marcar: "No se pudo marcar la confirmación",
    prefijo: "citas",
    sujeto: `la confirmación de la monitoría ${id(1)}`,
  },
  {
    nombre: "cancelaciones de cita",
    procesar: procesarCancelacionesDeCita,
    fila: { id: id(10), id_monitoria: id(1), intentos: 0 },
    lectura: "cancelacion_cita.select(id, id_monitoria, intentos).is(procesado_en,null).order(creada_en).limit(10)",
    tabla: "cancelacion_cita",
    leer: "No se pudieron leer las cancelaciones",
    marcar: "No se pudo marcar la cancelación",
    prefijo: "citas",
    sujeto: `la cancelación de la monitoría ${id(1)}`,
  },
  {
    nombre: "pedidos de llave",
    procesar: procesarPedidosDeLlave,
    fila: { id: id(10), tipo: "pedido", intentos: 0 },
    lectura: "pedido_llave.select(id, tipo, intentos).is(procesado_en,null).order(creada_en).limit(10)",
    tabla: "pedido_llave",
    leer: "No se pudieron leer los pedidos de llave",
    marcar: "No se pudo marcar el pedido de la llave",
    prefijo: "reembolsos",
    sujeto: `el pedido de la llave ${id(10)}`,
  },
  {
    nombre: "avisos de rechazo de pago",
    procesar: procesarAvisosDeRechazoDePago,
    fila: { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
    lectura: "aviso_rechazo_pago.select(id, id_pago, caso, intentos).is(procesado_en,null).order(creado_en).limit(10)",
    tabla: "aviso_rechazo_pago",
    leer: "No se pudieron leer los avisos de rechazo",
    marcar: "No se pudo marcar el aviso de rechazo",
    prefijo: "pagos",
    sujeto: `el aviso del rechazo del pago ${id(1)}`,
  },
  {
    nombre: "avisos de pago nuevo",
    procesar: procesarAvisosDePagoNuevo,
    fila: { id: id(10), id_pago: id(1), id_admin: id(2), intentos: 0 },
    lectura: "aviso_pago_nuevo.select(id, id_pago, id_admin, intentos).is(procesado_en,null).order(creado_en).limit(10)",
    tabla: "aviso_pago_nuevo",
    leer: "No se pudieron leer los avisos de pago nuevo",
    marcar: "No se pudo marcar el aviso de pago nuevo",
    prefijo: "pagos",
    sujeto: `el aviso del pago nuevo ${id(1)} para el admin ${id(2)}`,
  },
  {
    nombre: "invitaciones de reseña",
    procesar: procesarInvitacionesResena,
    fila: { id: id(10), id_pago: id(1), intentos: 0 },
    lectura: 'rpc:invitaciones_resena_por_procesar({"p_limite":10})',
    tabla: "invitacion_resena",
    leer: "No se pudieron leer las invitaciones",
    marcar: "No se pudo marcar la invitación",
    prefijo: "resenas",
    sujeto: `la invitación del pago ${id(1)}`,
  },
];

describe("las siete bandejas dicen lo que decían (HU-079, HU-034)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(CASOS)("$nombre: lee con su consulta de siempre y, si no puede, lanza con su texto", async (caso) => {
    const { cliente, llamadas } = clienteFalso([]);
    await caso.procesar(dependenciasCon(cliente));
    expect(llamadas).toEqual([caso.lectura]);
    await expect(caso.procesar(dependenciasCon(clienteFalso([], { errorAlLeer: true }).cliente))).rejects.toThrow(`${caso.leer}: sin permiso`);
  });

  it.each(CASOS)("$nombre: una fila que ya no vale se marca en su tabla, y si no se puede marcar el log nombra la fila y el error", async (caso) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, llamadas } = clienteFalso([caso.fila], { errorAlMarcar: true });
    const resumen = await caso.procesar(dependenciasCon(cliente));
    expect(resumen).toMatchObject({ conError: 1 });
    expect(llamadas.filter((llamada) => llamada.startsWith(caso.tabla + ".update"))).toEqual([
      `${caso.tabla}.update({"procesado_en":"2099-01-12T12:00:00.000Z"}).eq(id,${id(10)})`,
      `${caso.tabla}.update({"intentos":1}).eq(id,${id(10)})`,
    ]);
    expect(error.mock.calls).toEqual([
      [`[${caso.prefijo}] no se pudo procesar ${caso.sujeto} (intento 1): ${caso.marcar}: sin base`],
      [`[${caso.prefijo}] tampoco se pudo anotar el intento:`, `${caso.marcar}: sin base`],
    ]);
  });
});
