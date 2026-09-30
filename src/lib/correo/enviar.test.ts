import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claveDeCorreo,
  enviarCorreo,
  type Dependencias,
  type EntradaDeEnvio,
  type RegistroDeEnvios,
  type Reserva,
} from "./enviar";
import { PLANTILLAS, type DatosPorPlantilla, type Plantilla } from "./plantillas";
import type { CorreoSaliente, Proveedor, ResultadoProveedor } from "./proveedor";

// El flujo de envío con dobles: un registro en memoria y un proveedor que contesta lo que se le diga.

const ENLACE = "https://calibra.example/x?token=abc";
const EJEMPLOS: { [P in Plantilla]: DatosPorPlantilla[P] } = {
  recuperacion_diagnostico: { nombre: "Ana", materia: "Cálculo", enlace: ENLACE },
  resena_individual: { nombre: "Ana", monitor: "Camilo", enlace: ENLACE },
  solicitud_llave_reembolso: { nombre: "Ana", monto: 25_000, motivo: "Cancelaste a tiempo", enlace: ENLACE },
  pago_rechazado_individual: { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06" },
  pago_rechazado_grupal: { nombre: "Ana", monto: 20_000, fechaSesion: "2020-01-13", enlace: ENLACE },
  escalamiento_pago: { nombreAdmin: "Admin", nombrePagador: "Ana", monto: 25_000, enlace: ENLACE },
  invitacion_monitor: { enlace: ENLACE, venceEn: "2020-01-13T15:00:00.000Z" },
};

const entrada = (cambios: Partial<EntradaDeEnvio<"solicitud_llave_reembolso">> = {}): EntradaDeEnvio<"solicitud_llave_reembolso"> => ({
  plantilla: "solicitud_llave_reembolso",
  datos: EJEMPLOS.solicitud_llave_reembolso,
  destinatario: "ana@uniandes.edu.co",
  entidad: "reembolso-1",
  ...cambios,
});

type Fila = {
  plantilla: string;
  destinatario: string;
  estado: "pendiente" | "enviado" | "fallido";
  intentos: number;
  error?: string;
  id?: string | null;
  reintentable?: boolean;
};

/** Un registro en memoria con la misma regla que la tabla: una fila por clave, y solo se manda si se reserva. */
function registroEnMemoria(inicial: Record<string, Fila> = {}) {
  const filas = new Map<string, Fila>(Object.entries(inicial));
  const llamadas: string[] = [];
  const registro: RegistroDeEnvios = {
    async reservar({ clave, plantilla, destinatario }): Promise<Reserva> {
      llamadas.push(`reservar:${clave}`);
      const existente = filas.get(clave);
      if (!existente) {
        filas.set(clave, { plantilla, destinatario, estado: "pendiente", intentos: 0 });
        return { accion: "enviar", intentosPrevios: 0 };
      }
      if (existente.estado === "enviado") return { accion: "ya_enviado" };
      if (existente.estado === "pendiente") return { accion: "en_curso" };
      existente.estado = "pendiente";
      return { accion: "enviar", intentosPrevios: existente.intentos };
    },
    async marcarEnviado(clave, { idProveedor, intentos }) {
      llamadas.push(`enviado:${clave}`);
      Object.assign(filas.get(clave)!, { estado: "enviado", intentos, id: idProveedor, error: undefined });
    },
    async marcarFallido(clave, { error, intentos, reintentable }) {
      llamadas.push(`fallido:${clave}`);
      Object.assign(filas.get(clave)!, { estado: "fallido", intentos, error, reintentable });
    },
  };
  return { registro, filas, llamadas };
}

const ok = (idProveedor: string | null = "prov-1"): ResultadoProveedor => ({ ok: true, idProveedor });
const pasajero = (error = "Resend 503 service_unavailable: caído"): ResultadoProveedor => ({ ok: false, reintentable: true, error });
const definitivo = (error = "Resend 403 invalid_permission: dominio sin verificar"): ResultadoProveedor => ({ ok: false, reintentable: false, error });

/** Un proveedor que devuelve, en orden, los resultados que se le den (el último se repite). */
function proveedorFalso(...resultados: (ResultadoProveedor | Error)[]) {
  const enviados: CorreoSaliente[] = [];
  const proveedor: Proveedor = {
    nombre: "falso",
    async enviar(correo) {
      enviados.push(correo);
      const siguiente = resultados[Math.min(enviados.length - 1, resultados.length - 1)];
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
  };
  return { proveedor, enviados };
}

function armar(...resultados: (ResultadoProveedor | Error)[]) {
  const memoria = registroEnMemoria();
  const proveedor = proveedorFalso(...(resultados.length ? resultados : [ok()]));
  const esperas: number[] = [];
  const dependencias: Dependencias = {
    registro: memoria.registro,
    proveedor: { ok: true, proveedor: proveedor.proveedor },
    esperar: async (ms) => {
      esperas.push(ms);
    },
  };
  return { ...memoria, ...proveedor, esperas, dependencias };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("un envío que sale a la primera", () => {
  it("manda el correo armado por la plantilla y lo anota como enviado", async () => {
    const t = armar(ok("prov-9"));
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toEqual({ ok: true, yaEnviado: false, intentos: 1, idProveedor: "prov-9" });
    expect(t.enviados).toHaveLength(1);
    expect(t.enviados[0]).toMatchObject({
      para: "ana@uniandes.edu.co",
      claveIdempotencia: "solicitud_llave_reembolso:reembolso-1",
    });
    expect(t.enviados[0].asunto).toContain("Necesitamos tu llave");
    expect(t.enviados[0].html).toContain('<html lang="es">');
    expect(t.enviados[0].texto).toContain("Enviar mi llave");
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({
      plantilla: "solicitud_llave_reembolso",
      destinatario: "ana@uniandes.edu.co",
      estado: "enviado",
      intentos: 1,
      id: "prov-9",
    });
    expect(t.llamadas).toEqual(["reservar:solicitud_llave_reembolso:reembolso-1", "enviado:solicitud_llave_reembolso:reembolso-1"]);
    expect(t.esperas).toEqual([]);
  });

  it("quita los espacios del destinatario antes de mandar y de anotar", async () => {
    const t = armar();
    await enviarCorreo(t.dependencias, entrada({ destinatario: "  ana@uniandes.edu.co \n" }));
    expect(t.enviados[0].para).toBe("ana@uniandes.edu.co");
    expect([...t.filas.values()][0].destinatario).toBe("ana@uniandes.edu.co");
  });

  it.each(PLANTILLAS)("sale la plantilla %s", async (plantilla) => {
    const t = armar();
    const resultado = await enviarCorreo(t.dependencias, { plantilla, datos: EJEMPLOS[plantilla], destinatario: "ana@uniandes.edu.co", entidad: "e-1" });
    expect(resultado).toMatchObject({ ok: true, yaEnviado: false });
    expect(t.enviados).toHaveLength(1);
    expect(t.enviados[0].claveIdempotencia).toBe(`${plantilla}:e-1`);
    expect(t.filas.get(`${plantilla}:e-1`)?.estado).toBe("enviado");
  });
});

describe("no duplicar: el mismo correo no sale dos veces", () => {
  it("si ya se envió, otra llamada con la misma clave no lo manda", async () => {
    const t = armar();
    await enviarCorreo(t.dependencias, entrada());
    const segundo = await enviarCorreo(t.dependencias, entrada());

    expect(segundo).toEqual({ ok: true, yaEnviado: true, intentos: 0, idProveedor: null });
    expect(t.enviados).toHaveLength(1);
  });

  it("dos eventos distintos de la misma plantilla son dos correos", async () => {
    const t = armar();
    await enviarCorreo(t.dependencias, entrada({ entidad: "reembolso-1" }));
    await enviarCorreo(t.dependencias, entrada({ entidad: "reembolso-2" }));
    expect(t.enviados.map((c) => c.claveIdempotencia)).toEqual([
      "solicitud_llave_reembolso:reembolso-1",
      "solicitud_llave_reembolso:reembolso-2",
    ]);
  });

  it("si otro proceso lo está enviando, no lo manda y lo dice", async () => {
    const t = armar();
    t.filas.set("solicitud_llave_reembolso:reembolso-1", { plantilla: "x", destinatario: "a@b.co", estado: "pendiente", intentos: 1 });
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toMatchObject({ ok: false, motivo: "en_curso" });
    expect(t.enviados).toEqual([]);
  });
});

describe("reintentar los fallos pasajeros", () => {
  it("un fallo pasajero y luego éxito: sale en el segundo intento tras esperar 500 ms", async () => {
    const t = armar(pasajero(), ok("prov-2"));
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toEqual({ ok: true, yaEnviado: false, intentos: 2, idProveedor: "prov-2" });
    expect(t.enviados).toHaveLength(2);
    expect(t.esperas).toEqual([500]);
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({ estado: "enviado", intentos: 2 });
  });

  it("todos los intentos llevan la misma Idempotency-Key y el mismo contenido", async () => {
    const t = armar(pasajero(), pasajero(), ok());
    await enviarCorreo(t.dependencias, entrada());
    expect(t.enviados).toHaveLength(3);
    expect(new Set(t.enviados.map((c) => c.claveIdempotencia))).toEqual(new Set(["solicitud_llave_reembolso:reembolso-1"]));
    expect(new Set(t.enviados.map((c) => JSON.stringify(c)))).toHaveProperty("size", 1);
    expect(t.esperas).toEqual([500, 1_500]);
  });

  it("si los tres intentos fallan, lo anota fallido con el error y devuelve el motivo, sin lanzar", async () => {
    const t = armar(pasajero("Resend 503 service_unavailable: uno"), pasajero("Resend 503 service_unavailable: dos"), pasajero("Resend 503 service_unavailable: tres"));
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toEqual({ ok: false, motivo: "fallo_del_proveedor", error: "Resend 503 service_unavailable: tres", intentos: 3 });
    expect(t.enviados).toHaveLength(3);
    expect(t.esperas).toEqual([500, 1_500]); // no espera después del último intento
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({
      estado: "fallido",
      intentos: 3,
      error: "Resend 503 service_unavailable: tres",
      // HU-065: la falla fue temporal, así que el proceso programado la reintenta más tarde.
      reintentable: true,
    });
  });

  it("un fallo definitivo no se reintenta: se queda en un intento", async () => {
    const t = armar(definitivo());
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toMatchObject({ ok: false, motivo: "fallo_del_proveedor", intentos: 1 });
    expect(t.enviados).toHaveLength(1);
    expect(t.esperas).toEqual([]);
    // HU-065: definitivo, el proceso programado no lo reintenta.
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({ estado: "fallido", intentos: 1, reintentable: false });
  });

  it("un fallo pasajero seguido de uno definitivo se detiene en el definitivo", async () => {
    const t = armar(pasajero(), definitivo());
    const resultado = await enviarCorreo(t.dependencias, entrada());
    expect(resultado).toMatchObject({ ok: false, intentos: 2, error: "Resend 403 invalid_permission: dominio sin verificar" });
    expect(t.enviados).toHaveLength(2);
  });

  it("un proveedor que lanza en vez de devolver un resultado cuenta como fallo pasajero", async () => {
    const t = armar(new Error("se cayó la conexión"), ok());
    const resultado = await enviarCorreo(t.dependencias, entrada());
    expect(resultado).toMatchObject({ ok: true, intentos: 2 });
    expect(t.esperas).toEqual([500]);
  });

  it("respeta el máximo de intentos y las esperas que se le pidan", async () => {
    const t = armar(pasajero());
    const resultado = await enviarCorreo({ ...t.dependencias, intentosMaximos: 5, esperas: [10, 20] }, entrada());
    expect(resultado).toMatchObject({ ok: false, intentos: 5 });
    expect(t.enviados).toHaveLength(5);
    expect(t.esperas).toEqual([10, 20, 20, 20]); // la última espera se repite
  });
});

describe("volver a llamar después de un fallo", () => {
  it("reintenta sobre la misma fila y, si esta vez sale, hay un solo correo entregado", async () => {
    const t = armar(pasajero(), pasajero(), pasajero(), ok("prov-final"));
    const primero = await enviarCorreo(t.dependencias, entrada());
    expect(primero).toMatchObject({ ok: false, intentos: 3 });

    const segundo = await enviarCorreo(t.dependencias, entrada());
    expect(segundo).toEqual({ ok: true, yaEnviado: false, intentos: 4, idProveedor: "prov-final" });
    expect(t.filas.size).toBe(1);
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({ estado: "enviado", intentos: 4, id: "prov-final" });

    // Y una tercera llamada ya no manda nada.
    const enviadosAntes = t.enviados.length;
    expect(await enviarCorreo(t.dependencias, entrada())).toMatchObject({ ok: true, yaEnviado: true });
    expect(t.enviados).toHaveLength(enviadosAntes);
  });
});

describe("cuando algo del entorno falla", () => {
  it("un contacto que no es un correo (un teléfono) no manda ni anota nada", async () => {
    const t = armar();
    const resultado = await enviarCorreo(t.dependencias, entrada({ destinatario: "3001234567" }));

    expect(resultado).toMatchObject({ ok: false, motivo: "contacto_no_es_correo", intentos: 0 });
    expect(t.enviados).toEqual([]);
    expect(t.llamadas).toEqual([]);
  });

  it.each(["", "   ", "ana@", "ana@uniandes.edu.co,otro@dominio.co", "ana@uniandes.edu.co\nBcc: x@y.co"])("el destinatario %j no se acepta", async (destinatario) => {
    const t = armar();
    expect(await enviarCorreo(t.dependencias, entrada({ destinatario }))).toMatchObject({ ok: false, motivo: "contacto_no_es_correo" });
    expect(t.enviados).toEqual([]);
  });

  it("si el registro no puede reservar, no manda: sin registro no hay forma de no duplicar", async () => {
    const t = armar();
    t.dependencias.registro = {
      ...t.registro,
      reservar: async () => {
        throw new Error("la base no responde");
      },
    };
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toMatchObject({ ok: false, motivo: "fallo_del_registro", intentos: 0 });
    expect(t.enviados).toEqual([]);
  });

  it("si el correo salió pero no se pudo anotar, sigue siendo un éxito (y queda constancia en el log)", async () => {
    const t = armar();
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    t.dependencias.registro = {
      ...t.registro,
      marcarEnviado: async () => {
        throw new Error("la base no responde");
      },
    };
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toMatchObject({ ok: true, yaEnviado: false, intentos: 1 });
    expect(t.enviados).toHaveLength(1);
    expect(consola).toHaveBeenCalledOnce();
  });

  it("si el fallo tampoco se puede anotar, igual devuelve el motivo del fallo", async () => {
    const t = armar(definitivo());
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    t.dependencias.registro = {
      ...t.registro,
      marcarFallido: async () => {
        throw new Error("la base no responde");
      },
    };
    const resultado = await enviarCorreo(t.dependencias, entrada());

    expect(resultado).toMatchObject({ ok: false, motivo: "fallo_del_proveedor" });
    expect(consola).toHaveBeenCalledOnce();
  });

  it("sin proveedor configurado lo anota como fallido con la razón, sin intentar mandar", async () => {
    const t = armar();
    const resultado = await enviarCorreo(
      { ...t.dependencias, proveedor: { ok: false, error: "No hay proveedor de correo: define RESEND_API_KEY y CORREO_REMITENTE (o MAILPIT_URL en local)." } },
      entrada(),
    );

    expect(resultado).toMatchObject({ ok: false, motivo: "sin_proveedor", intentos: 0 });
    expect(t.enviados).toEqual([]);
    // HU-065: al configurar el proveedor, el proceso programado lo reintenta.
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")).toMatchObject({ estado: "fallido", intentos: 0, reintentable: true });
    expect(t.filas.get("solicitud_llave_reembolso:reembolso-1")?.error).toContain("No hay proveedor de correo");
  });

  it("datos inválidos de la plantilla son un error de quien llama y no dejan una fila a medias", async () => {
    const t = armar();
    await expect(
      enviarCorreo(t.dependencias, entrada({ datos: { ...EJEMPLOS.solicitud_llave_reembolso, nombre: "  " } })),
    ).rejects.toThrow(RangeError);
    expect(t.llamadas).toEqual([]);
    expect(t.enviados).toEqual([]);
  });

  it("un enlace peligroso en los datos también se rechaza antes de reservar", async () => {
    const t = armar();
    await expect(
      enviarCorreo(t.dependencias, entrada({ datos: { ...EJEMPLOS.solicitud_llave_reembolso, enlace: "javascript:alert(1)" } })),
    ).rejects.toThrow(RangeError);
    expect(t.llamadas).toEqual([]);
  });
});

describe("claveDeCorreo", () => {
  it("es la plantilla y la entidad", () => {
    expect(claveDeCorreo("resena_individual", "monitoria-7")).toBe("resena_individual:monitoria-7");
    expect(claveDeCorreo("escalamiento_pago", " pago-1:admin-2:1 ")).toBe("escalamiento_pago:pago-1:admin-2:1");
  });

  it("no acepta una entidad vacía", () => {
    expect(() => claveDeCorreo("resena_individual", "")).toThrow(RangeError);
    expect(() => claveDeCorreo("resena_individual", "   ")).toThrow(RangeError);
  });

  it("admite hasta 256 caracteres, el máximo de la Idempotency-Key de Resend, y no uno más", () => {
    const plantilla: Plantilla = "resena_individual";
    const prefijo = `${plantilla}:`;
    expect(claveDeCorreo(plantilla, "x".repeat(256 - prefijo.length))).toHaveLength(256);
    expect(() => claveDeCorreo(plantilla, "x".repeat(257 - prefijo.length))).toThrow(RangeError);
  });

  it("solo admite ASCII imprimible: la clave viaja como encabezado Idempotency-Key", () => {
    // Un carácter fuera de ASCII (el euro) o un salto de línea haría fallar el encabezado en silencio.
    const euro = String.fromCharCode(0x20ac);
    const eñe = String.fromCharCode(0xf1);
    const salto = String.fromCharCode(10);
    expect(() => claveDeCorreo("resena_individual", `reembolso-${euro}1`)).toThrow(/ASCII/);
    expect(() => claveDeCorreo("resena_individual", `reembolso-${eñe}1`)).toThrow(/ASCII/);
    expect(() => claveDeCorreo("resena_individual", `a${salto}b`)).toThrow(/ASCII/);
    expect(() => claveDeCorreo("resena_individual", `a${String.fromCharCode(9)}b`)).toThrow(/ASCII/);
    expect(claveDeCorreo("escalamiento_pago", "pago-1:admin-2:1 (vuelta 2)")).toBe("escalamiento_pago:pago-1:admin-2:1 (vuelta 2)");
  });
});

describe("el escalamiento vuelve al primer admin (RN-42): la entidad debe cambiar en cada vuelta", () => {
  const escalar = (t: ReturnType<typeof armar>, entidad: string) =>
    enviarCorreo(t.dependencias, {
      plantilla: "escalamiento_pago",
      datos: EJEMPLOS.escalamiento_pago,
      destinatario: "admin@calibra.test",
      entidad,
    });

  it("con la misma entidad pago:admin, la segunda vuelta se descarta como ya enviada", async () => {
    const t = armar();
    await escalar(t, "pago-1:admin-2");
    const segundaVuelta = await escalar(t, "pago-1:admin-2");
    expect(segundaVuelta).toMatchObject({ ok: true, yaEnviado: true });
    expect(t.enviados).toHaveLength(1);
  });

  it("con el número de escalamiento en la entidad, cada vuelta manda su aviso", async () => {
    const t = armar();
    await escalar(t, "pago-1:admin-2:1");
    await escalar(t, "pago-1:admin-1:2");
    await escalar(t, "pago-1:admin-2:3");
    expect(t.enviados.map((c) => c.claveIdempotencia)).toEqual([
      "escalamiento_pago:pago-1:admin-2:1",
      "escalamiento_pago:pago-1:admin-1:2",
      "escalamiento_pago:pago-1:admin-2:3",
    ]);
  });
});
