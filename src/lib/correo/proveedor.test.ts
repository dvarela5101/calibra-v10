import { describe, expect, it } from "vitest";
import {
  crearProveedorMailpit,
  crearProveedorResend,
  elegirProveedor,
  esReintentableEnResend,
  esUrlLocal,
  limpiarError,
  separarRemitente,
  type CorreoSaliente,
} from "./proveedor";

const CORREO: CorreoSaliente = {
  para: "ana@uniandes.edu.co",
  asunto: "Asunto de prueba",
  html: "<p>Hola</p>",
  texto: "Hola",
  claveIdempotencia: "recuperacion_diagnostico:d-1",
};

const LLAVE = "re_llave_de_prueba_1234567890";

type Peticion = { url: string; metodo?: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> };

/** Un fetch falso: registra lo que se le pide y contesta lo que se le diga. */
function fetchFalso(respuesta: () => Response | Promise<Response>) {
  const peticiones: Peticion[] = [];
  const impl = (async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    peticiones.push({
      url: String(entrada),
      metodo: opciones?.method,
      cabeceras: (opciones?.headers ?? {}) as Record<string, string>,
      cuerpo: JSON.parse(String(opciones?.body ?? "{}")),
    });
    return respuesta();
  }) as typeof fetch;
  return { impl, peticiones };
}

const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

describe("limpiarError", () => {
  it("deja una sola línea y quita los espacios sobrantes", () => {
    expect(limpiarError("  algo\nsalió\r\n   mal  ")).toBe("algo salió mal");
  });

  it("borra la llave y cualquier otro secreto, aunque aparezcan varias veces", () => {
    expect(limpiarError(`llave ${LLAVE} inválida (${LLAVE})`, [LLAVE])).toBe("llave [oculto] inválida ([oculto])");
    expect(limpiarError("a X-1 b Y-2", ["X-1", "Y-2"])).toBe("a [oculto] b [oculto]");
  });

  it("ignora un secreto vacío en vez de llenar el texto de [oculto]", () => {
    expect(limpiarError("hola", [""])).toBe("hola");
  });

  it("corta a 300 caracteres y lo marca", () => {
    const largo = limpiarError("x".repeat(500));
    expect(largo).toHaveLength(300);
    expect(largo.endsWith("…")).toBe(true);
    expect(limpiarError("x".repeat(300))).toHaveLength(300);
    expect(limpiarError("x".repeat(300)).endsWith("…")).toBe(false);
  });
});

describe("Resend: qué se reintenta (documentación de errores de Resend)", () => {
  it.each([
    [500, "application_error", true],
    [503, "service_unavailable", true],
    [502, undefined, true], // una pasarela caída no trae el JSON de Resend
    [429, "rate_limit_exceeded", true],
    [409, "concurrent_idempotent_requests", true],
    [409, "resource_locked", true],
    [429, "daily_quota_exceeded", false],
    [429, "monthly_quota_exceeded", false],
    [409, "invalid_idempotent_request", false],
    [400, "validation_error", false],
    [400, "invalid_idempotency_key", false],
    [401, "missing_api_key", false],
    [401, "restricted_api_key", false],
    [403, "email_above_quota", false],
    [403, "invalid_permission", false],
    [403, "suspended_api_key", false],
    [404, "not_found", false],
    [405, "method_not_allowed", false],
    [422, "invalid_parameter", false],
    [422, "missing_required_field", false],
    [429, undefined, false],
    [409, undefined, false],
  ])("%i %s: reintentable = %s", (estado, nombre, esperado) => {
    expect(esReintentableEnResend(estado, nombre)).toBe(esperado);
  });
});

