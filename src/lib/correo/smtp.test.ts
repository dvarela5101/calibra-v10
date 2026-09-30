import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { elegirProveedor, type CorreoSaliente, type Proveedor } from "./proveedor";
import {
  crearProveedorSmtp,
  crearTransporteNodemailer,
  esReintentableEnSmtp,
  leerConfiguracionSmtp,
  messageIdDe,
  type MensajeSmtp,
  type TransporteSmtp,
} from "./smtp";

const CORREO: CorreoSaliente = {
  para: "ana@uniandes.edu.co",
  asunto: "Asunto de prueba",
  html: "<p>Hola</p>",
  texto: "Hola",
  claveIdempotencia: "recuperacion_diagnostico:d-1",
};

const USUARIO = "calibra.monitorias@gmail.com";
const REMITENTE = "Calibra <calibra.monitorias@gmail.com>";
/** Una contraseña de aplicación de Google es de 16 letras; Google la muestra en grupos de 4. */
const CONTRASENA = "abcdefghijklmnop";
const CONTRASENA_CON_ESPACIOS = "abcd efgh ijkl mnop";

const CONFIGURACION = { servidor: "smtp.gmail.com", puerto: 465, usuario: USUARIO, contrasena: CONTRASENA };

/** Un transporte falso: registra los mensajes y contesta (o falla) como se le diga. */
function transporteFalso(comportamiento: (mensaje: MensajeSmtp) => Promise<{ messageId?: string }> | { messageId?: string } = () => ({})) {
  const mensajes: MensajeSmtp[] = [];
  const transporte: TransporteSmtp = {
    async sendMail(mensaje) {
      mensajes.push(mensaje);
      return comportamiento(mensaje);
    },
  };
  return { mensajes, transporte };
}

/** Un error como los de nodemailer: `Error` con `code` y `responseCode`. */
function errorSmtp(mensaje: string, propiedades: { code?: string; responseCode?: number }) {
  return Object.assign(new Error(mensaje), propiedades);
}

describe("esReintentableEnSmtp", () => {
  it.each([
    [400, true],
    [421, true], // servicio no disponible por ahora
    [450, true], // buzón ocupado
    [451, true], // error local, se puede volver a intentar
    [454, true], // fallo temporal de autenticación
    [499, true],
    [500, false],
    [535, false], // contraseña o usuario inválidos
    [550, false], // incluye el límite diario de Gmail: 550 5.4.5
    [554, false],
    [399, false],
    [250, false],
  ])("responseCode %i: reintentable = %s", (responseCode, esperado) => {
    expect(esReintentableEnSmtp({ responseCode })).toBe(esperado);
  });

  it("la autenticación fallida (EAUTH) no se reintenta: fallaría igual al instante", () => {
    expect(esReintentableEnSmtp({ code: "EAUTH" })).toBe(false);
  });

  it.each(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED", "EPIPE"])(
    "el fallo de red %s es pasajero",
    (code) => {
      expect(esReintentableEnSmtp({ code })).toBe(true);
    },
  );

  it.each([{}, { code: "EENVELOPE" }, { code: "EMESSAGE" }, { code: "ALGO_NUEVO" }, { code: 42 }, { code: null }, { responseCode: "421" }])(
    "un fallo que no se reconoce (%j) no se reintenta",
    (error) => {
      expect(esReintentableEnSmtp(error)).toBe(false);
    },
  );

  it("la respuesta SMTP manda sobre el código: un 535 no se reintenta aunque venga como ECONNECTION, y un 421 sí aunque venga como EAUTH", () => {
    expect(esReintentableEnSmtp({ responseCode: 535, code: "ECONNECTION" })).toBe(false);
    expect(esReintentableEnSmtp({ responseCode: 421, code: "EAUTH" })).toBe(true);
    expect(esReintentableEnSmtp({ responseCode: 550, code: "ETIMEDOUT" })).toBe(false);
  });
});

describe("messageIdDe", () => {
  it("es determinista: la misma clave da el mismo Message-ID, así un reintento no cambia de identidad", () => {
    expect(messageIdDe("recuperacion_diagnostico:d-1", USUARIO)).toBe(messageIdDe("recuperacion_diagnostico:d-1", USUARIO));
  });

  it("claves distintas dan Message-ID distintos", () => {
    expect(messageIdDe("recuperacion_diagnostico:d-1", USUARIO)).not.toBe(messageIdDe("recuperacion_diagnostico:d-2", USUARIO));
    expect(messageIdDe("a", USUARIO)).not.toBe(messageIdDe("A", USUARIO));
  });

  it("tiene la forma <32 hex@dominio-del-usuario>", () => {
    expect(messageIdDe("recuperacion_diagnostico:d-1", USUARIO)).toMatch(/^<[0-9a-f]{32}@gmail\.com>$/);
  });

  it("no cambia entre versiones: un reintento tras un despliegue lleva el mismo identificador", () => {
    expect(messageIdDe("recuperacion_diagnostico:d-1", USUARIO)).toBe("<74a2be02222fe2a58ae4642068730c7f@gmail.com>");
  });

  it("no deja ver la clave de idempotencia", () => {
    const id = messageIdDe("recuperacion_diagnostico:d-1", USUARIO);
    expect(id).not.toContain("recuperacion");
    expect(id).not.toContain("diagnostico");
    expect(id).not.toContain("d-1");
  });

  it("el dominio sale de la última @ del usuario; sin @ usa uno local", () => {
    expect(messageIdDe("x", "ana@uniandes.edu.co")).toMatch(/^<[0-9a-f]{32}@uniandes\.edu\.co>$/);
    expect(messageIdDe("x", "raro@nombre@gmail.com")).toMatch(/^<[0-9a-f]{32}@gmail\.com>$/);
    expect(messageIdDe("x", "sin-arroba")).toMatch(/^<[0-9a-f]{32}@calibra\.local>$/);
  });

  it("la huella no depende del usuario, solo de la clave", () => {
    const huella = (id: string) => id.slice(1, id.indexOf("@"));
    expect(huella(messageIdDe("x", USUARIO))).toBe(huella(messageIdDe("x", "otro@uniandes.edu.co")));
  });
});

describe("leerConfiguracionSmtp", () => {
  const COMPLETO = { SMTP_SERVIDOR: "smtp.gmail.com", SMTP_PUERTO: "465", SMTP_USUARIO: USUARIO, SMTP_CONTRASENA: CONTRASENA };

  it("con todas las variables devuelve la configuración", () => {
    expect(leerConfiguracionSmtp(COMPLETO)).toEqual({ ok: true, configuracion: CONFIGURACION });
  });

  it.each(["SMTP_SERVIDOR", "SMTP_USUARIO", "SMTP_CONTRASENA"] as const)("sin %s (ausente, vacía o en blanco) no hay SMTP", (nombre) => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, [nombre]: undefined })).toBeNull();
    expect(leerConfiguracionSmtp({ ...COMPLETO, [nombre]: "" })).toBeNull();
    expect(leerConfiguracionSmtp({ ...COMPLETO, [nombre]: "   " })).toBeNull();
    expect(leerConfiguracionSmtp({ ...COMPLETO, [nombre]: " \t\n " })).toBeNull();
  });

  it("sin ninguna variable no hay SMTP", () => {
    expect(leerConfiguracionSmtp({})).toBeNull();
  });

  it("si falta el puerto usa el 465 de Gmail (TLS)", () => {
    for (const puerto of [undefined, "", "   "]) {
      expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_PUERTO: puerto })).toEqual({ ok: true, configuracion: CONFIGURACION });
    }
  });

  it.each(["587", "25", "2525", "1", "65535", " 587 "])("acepta el puerto %j", (texto) => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_PUERTO: texto })).toMatchObject({
      ok: true,
      configuracion: { puerto: Number(texto.trim()) },
    });
  });

  it("quita los espacios de la contraseña de aplicación como Google la muestra (abcd efgh ijkl mnop)", () => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_CONTRASENA: CONTRASENA_CON_ESPACIOS })).toMatchObject({
      ok: true,
      configuracion: { contrasena: "abcdefghijklmnop" },
    });
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_CONTRASENA: "  abcd\tefgh  ijkl\nmnop  " })).toMatchObject({
      ok: true,
      configuracion: { contrasena: "abcdefghijklmnop" },
    });
  });

  it("una contraseña que solo tiene espacios cuenta como ausente", () => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_CONTRASENA: "    " })).toBeNull();
  });

  it("recorta los espacios del servidor y del usuario", () => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_SERVIDOR: "  smtp.gmail.com ", SMTP_USUARIO: ` ${USUARIO}  ` })).toMatchObject({
      ok: true,
      configuracion: { servidor: "smtp.gmail.com", usuario: USUARIO },
    });
  });

  it.each(["abc", "0", "70000", "65536", "46.5", "-1", "1e3", "0x50", "465 587", "99999999999999999999"])(
    "rechaza el puerto %j con un error que lo dice",
    (texto) => {
      const resultado = leerConfiguracionSmtp({ ...COMPLETO, SMTP_PUERTO: texto });
      expect(resultado).toMatchObject({ ok: false, error: expect.stringContaining("SMTP_PUERTO debe ser un número de puerto") });
      expect(resultado).toMatchObject({ error: expect.stringContaining(`"${texto}"`) });
    },
  );

  it("el error de puerto no arrastra la contraseña", () => {
    const resultado = leerConfiguracionSmtp({ ...COMPLETO, SMTP_PUERTO: "abc" });
    expect(JSON.stringify(resultado)).not.toContain(CONTRASENA);
  });

  it("con el servidor, el usuario o la contraseña vacíos ni siquiera mira el puerto", () => {
    expect(leerConfiguracionSmtp({ ...COMPLETO, SMTP_PUERTO: "abc", SMTP_CONTRASENA: "" })).toBeNull();
  });
});