describe("proveedor Resend", () => {
  const armar = (respuesta: () => Response | Promise<Response>) => {
    const { impl, peticiones } = fetchFalso(respuesta);
    return { peticiones, proveedor: crearProveedorResend({ apiKey: LLAVE, remitente: "Calibra <hola@calibra.example>", fetchImpl: impl }) };
  };

  it("hace POST a /emails con la llave, la Idempotency-Key y el correo en JSON", async () => {
    const { proveedor, peticiones } = armar(() => json({ id: "re-123" }));
    const resultado = await proveedor.enviar(CORREO);

    expect(resultado).toEqual({ ok: true, idProveedor: "re-123" });
    expect(peticiones).toHaveLength(1);
    const [peticion] = peticiones;
    expect(peticion.url).toBe("https://api.resend.com/emails");
    expect(peticion.metodo).toBe("POST");
    expect(peticion.cabeceras).toEqual({
      Authorization: `Bearer ${LLAVE}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "recuperacion_diagnostico:d-1",
    });
    expect(peticion.cuerpo).toEqual({
      from: "Calibra <hola@calibra.example>",
      to: ["ana@uniandes.edu.co"],
      subject: "Asunto de prueba",
      html: "<p>Hola</p>",
      text: "Hola",
    });
  });

  it("si la respuesta no trae id, igual es un éxito (sin id)", async () => {
    const { proveedor } = armar(() => json({}));
    expect(await proveedor.enviar(CORREO)).toEqual({ ok: true, idProveedor: null });
  });

  it("un error definitivo (400) no se reintenta y dice qué fue", async () => {
    const { proveedor } = armar(() => json({ name: "validation_error", message: "The `from` address is invalid." }, 400));
    const resultado = await proveedor.enviar(CORREO);
    expect(resultado).toEqual({ ok: false, reintentable: false, error: "Resend 400 validation_error: The `from` address is invalid." });
  });

  it("un error pasajero (503) se marca como reintentable", async () => {
    const { proveedor } = armar(() => json({ name: "service_unavailable", message: "Vuelve en un rato" }, 503));
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });

  it("un error con la llave dentro del mensaje sale con la llave borrada", async () => {
    const { proveedor } = armar(() => json({ name: "restricted_api_key", message: `La llave ${LLAVE} no puede enviar` }, 401));
    const resultado = await proveedor.enviar(CORREO);
    expect(resultado.ok).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain(LLAVE);
    expect(resultado).toMatchObject({ error: "Resend 401 restricted_api_key: La llave [oculto] no puede enviar" });
  });

  it("una respuesta que no es JSON (una pasarela) no rompe: se lee como fallo pasajero", async () => {
    const { proveedor } = armar(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await proveedor.enviar(CORREO)).toEqual({ ok: false, reintentable: true, error: "Resend 502 sin nombre: sin detalle" });
  });

  it("si la red falla, es pasajero y el mensaje no lleva la llave", async () => {
    const { proveedor } = armar(() => {
      throw new TypeError(`fetch failed (Authorization: Bearer ${LLAVE})`);
    });
    const resultado = await proveedor.enviar(CORREO);
    expect(resultado).toMatchObject({ ok: false, reintentable: true });
    expect(JSON.stringify(resultado)).not.toContain(LLAVE);
    expect(resultado).toMatchObject({ error: expect.stringContaining("Resend no respondió") });
  });

  it("un tiempo agotado (AbortError) es pasajero", async () => {
    const { proveedor } = armar(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });

  it("pasa una señal con tiempo máximo: no espera al proveedor para siempre", async () => {
    let senal: AbortSignal | null | undefined;
    const impl = (async (_url: RequestInfo | URL, opciones?: RequestInit) => {
      senal = opciones?.signal;
      return json({ id: "x" });
    }) as typeof fetch;
    await crearProveedorResend({ apiKey: LLAVE, remitente: "a@b.co", fetchImpl: impl }).enviar(CORREO);
    expect(senal).toBeInstanceOf(AbortSignal);
  });
});

describe("separarRemitente", () => {
  it.each([
    ["Calibra <hola@calibra.example>", { Name: "Calibra", Email: "hola@calibra.example" }],
    ['"Calibra, Inc." <hola@calibra.example>', { Name: "Calibra, Inc.", Email: "hola@calibra.example" }],
    ["hola@calibra.example", { Email: "hola@calibra.example" }],
    ["<hola@calibra.example>", { Email: "hola@calibra.example" }],
    ["  Calibra   <hola@calibra.example>  ", { Name: "Calibra", Email: "hola@calibra.example" }],
  ])("%j", (entrada, esperado) => {
    expect(separarRemitente(entrada)).toEqual(esperado);
  });
});

describe("proveedor Mailpit (solo local)", () => {
  it("hace POST a /api/v1/send con el correo en el formato de Mailpit", async () => {
    const { impl, peticiones } = fetchFalso(() => json({ ID: "mp-1" }));
    const proveedor = crearProveedorMailpit({ url: "http://127.0.0.1:54324/", remitente: "Calibra <no-responder@calibra.test>", fetchImpl: impl });
    const resultado = await proveedor.enviar(CORREO);

    expect(resultado).toEqual({ ok: true, idProveedor: "mp-1" });
    expect(peticiones[0].url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(peticiones[0].metodo).toBe("POST");
    expect(peticiones[0].cuerpo).toEqual({
      From: { Name: "Calibra", Email: "no-responder@calibra.test" },
      To: [{ Email: "ana@uniandes.edu.co" }],
      Subject: "Asunto de prueba",
      Text: "Hola",
      HTML: "<p>Hola</p>",
    });
  });

  it("un 5xx es pasajero; un 4xx, no", async () => {
    for (const [estado, reintentable] of [
      [500, true],
      [503, true],
      [400, false],
      [404, false],
    ] as const) {
      const { impl } = fetchFalso(() => json({ Error: "x" }, estado));
      const proveedor = crearProveedorMailpit({ url: "http://localhost:54324", remitente: "a@b.co", fetchImpl: impl });
      expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable });
    }
  });

  it("si Mailpit no responde, es pasajero", async () => {
    const { impl } = fetchFalso(() => {
      throw new TypeError("fetch failed");
    });
    const proveedor = crearProveedorMailpit({ url: "http://127.0.0.1:1", remitente: "a@b.co", fetchImpl: impl });
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });

  it.each(["https://mailpit.example.com", "http://10.0.0.5:54324", "http://192.168.1.10", "no es una url", ""])(
    "se niega a usar %j: Mailpit no es para producción",
    (url) => {
      expect(() => crearProveedorMailpit({ url, remitente: "a@b.co" })).toThrow(RangeError);
    },
  );

  it("esUrlLocal solo acepta esta máquina", () => {
    expect(esUrlLocal("http://127.0.0.1:54324")).toBe(true);
    expect(esUrlLocal("http://localhost:54324")).toBe(true);
    expect(esUrlLocal("http://[::1]:54324")).toBe(true);
    expect(esUrlLocal("http://127.0.0.1.evil.com")).toBe(false);
    expect(esUrlLocal("http://localhost.evil.com")).toBe(false);
  });
});

describe("elegirProveedor", () => {
  it("con RESEND_API_KEY y CORREO_REMITENTE usa Resend", () => {
    const eleccion = elegirProveedor({ RESEND_API_KEY: LLAVE, CORREO_REMITENTE: "Calibra <hola@calibra.example>" });
    expect(eleccion).toMatchObject({ ok: true, proveedor: { nombre: "resend" } });
  });

  it("con la llave pero sin remitente no envía: Resend solo deja enviar desde un dominio verificado", () => {
    expect(elegirProveedor({ RESEND_API_KEY: LLAVE })).toEqual({
      ok: false,
      error: "Falta CORREO_REMITENTE: Resend solo envía desde un remitente de un dominio verificado.",
    });
  });

  it("sin llave y con Mailpit local usa Mailpit, con un remitente de prueba por defecto", () => {
    expect(elegirProveedor({ MAILPIT_URL: "http://127.0.0.1:54324" })).toMatchObject({ ok: true, proveedor: { nombre: "mailpit" } });
  });

  it("la llave gana sobre Mailpit", () => {
    const eleccion = elegirProveedor({ RESEND_API_KEY: LLAVE, CORREO_REMITENTE: "a@b.co", MAILPIT_URL: "http://127.0.0.1:54324" });
    expect(eleccion).toMatchObject({ ok: true, proveedor: { nombre: "resend" } });
  });

  it("una MAILPIT_URL que no es de esta máquina no cuenta como proveedor", () => {
    expect(elegirProveedor({ MAILPIT_URL: "https://mailpit.example.com" })).toMatchObject({ ok: false });
  });

  it.each([{}, { RESEND_API_KEY: "" }, { RESEND_API_KEY: "   ", MAILPIT_URL: "  " }, { CORREO_REMITENTE: "a@b.co" }])(
    "sin nada configurado (%j) lo dice en vez de fingir que envió",
    (entorno) => {
      expect(elegirProveedor(entorno)).toEqual({
        ok: false,
        error: "No hay proveedor de correo: define RESEND_API_KEY y CORREO_REMITENTE (o MAILPIT_URL en local).",
      });
    },
  );
});

describe("Resend por el camino completo: de la respuesta HTTP a reintentable", () => {
  const armar = (estado: number, nombre: string) => {
    const { impl } = fetchFalso(() => json({ name: nombre, message: "detalle" }, estado));
    return crearProveedorResend({ apiKey: LLAVE, remitente: "a@b.co", fetchImpl: impl });
  };

  it.each([
    [429, "rate_limit_exceeded", true],
    [409, "concurrent_idempotent_requests", true],
    [409, "resource_locked", true],
    [500, "application_error", true],
    [429, "daily_quota_exceeded", false],
    [429, "monthly_quota_exceeded", false],
    [409, "invalid_idempotent_request", false],
    [401, "missing_api_key", false],
    [401, "restricted_api_key", false],
    [403, "invalid_permission", false],
    [422, "invalid_parameter", false],
  ])("%i %s: el proveedor lo marca reintentable = %s", async (estado, nombre, esperado) => {
    expect(await armar(estado, nombre).enviar(CORREO)).toMatchObject({ ok: false, reintentable: esperado });
  });
});

describe("tiempo máximo de cada envío", () => {
  it("Resend y Mailpit piden una señal que se aborta a los 10 segundos", async () => {
    const tiempos: number[] = [];
    const original = AbortSignal.timeout;
    AbortSignal.timeout = (milisegundos: number) => {
      tiempos.push(milisegundos);
      return original.call(AbortSignal, milisegundos);
    };
    try {
      const { impl } = fetchFalso(() => json({ id: "x", ID: "y" }));
      await crearProveedorResend({ apiKey: LLAVE, remitente: "a@b.co", fetchImpl: impl }).enviar(CORREO);
      await crearProveedorMailpit({ url: "http://127.0.0.1:54324", remitente: "a@b.co", fetchImpl: impl }).enviar(CORREO);
    } finally {
      AbortSignal.timeout = original;
    }
    expect(tiempos).toEqual([10_000, 10_000]);
  });
});