describe("proveedor SMTP con un transporte inyectado", () => {
  it("se llama smtp", () => {
    expect(crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte: transporteFalso().transporte }).nombre).toBe("smtp");
  });

  it("entrega remitente, destinatario, asunto, HTML, texto y Message-ID tal cual", async () => {
    const { transporte, mensajes } = transporteFalso(() => ({ messageId: "<abc123@gmail.com>" }));
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });

    const resultado = await proveedor.enviar(CORREO);

    expect(resultado).toEqual({ ok: true, idProveedor: "<abc123@gmail.com>" });
    expect(mensajes).toEqual([
      {
        from: "Calibra <calibra.monitorias@gmail.com>",
        to: "ana@uniandes.edu.co",
        subject: "Asunto de prueba",
        html: "<p>Hola</p>",
        text: "Hola",
        messageId: messageIdDe("recuperacion_diagnostico:d-1", USUARIO),
      },
    ]);
  });

  it("si el transporte no devuelve messageId, es un éxito sin id", async () => {
    const { transporte } = transporteFalso(() => ({}));
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    expect(await proveedor.enviar(CORREO)).toEqual({ ok: true, idProveedor: null });
  });

  it("un reintento del mismo correo lleva el mismo Message-ID; otro correo, otro", async () => {
    const { transporte, mensajes } = transporteFalso();
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });

    await proveedor.enviar(CORREO);
    await proveedor.enviar(CORREO);
    await proveedor.enviar({ ...CORREO, claveIdempotencia: "recuperacion_diagnostico:d-2" });

    expect(mensajes[0].messageId).toBe(mensajes[1].messageId);
    expect(mensajes[0].messageId).not.toBe(mensajes[2].messageId);
  });

  it("un 535 (contraseña inválida) no se reintenta y el error no lleva la contraseña", async () => {
    const { transporte } = transporteFalso(() => {
      throw errorSmtp(`Invalid login: 535 5.7.8 Username and Password not accepted (${CONTRASENA})`, { code: "EAUTH", responseCode: 535 });
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });

    const resultado = await proveedor.enviar(CORREO);

    expect(resultado).toEqual({
      ok: false,
      reintentable: false,
      error: "SMTP 535 EAUTH: Invalid login: 535 5.7.8 Username and Password not accepted ([oculto])",
    });
    expect(JSON.stringify(resultado)).not.toContain(CONTRASENA);
  });

  it("un 421 (servicio no disponible) se marca como reintentable", async () => {
    const { transporte } = transporteFalso(() => {
      throw errorSmtp("Service not available", { code: "ECONNECTION", responseCode: 421 });
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true, error: "SMTP 421 ECONNECTION: Service not available" });
  });

  it("el límite diario de Gmail (550 5.4.5) no se reintenta", async () => {
    const { transporte } = transporteFalso(() => {
      throw errorSmtp("Message failed: 550-5.4.5 Daily user sending limit exceeded.", { code: "EENVELOPE", responseCode: 550 });
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: false });
  });

  it("un fallo de red sin respuesta SMTP (ETIMEDOUT) es pasajero", async () => {
    const { transporte } = transporteFalso(() => {
      throw errorSmtp("Connection timeout", { code: "ETIMEDOUT" });
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    expect(await proveedor.enviar(CORREO)).toEqual({ ok: false, reintentable: true, error: "SMTP ETIMEDOUT: Connection timeout" });
  });

  it.each([
    ["un texto", "se cayó la conexión"],
    ["un número", 42],
    ["null", null],
    ["undefined", undefined],
  ])("si lo lanzado no es un objeto (%s), igual devuelve un fallo en vez de romper", async (_nombre, lanzado) => {
    const { transporte } = transporteFalso(() => {
      throw lanzado;
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });

    const resultado = await proveedor.enviar(CORREO);

    expect(resultado).toMatchObject({ ok: false, reintentable: false, error: expect.stringContaining("SMTP sin código:") });
  });

  it("si lo lanzado es un texto con la contraseña, sale con la contraseña borrada", async () => {
    const { transporte } = transporteFalso(() => {
      throw `fallo con ${CONTRASENA} adentro`;
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    const resultado = await proveedor.enviar(CORREO);
    expect(resultado).toEqual({ ok: false, reintentable: false, error: "SMTP sin código: fallo con [oculto] adentro" });
  });

  it("un error sin mensaje sigue siendo un fallo (con lo que haya de código)", async () => {
    const { transporte } = transporteFalso(() => {
      throw { responseCode: 451 };
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true, error: expect.stringContaining("SMTP 451:") });
  });

  it("el error queda en una línea y con un tope de 300 caracteres", async () => {
    const { transporte } = transporteFalso(() => {
      throw errorSmtp(`línea uno\nlínea dos\r\n${"x".repeat(500)}`, { code: "EMESSAGE", responseCode: 554 });
    });
    const proveedor = crearProveedorSmtp({ configuracion: CONFIGURACION, remitente: REMITENTE, transporte });
    const resultado = await proveedor.enviar(CORREO);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toHaveLength(300);
      expect(resultado.error).not.toMatch(/[\r\n]/);
      expect(resultado.error.startsWith("SMTP 554 EMESSAGE: línea uno línea dos")).toBe(true);
    }
  });
});

describe("elegirProveedor con SMTP", () => {
  const SMTP = { SMTP_SERVIDOR: "smtp.gmail.com", SMTP_PUERTO: "465", SMTP_USUARIO: USUARIO, SMTP_CONTRASENA: CONTRASENA };

  it("con las variables de SMTP usa SMTP", () => {
    expect(elegirProveedor(SMTP)).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
  });

  it("no hace falta CORREO_REMITENTE: sale desde el mismo usuario", () => {
    expect(elegirProveedor({ ...SMTP, CORREO_REMITENTE: "" })).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
    expect(elegirProveedor({ ...SMTP, CORREO_REMITENTE: REMITENTE })).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
  });

  it("SMTP gana sobre Resend", () => {
    const eleccion = elegirProveedor({ ...SMTP, RESEND_API_KEY: "re_llave_de_prueba_1234567890", CORREO_REMITENTE: "Calibra <hola@calibra.example>" });
    expect(eleccion).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
  });

  it("SMTP gana sobre Mailpit", () => {
    expect(elegirProveedor({ ...SMTP, MAILPIT_URL: "http://127.0.0.1:54324" })).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
  });

  it("SMTP gana sobre Resend y Mailpit a la vez", () => {
    const eleccion = elegirProveedor({
      ...SMTP,
      RESEND_API_KEY: "re_llave_de_prueba_1234567890",
      CORREO_REMITENTE: "a@b.co",
      MAILPIT_URL: "http://127.0.0.1:54324",
    });
    expect(eleccion).toMatchObject({ ok: true, proveedor: { nombre: "smtp" } });
  });

  it("con las variables de SMTP incompletas cae al siguiente proveedor", () => {
    const sinContrasena = { SMTP_SERVIDOR: "smtp.gmail.com", SMTP_USUARIO: USUARIO };
    expect(elegirProveedor({ ...sinContrasena, MAILPIT_URL: "http://127.0.0.1:54324" })).toMatchObject({ ok: true, proveedor: { nombre: "mailpit" } });
    expect(elegirProveedor({ ...sinContrasena, RESEND_API_KEY: "re_llave_de_prueba_1234567890", CORREO_REMITENTE: "a@b.co" })).toMatchObject({
      ok: true,
      proveedor: { nombre: "resend" },
    });
  });

  it("con las variables de SMTP incompletas y nada más, lo dice en vez de fingir", () => {
    const eleccion = elegirProveedor({ SMTP_SERVIDOR: "smtp.gmail.com", SMTP_USUARIO: USUARIO });
    expect(eleccion).toMatchObject({ ok: false, error: expect.stringContaining("SMTP_SERVIDOR, SMTP_USUARIO y SMTP_CONTRASENA") });
  });

  it.each(["abc", "0", "70000", "46.5"])("con SMTP_PUERTO %j no envía y dice cuál es el problema", (puerto) => {
    const eleccion = elegirProveedor({ ...SMTP, SMTP_PUERTO: puerto });
    expect(eleccion).toEqual({ ok: false, error: `SMTP_PUERTO debe ser un número de puerto (llegó "${puerto}").` });
  });

  it("un puerto inválido no cae a Resend ni a Mailpit: es un error de configuración que se ve", () => {
    const eleccion = elegirProveedor({ ...SMTP, SMTP_PUERTO: "abc", MAILPIT_URL: "http://127.0.0.1:54324" });
    expect(eleccion).toMatchObject({ ok: false, error: expect.stringContaining("SMTP_PUERTO") });
  });
});

// ---------------------------------------------------------------------------------------------
// Protocolo real, sin red: nodemailer habla SMTP con un servidor falso en 127.0.0.1.
// ---------------------------------------------------------------------------------------------

type OpcionesServidor = {
  usuario?: string;
  contrasena?: string;
  /** Lo que contesta al conectarse (por defecto `220 ...`). Si empieza por 4 o 5, cuelga después. */
  saludo?: string;
  respuestaMail?: string;
  respuestaRcpt?: string;
  /** Lo que contesta al terminar el mensaje. */
  respuestaData?: string;
  /** Repite la contraseña recibida dentro del 535, como haría un servidor descuidado. */
  ecoDeLaClave?: boolean;
  /** Métodos de AUTH que anuncia en el EHLO (por defecto `PLAIN LOGIN`). */
  metodosDeAuth?: string;
};

type ServidorFalso = {
  puerto: number;
  /** Cada comando de una línea que llegó (sin el cuerpo del mensaje). */
  comandos: string[];
  /** Usuario y contraseña de cada intento de autenticación. */
  intentos: { usuario: string; contrasena: string }[];
  /** Los mensajes recibidos en DATA, con los encabezados desdoblados. */
  mensajes: string[];
  cerrar(): Promise<void>;
};

const abiertos: ServidorFalso[] = [];

/** Un SMTP mínimo, en claro y sin STARTTLS, con AUTH PLAIN y LOGIN. Exige autenticarse antes de MAIL. */
async function iniciarServidorSmtp(opciones: OpcionesServidor = {}): Promise<ServidorFalso> {
  const { usuario = USUARIO, contrasena = CONTRASENA } = opciones;
  const comandos: string[] = [];
  const intentos: { usuario: string; contrasena: string }[] = [];
  const mensajes: string[] = [];
  const sockets = new Set<Socket>();

  const servidor: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {}); // el cliente puede cortar en cualquier momento
    socket.setEncoding("utf8");

    let pendiente = "";
    let modo: "comando" | "datos" | "plain" | "usuario" | "clave" = "comando";
    let usuarioLogin = "";
    let autenticado = false;
    const responder = (linea: string) => {
      if (!socket.destroyed) socket.write(`${linea}\r\n`);
    };

    const revisarCredenciales = (usuarioRecibido: string, contrasenaRecibida: string) => {
      intentos.push({ usuario: usuarioRecibido, contrasena: contrasenaRecibida });
      if (usuarioRecibido === usuario && contrasenaRecibida === contrasena) {
        autenticado = true;
        responder("235 2.7.0 Accepted");
      } else {
        const eco = opciones.ecoDeLaClave ? ` (llegó ${contrasenaRecibida})` : "";
        responder(`535 5.7.8 Username and Password not accepted${eco}`);
      }
    };

    const credencialesPlain = (base64: string) => {
      const [, usuarioRecibido = "", contrasenaRecibida = ""] = Buffer.from(base64, "base64").toString("utf8").split("\0");
      revisarCredenciales(usuarioRecibido, contrasenaRecibida);
    };

    const procesarLinea = (linea: string) => {
      if (modo === "plain") {
        modo = "comando";
        return credencialesPlain(linea);
      }
      if (modo === "usuario") {
        usuarioLogin = Buffer.from(linea, "base64").toString("utf8");
        modo = "clave";
        return responder("334 UGFzc3dvcmQ6");
      }
      if (modo === "clave") {
        modo = "comando";
        return revisarCredenciales(usuarioLogin, Buffer.from(linea, "base64").toString("utf8"));
      }

      comandos.push(/^AUTH /i.test(linea) ? linea.split(" ").slice(0, 2).join(" ") : linea);
      const auth = /^AUTH PLAIN(?: (\S+))?$/i.exec(linea);
      if (/^EHLO\b/i.test(linea)) {
        // Sin STARTTLS ni PIPELINING: nodemailer manda un comando y espera su respuesta.
        responder("250-fake.local Hola");
        responder(`250 AUTH ${opciones.metodosDeAuth ?? "PLAIN LOGIN"}`);
      } else if (/^HELO\b/i.test(linea)) {
        responder("250 fake.local");
      } else if (auth) {
        if (auth[1]) credencialesPlain(auth[1]);
        else {
          modo = "plain";
          responder("334 ");
        }
      } else if (/^AUTH LOGIN$/i.test(linea)) {
        modo = "usuario";
        responder("334 VXNlcm5hbWU6");
      } else if (/^MAIL FROM:/i.test(linea)) {
        responder(autenticado ? (opciones.respuestaMail ?? "250 2.1.0 OK") : "530 5.7.0 Authentication Required");
      } else if (/^RCPT TO:/i.test(linea)) {
        responder(opciones.respuestaRcpt ?? "250 2.1.5 OK");
      } else if (/^DATA$/i.test(linea)) {
        modo = "datos";
        pendiente = `\r\n${pendiente}`; // centinela para reconocer un mensaje vacío
        responder("354 Adelante");
      } else if (/^(RSET|NOOP)$/i.test(linea)) {
        responder("250 2.0.0 OK");
      } else if (/^QUIT$/i.test(linea)) {
        responder("221 2.0.0 Adiós");
        socket.end();
      } else {
        responder("502 5.5.2 Comando no reconocido");
      }
    };

    socket.on("data", (trozo: string) => {
      pendiente += trozo;
      for (;;) {
        if (modo === "datos") {
          const fin = pendiente.indexOf("\r\n.\r\n");
          if (fin === -1) return;
          const cuerpo = pendiente
            .slice(2, fin)
            .replace(/\r\n\.\./g, "\r\n.") // quita el punto extra de "dot-stuffing"
            .replace(/\r\n[ \t]+/g, " "); // desdobla los encabezados largos
          mensajes.push(cuerpo);
          pendiente = pendiente.slice(fin + 5);
          modo = "comando";
          responder(opciones.respuestaData ?? "250 2.0.0 OK queued");
          continue;
        }
        const salto = pendiente.indexOf("\r\n");
        if (salto === -1) return;
        const linea = pendiente.slice(0, salto);
        pendiente = pendiente.slice(salto + 2);
        procesarLinea(linea);
      }
    });

    if (opciones.saludo && /^[45]/.test(opciones.saludo)) {
      responder(opciones.saludo);
      socket.end();
    } else {
      responder(opciones.saludo ?? "220 fake.local ESMTP listo");
    }
  });

  await new Promise<void>((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => resolver());
  });
  const direccion = servidor.address();
  if (typeof direccion !== "object" || direccion === null) throw new Error("El servidor SMTP falso no obtuvo puerto.");

  const falso: ServidorFalso = {
    puerto: direccion.port,
    comandos,
    intentos,
    mensajes,
    async cerrar() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
  abiertos.push(falso);
  return falso;
}

/** Un proveedor con el transporte real de nodemailer, apuntando al servidor falso. */
function proveedorContra(servidor: ServidorFalso, contrasena = CONTRASENA): Proveedor {
  return crearProveedorSmtp({
    configuracion: { servidor: "127.0.0.1", puerto: servidor.puerto, usuario: USUARIO, contrasena },
    remitente: REMITENTE,
  });
}

describe("SMTP por el protocolo real (servidor falso en 127.0.0.1, sin red)", { timeout: 10_000 }, () => {
  afterEach(async () => {
    await Promise.all(abiertos.splice(0).map((servidor) => servidor.cerrar()));
  });

  it("entrega el correo: autentica, manda el sobre y el mensaje con asunto, remitente, destinatario y Message-ID", async () => {
    const servidor = await iniciarServidorSmtp();

    const resultado = await proveedorContra(servidor).enviar(CORREO);

    expect(resultado).toEqual({ ok: true, idProveedor: messageIdDe(CORREO.claveIdempotencia, USUARIO) });
    expect(servidor.intentos).toEqual([{ usuario: USUARIO, contrasena: CONTRASENA }]);
    expect(servidor.comandos).toEqual(
      expect.arrayContaining(["AUTH PLAIN", `MAIL FROM:<${USUARIO}>`, "RCPT TO:<ana@uniandes.edu.co>", "DATA"]),
    );

    expect(servidor.mensajes).toHaveLength(1);
    const [mensaje] = servidor.mensajes;
    expect(mensaje).toContain("Subject: Asunto de prueba");
    expect(mensaje).toContain("From: Calibra <calibra.monitorias@gmail.com>");
    expect(mensaje).toContain("To: ana@uniandes.edu.co");
    expect(mensaje).toContain(`Message-ID: ${messageIdDe("recuperacion_diagnostico:d-1", USUARIO)}`);
    // La misma plantilla en texto y en HTML.
    expect(mensaje).toContain("Content-Type: text/plain");
    expect(mensaje).toContain("Content-Type: text/html");
    expect(mensaje).toContain("<p>Hola</p>");
    expect(mensaje).toMatch(/\r\nHola\r\n/);
  });

  it("la contraseña de aplicación con espacios (como la copia Google) autentica: el servidor recibe los 16 caracteres juntos", async () => {
    const servidor = await iniciarServidorSmtp();
    const eleccion = elegirProveedor({
      SMTP_SERVIDOR: "127.0.0.1",
      SMTP_PUERTO: String(servidor.puerto),
      SMTP_USUARIO: USUARIO,
      SMTP_CONTRASENA: CONTRASENA_CON_ESPACIOS,
      CORREO_REMITENTE: REMITENTE,
    });
    if (!eleccion.ok) throw new Error(eleccion.error);

    expect(await eleccion.proveedor.enviar(CORREO)).toMatchObject({ ok: true });
    expect(servidor.intentos).toEqual([{ usuario: USUARIO, contrasena: "abcdefghijklmnop" }]);
  });

  it("sin CORREO_REMITENTE el correo sale como Calibra desde el propio usuario de SMTP", async () => {
    const servidor = await iniciarServidorSmtp();
    const eleccion = elegirProveedor({
      SMTP_SERVIDOR: "127.0.0.1",
      SMTP_PUERTO: String(servidor.puerto),
      SMTP_USUARIO: USUARIO,
      SMTP_CONTRASENA: CONTRASENA,
    });
    if (!eleccion.ok) throw new Error(eleccion.error);

    expect(await eleccion.proveedor.enviar(CORREO)).toMatchObject({ ok: true });
    expect(servidor.comandos).toContain(`MAIL FROM:<${USUARIO}>`);
    expect(servidor.mensajes[0]).toContain(`From: Calibra <${USUARIO}>`);
  });

  it("con CORREO_REMITENTE el correo sale con ese nombre y dirección", async () => {
    const servidor = await iniciarServidorSmtp();
    const eleccion = elegirProveedor({
      SMTP_SERVIDOR: "127.0.0.1",
      SMTP_PUERTO: String(servidor.puerto),
      SMTP_USUARIO: USUARIO,
      SMTP_CONTRASENA: CONTRASENA,
      CORREO_REMITENTE: REMITENTE,
    });
    if (!eleccion.ok) throw new Error(eleccion.error);

    await eleccion.proveedor.enviar(CORREO);
    expect(servidor.mensajes[0]).toContain("From: Calibra <calibra.monitorias@gmail.com>");
  });

  it("también autentica con AUTH LOGIN si el servidor no ofrece PLAIN", async () => {
    // Un servidor que solo anuncia LOGIN: nodemailer elige el método por lo que se anuncia.
    const servidor = await iniciarServidorSmtp({ metodosDeAuth: "LOGIN" });

    expect(await proveedorContra(servidor).enviar(CORREO)).toMatchObject({ ok: true });
    expect(servidor.comandos).toContain("AUTH LOGIN");
    expect(servidor.comandos).not.toContain("AUTH PLAIN");
    expect(servidor.intentos).toEqual([{ usuario: USUARIO, contrasena: CONTRASENA }]);
  });

  it("AUTH LOGIN con contraseña equivocada tampoco se reintenta", async () => {
    const servidor = await iniciarServidorSmtp({ metodosDeAuth: "LOGIN" });
    expect(await proveedorContra(servidor, "clave-incorrecta-4321").enviar(CORREO)).toMatchObject({ ok: false, reintentable: false });
  });

  it("una contraseña equivocada: falla, no se reintenta y el error no lleva la contraseña", async () => {
    const servidor = await iniciarServidorSmtp();
    const equivocada = "clave-incorrecta-4321";

    const resultado = await proveedorContra(servidor, equivocada).enviar(CORREO);

    expect(resultado).toMatchObject({ ok: false, reintentable: false });
    expect(servidor.mensajes).toEqual([]);
    expect(servidor.intentos).toEqual([{ usuario: USUARIO, contrasena: equivocada }]);
    if (resultado.ok) throw new Error("Debía fallar.");
    expect(resultado.error).toContain("535");
    expect(resultado.error).not.toContain(equivocada);
    expect(resultado.error).not.toContain(Buffer.from(`\0${USUARIO}\0${equivocada}`).toString("base64"));
    expect(resultado.error).not.toMatch(/[\r\n]/);
  });

  it("si el servidor repite la contraseña dentro de su 535, el error sale con la contraseña borrada", async () => {
    const servidor = await iniciarServidorSmtp({ ecoDeLaClave: true });
    const equivocada = "clave-incorrecta-4321";

    const resultado = await proveedorContra(servidor, equivocada).enviar(CORREO);

    expect(resultado).toMatchObject({ ok: false, reintentable: false, error: expect.stringContaining("[oculto]") });
    expect(JSON.stringify(resultado)).not.toContain(equivocada);
  });

  it("un usuario equivocado tampoco se reintenta", async () => {
    const servidor = await iniciarServidorSmtp({ usuario: "otra.cuenta@gmail.com" });
    expect(await proveedorContra(servidor).enviar(CORREO)).toMatchObject({ ok: false, reintentable: false });
  });

  it("un 421 al conectarse (servicio no disponible) es pasajero", async () => {
    const servidor = await iniciarServidorSmtp({ saludo: "421 4.3.2 Servicio no disponible, intenta más tarde" });
    const resultado = await proveedorContra(servidor).enviar(CORREO);
    expect(resultado).toMatchObject({ ok: false, reintentable: true });
    expect(servidor.mensajes).toEqual([]);
  });

  it("un 554 al conectarse (rechaza la conexión) no se reintenta", async () => {
    const servidor = await iniciarServidorSmtp({ saludo: "554 5.3.2 No hay servicio para ti" });
    expect(await proveedorContra(servidor).enviar(CORREO)).toMatchObject({ ok: false, reintentable: false });
  });

  it("un 421 en MAIL FROM es pasajero", async () => {
    const servidor = await iniciarServidorSmtp({ respuestaMail: "421 4.7.0 Demasiadas conexiones, intenta más tarde" });
    const resultado = await proveedorContra(servidor).enviar(CORREO);
    expect(resultado).toMatchObject({ ok: false, reintentable: true });
    expect(servidor.mensajes).toEqual([]);
  });

  it("un 451 al recibir el mensaje es pasajero", async () => {
    const servidor = await iniciarServidorSmtp({ respuestaData: "451 4.3.0 Error local, vuelve a intentar" });
    expect(await proveedorContra(servidor).enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });

  it("el límite diario de Gmail (550 5.4.5 al terminar el mensaje) no se reintenta", async () => {
    const servidor = await iniciarServidorSmtp({ respuestaData: "550 5.4.5 Daily user sending limit exceeded." });
    const resultado = await proveedorContra(servidor).enviar(CORREO);
    expect(resultado).toMatchObject({ ok: false, reintentable: false, error: expect.stringContaining("550") });
  });

  it("un destinatario rechazado (550 en RCPT TO) no se reintenta; uno con 451, sí", async () => {
    const rechazado = await iniciarServidorSmtp({ respuestaRcpt: "550 5.1.1 El buzón no existe" });
    expect(await proveedorContra(rechazado).enviar(CORREO)).toMatchObject({ ok: false, reintentable: false });

    const temporal = await iniciarServidorSmtp({ respuestaRcpt: "451 4.7.1 Intenta más tarde (greylisting)" });
    expect(await proveedorContra(temporal).enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });

  it("si nadie escucha en el puerto, es un fallo de red pasajero", async () => {
    const servidor = await iniciarServidorSmtp();
    const proveedor = proveedorContra(servidor);
    await servidor.cerrar(); // el puerto queda libre y sin nadie escuchando

    expect(await proveedor.enviar(CORREO)).toMatchObject({ ok: false, reintentable: true });
  });
});

describe("crearTransporteNodemailer: la contraseña nunca viaja en claro", () => {
  /** Opciones con las que nodemailer abrirá la conexión (no conecta al crearlo). */
  const opciones = (servidor: string, puerto: number) =>
    (crearTransporteNodemailer({ servidor, puerto, usuario: "a@b.co", contrasena: "x" }) as unknown as {
      transporter: { options: { secure?: boolean; requireTLS?: boolean } };
    }).transporter.options;

  it("en 465 usa TLS desde el primer byte", () => {
    expect(opciones("smtp.gmail.com", 465)).toMatchObject({ secure: true, requireTLS: false });
  });

  it("en otro puerto exige STARTTLS", () => {
    expect(opciones("smtp.gmail.com", 587)).toMatchObject({ secure: false, requireTLS: true });
  });

  it.each(["127.0.0.1", "localhost", "::1"])("contra esta máquina (%s) no lo exige: es el servidor falso de las pruebas", (servidor) => {
    expect(opciones(servidor, 2525)).toMatchObject({ secure: false, requireTLS: false });
  });
});
