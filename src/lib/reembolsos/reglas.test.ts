import { describe, expect, it } from "vitest";
import { renderizar } from "@/lib/correo/plantillas";
import {
  avisoDeReabrir,
  datosDelPedido,
  datosDelRecordatorio,
  esResultadoDeEntregar,
  esResultadoDeReabrir,
  LARGO_MAXIMO_LLAVE,
  llaveDeFila,
  mensajeDeEntregar,
  MENSAJES_DE_ENTREGAR,
  MOTIVO_CANCELACION_A_TIEMPO,
  normalizarLlave,
  pedidoVigente,
  plantillaDelPedido,
  RESULTADOS_DE_ENTREGAR,
  RESULTADOS_DE_REABRIR,
  RUTA_DE_LLAVE,
  rutaDeLlave,
  TEXTO_PAGO_EN_REVISION_AL_CANCELAR,
  textoDeLlaveYaEntregadaOtra,
  tieneFormaDeTokenDeLlave,
  TIPOS_DE_PEDIDO,
  validarLlaveDeReembolso,
  vistaDeLaLlave,
  vuelveALaPagina,
  type LlaveDeReembolso,
  type PedidoDeLlave,
} from "./reglas";

const TOKEN = "e".repeat(64);

describe("el enlace de la llave (HU-024, D-27)", () => {
  it("la ruta lleva el token en la consulta, para la página de HU-025", () => {
    expect(RUTA_DE_LLAVE).toBe("/reembolso");
    expect(rutaDeLlave(TOKEN)).toBe(`/reembolso?token=${TOKEN}`);
  });

  it("reconoce 64 hexadecimales en minúscula y nada más", () => {
    expect(tieneFormaDeTokenDeLlave(TOKEN)).toBe(true);
    expect(tieneFormaDeTokenDeLlave("0123456789abcdef".repeat(4))).toBe(true);
    for (const malo of ["E".repeat(64), "e".repeat(63), "e".repeat(65), `${"e".repeat(63)}\n`, `${"e".repeat(63)}g`, "", " ".repeat(64)]) {
      expect(tieneFormaDeTokenDeLlave(malo), JSON.stringify(malo)).toBe(false);
    }
    expect(tieneFormaDeTokenDeLlave(undefined)).toBe(false);
    expect(tieneFormaDeTokenDeLlave(null)).toBe(false);
    // `?token=a&token=b` llega como lista: no es un token.
    expect(tieneFormaDeTokenDeLlave([TOKEN, TOKEN])).toBe(false);
  });
});

describe("los textos fijos del reembolso al cancelar", () => {
  it("el motivo es el de D-26, exacto", () => {
    expect(MOTIVO_CANCELACION_A_TIEMPO).toBe("Cancelaste la monitoría dentro del plazo.");
  });

  it("el pago en revisión explica las dos salidas (D-27), sin cifras de comisión", () => {
    expect(TEXTO_PAGO_EN_REVISION_AL_CANCELAR).toBe(
      "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.",
    );
    expect(TEXTO_PAGO_EN_REVISION_AL_CANCELAR).not.toMatch(/comisi|neto/i);
  });
});

describe("la llave (HU-025, supuesto 3)", () => {
  it("se normaliza como la del monitor: los espacios seguidos cuentan como uno y no quedan en los bordes", () => {
    expect(normalizarLlave("  300 123\t4567 \n")).toBe("300 123 4567");
    expect(normalizarLlave("ana@banco.co")).toBe("ana@banco.co");
    expect(normalizarLlave(" \n\t ")).toBe("");
    // Lo que no es texto (un archivo, nada) es una llave vacía.
    for (const raro of [null, undefined, 3, new Blob(["x"])]) expect(normalizarLlave(raro)).toBe("");
  });

  it("vacía no sirve", () => {
    expect(validarLlaveDeReembolso("")).toBe("Escribe tu llave para que podamos devolverte el dinero.");
  });

  it("sirve de 1 a 200 caracteres, con el borde incluido", () => {
    expect(LARGO_MAXIMO_LLAVE).toBe(200);
    expect(validarLlaveDeReembolso("a")).toBeNull();
    expect(validarLlaveDeReembolso("a".repeat(200))).toBeNull();
    expect(validarLlaveDeReembolso("a".repeat(201))).toBe("La llave es demasiado larga: puede tener hasta 200 caracteres.");
  });

  it("cuenta caracteres como la base (char_length), no unidades de JavaScript", () => {
    // Cada 𝔸 son dos unidades de JavaScript y un solo carácter para Postgres.
    expect("𝔸".repeat(200).length).toBe(400);
    expect(validarLlaveDeReembolso("𝔸".repeat(200))).toBeNull();
    expect(validarLlaveDeReembolso("𝔸".repeat(201))).not.toBeNull();
  });
});

describe("lo que responde la base al entregar la llave (criterio 2)", () => {
  it("reconoce los seis resultados y nada más", () => {
    expect([...RESULTADOS_DE_ENTREGAR].sort()).toEqual(["cerrado", "entregada", "llave_invalida", "no_existe", "ya_entregada", "ya_entregada_otra"]);
    for (const resultado of RESULTADOS_DE_ENTREGAR) expect(esResultadoDeEntregar(resultado)).toBe(true);
    for (const raro of ["", "pendiente", "ENTREGADA", "ya_entregada_otro", null, undefined, 1, ["entregada"]]) {
      expect(esResultadoDeEntregar(raro), JSON.stringify(raro)).toBe(false);
    }
  });

  it("con la llave guardada (ahora, o antes y es la misma) o el caso cerrado se vuelve a la página; con lo demás se explica", () => {
    expect(RESULTADOS_DE_ENTREGAR.filter(vuelveALaPagina).sort()).toEqual(["cerrado", "entregada", "ya_entregada"]);
    expect(MENSAJES_DE_ENTREGAR).toEqual({
      llave_invalida: "Revisa tu llave: no puede quedar vacía y puede tener hasta 200 caracteres.",
      no_existe: "Este enlace no sirve. Abre de nuevo el enlace del correo que te mandamos.",
    });
    expect(mensajeDeEntregar("llave_invalida", "ayuda@calibra.test")).toBe(MENSAJES_DE_ENTREGAR.llave_invalida);
    expect(mensajeDeEntregar("no_existe")).toBe(MENSAJES_DE_ENTREGAR.no_existe);
  });

  it("supuesto 3: una llave distinta de la guardada no vuelve a la página (diría «Recibimos tu llave»): dice que no se cambió y a quién escribir", () => {
    expect(vuelveALaPagina("ya_entregada_otra")).toBe(false);
    expect(mensajeDeEntregar("ya_entregada_otra", "ayuda@calibra.test")).toBe(
      "Ya teníamos una llave para este reembolso y no la cambiamos. Si quieres corregirla, escríbenos a ayuda@calibra.test.",
    );
    expect(textoDeLlaveYaEntregadaOtra("  ayuda@calibra.test  ")).toBe(
      "Ya teníamos una llave para este reembolso y no la cambiamos. Si quieres corregirla, escríbenos a ayuda@calibra.test.",
    );
    // Sin correo de soporte no promete un canal que no existe.
    for (const vacio of [null, "", "   ", undefined]) {
      expect(mensajeDeEntregar("ya_entregada_otra", vacio), JSON.stringify(vacio)).toBe("Ya teníamos una llave para este reembolso y no la cambiamos.");
    }
    expect(mensajeDeEntregar("ya_entregada_otra")).not.toMatch(/recibimos/i);
  });
});

describe("la página de la llave", () => {
  const VENCE = new Date("2026-10-10T20:00:00.000Z");
  const llave = (estado: LlaveDeReembolso["estado"]): LlaveDeReembolso => ({ estado, monto: 32_000, motivo: "Cancelaste la monitoría dentro del plazo.", venceEn: VENCE });
  const plano = (texto: string | null) => (texto ?? "").replace(/[  ]/g, " ");

  it("lee la fila de la base y lanza con un estado que no conoce o una fecha inválida", () => {
    expect(llaveDeFila({ estado: "cerrado", monto: 5, motivo: "m", vence_en: "2026-10-10T20:00:00.123456+00:00" })).toEqual({
      estado: "cerrado",
      monto: 5,
      motivo: "m",
      venceEn: new Date("2026-10-10T20:00:00.123Z"),
    });
    expect(() => llaveDeFila({ estado: "perdido", monto: 5, motivo: "m", vence_en: "2026-10-10T20:00:00Z" })).toThrow("Estado de la llave desconocido");
    expect(() => llaveDeFila({ estado: "pendiente", monto: 5, motivo: "m", vence_en: "nunca" })).toThrow("vence_en");
  });

  it("esperando la llave pide la llave, dice qué sirve como llave y avisa que no se cambia desde el enlace", () => {
    const vista = vistaDeLaLlave(llave("esperando_llave"), "ayuda@calibra.example");
    expect(vista.titulo).toBe("Envíanos tu llave");
    expect(plano(vista.texto)).toBe("Para devolverte $ 32.000 necesitamos tu llave: tu celular, tu correo o el alias que tengas registrado en tu banco.");
    expect(vista.nota).toBe(
      "Revísala antes de enviarla: desde este enlace no se puede cambiar después. Si te equivocas, escríbenos a ayuda@calibra.example.",
    );
  });

  it("con la llave recibida dice que no hay que hacer nada más, sin mostrarla", () => {
    const vista = vistaDeLaLlave(llave("pendiente"), "ayuda@calibra.example");
    expect(vista.titulo).toBe("Recibimos tu llave");
    expect(plano(vista.texto)).toBe("Te vamos a transferir $ 32.000. No tienes que hacer nada más.");
    expect(vista.nota).toBe("Si te equivocaste al escribirla, escríbenos a ayuda@calibra.example.");
  });

  it("reembolsado dice que ya se devolvió el dinero", () => {
    const vista = vistaDeLaLlave(llave("reembolsado"), "ayuda@calibra.example");
    expect(vista.titulo).toBe("Ya te devolvimos el dinero");
    expect(plano(vista.texto)).toBe("Transferimos $ 32.000 a la llave que nos diste.");
    expect(vista.nota).toBeNull();
  });

  it("cerrado dice cuándo terminó el plazo, en Bogotá, y que un admin puede reabrirlo (P-10, supuesto 4)", () => {
    const vista = vistaDeLaLlave(llave("cerrado"), "ayuda@calibra.example");
    expect(vista.titulo).toBe("Este caso se cerró");
    // 20:00 UTC son las 3:00 p. m. en Bogotá.
    expect(plano(vista.texto)).toBe("El plazo para enviarnos tu llave terminó el sábado, 10 de octubre de 2026, 3:00 p. m., así que cerramos el caso.");
    expect(vista.nota).toBe("Si todavía necesitas el reembolso, escríbenos a ayuda@calibra.example: un admin puede reabrirlo.");
  });

  it("sin correo de soporte no promete un canal en ningún estado", () => {
    for (const contacto of [null, "", "   "]) {
      for (const estado of ["esperando_llave", "pendiente", "reembolsado", "cerrado"] as const) {
        const vista = vistaDeLaLlave(llave(estado), contacto);
        expect(`${vista.texto} ${vista.nota ?? ""}`, `${estado} ${JSON.stringify(contacto)}`).not.toContain("escríbenos");
      }
    }
    expect(vistaDeLaLlave(llave("cerrado")).nota).toBe("Si todavía necesitas el reembolso, un admin puede reabrirlo.");
    expect(vistaDeLaLlave(llave("pendiente")).nota).toBeNull();
  });

  it("ningún texto habla de comisión", () => {
    for (const estado of ["esperando_llave", "pendiente", "reembolsado", "cerrado"] as const) {
      const vista = vistaDeLaLlave(llave(estado), "ayuda@calibra.example");
      expect(`${vista.titulo} ${vista.texto} ${vista.nota ?? ""}`).not.toMatch(/comisi|neto/i);
    }
  });
});

describe("los correos que piden la llave (P-10, supuesto 2, D-37)", () => {
  const DESDE = "2026-10-01T15:00:00.000Z";
  const VENCE = "2026-10-08T15:00:00.000Z";
  const PEDIDO: PedidoDeLlave = {
    tipo: "pedido",
    plazoDesde: DESDE,
    venceEn: VENCE,
    plazoLlaveDesde: DESDE,
    estado: "esperando_llave",
    cerradoEn: null,
    enCorreoDeCancelacion: false,
    contacto: "pagador@calibra.test",
    nombrePagador: "Pablo",
    monto: 25_000,
    motivo: "Cancelaste la monitoría dentro del plazo.",
    token: TOKEN,
    motivoCancelacion: "estudiante",
  };
  const url = (ruta: string) => `https://calibra.test${ruta}`;
  const ANTES = new Date("2026-10-02T15:00:00.000Z");

  it("el recordatorio tiene su plantilla; el pedido, la reapertura y el reenvío usan la del pedido", () => {
    expect(TIPOS_DE_PEDIDO.map(plantillaDelPedido)).toEqual([
      "solicitud_llave_reembolso",
      "recordatorio_llave_reembolso",
      "solicitud_llave_reembolso",
      "solicitud_llave_reembolso",
    ]);
  });

  it("vale mientras el reembolso espera la llave, sin cerrar, en el mismo ciclo y dentro del plazo", () => {
    for (const tipo of TIPOS_DE_PEDIDO) expect(pedidoVigente({ ...PEDIDO, tipo }, ANTES), tipo).toBe(true);
  });

  it("no vale si la llave ya llegó o el caso se cerró", () => {
    expect(pedidoVigente({ ...PEDIDO, estado: "pendiente" }, ANTES)).toBe(false);
    expect(pedidoVigente({ ...PEDIDO, estado: "reembolsado" }, ANTES)).toBe(false);
    expect(pedidoVigente({ ...PEDIDO, cerradoEn: "2026-10-08T15:00:01.000Z" }, ANTES)).toBe(false);
  });

  it("supuesto 2: el pedido cuya llave ya pidió el correo de cancelación no sale; el recordatorio, la reapertura y el reenvío sí", () => {
    expect(pedidoVigente({ ...PEDIDO, enCorreoDeCancelacion: true }, ANTES)).toBe(false);
    for (const tipo of ["recordatorio", "reapertura", "reenvio"] as const) {
      expect(pedidoVigente({ ...PEDIDO, tipo, enCorreoDeCancelacion: true }, ANTES), tipo).toBe(true);
    }
  });

  it("un correo de otro ciclo (anotado antes de reabrir) no sale", () => {
    expect(pedidoVigente({ ...PEDIDO, plazoLlaveDesde: "2026-10-20T15:00:00.000Z" }, ANTES)).toBe(false);
    // El mismo instante escrito de otra forma es el mismo ciclo.
    expect(pedidoVigente({ ...PEDIDO, plazoLlaveDesde: "2026-10-01T10:00:00.000-05:00" }, ANTES)).toBe(true);
  });

  it("P-40: con el instante exacto del vencimiento todavía sale; un milisegundo después, no", () => {
    expect(pedidoVigente(PEDIDO, new Date(VENCE))).toBe(true);
    expect(pedidoVigente(PEDIDO, new Date(new Date(VENCE).getTime() + 1))).toBe(false);
  });

  it("los datos del pedido: el nombre, el monto, el motivo, el enlace con el token y la fecha del ciclo; sin el contacto", () => {
    const datos = datosDelPedido(PEDIDO, url, "ayuda@calibra.example");
    expect(datos).toEqual({
      nombre: "Pablo",
      monto: 25_000,
      motivo: "Cancelaste la monitoría dentro del plazo.",
      enlace: `https://calibra.test/reembolso?token=${TOKEN}`,
      venceEn: VENCE,
      reporteAceptado: false,
      contactoSoporte: "ayuda@calibra.example",
    });
    expect(JSON.stringify(datos)).not.toContain("pagador@calibra.test");
  });

  it("D-37: solo el reembolso de una inasistencia aceptada dice que se aceptó el reporte", () => {
    expect(datosDelPedido({ ...PEDIDO, motivoCancelacion: "monitor_no_asistio" }, url, null).reporteAceptado).toBe(true);
    for (const motivoCancelacion of ["estudiante", "pago_rechazado", null] as const) {
      expect(datosDelPedido({ ...PEDIDO, motivoCancelacion }, url, null).reporteAceptado, String(motivoCancelacion)).toBe(false);
    }
  });

  it("sin correo de soporte (o en blanco) no lleva el campo", () => {
    for (const contacto of [null, "", "  "]) {
      expect(datosDelPedido(PEDIDO, url, contacto)).not.toHaveProperty("contactoSoporte");
      expect(datosDelRecordatorio(PEDIDO, url, contacto)).not.toHaveProperty("contactoSoporte");
    }
    expect(datosDelPedido(PEDIDO, url, "  ayuda@calibra.example ").contactoSoporte).toBe("ayuda@calibra.example");
  });

  it("los datos del recordatorio son los del pedido, sin el reporte", () => {
    expect(datosDelRecordatorio({ ...PEDIDO, tipo: "recordatorio" }, url, "ayuda@calibra.example")).toEqual({
      nombre: "Pablo",
      monto: 25_000,
      motivo: "Cancelaste la monitoría dentro del plazo.",
      enlace: `https://calibra.test/reembolso?token=${TOKEN}`,
      venceEn: VENCE,
      contactoSoporte: "ayuda@calibra.example",
    });
  });

  it("los dos datos arman su correo, el mismo cada vez (el reintento lo exige)", () => {
    const pedido = () => renderizar("solicitud_llave_reembolso", datosDelPedido(PEDIDO, url, "ayuda@calibra.example"));
    const recordatorio = () => renderizar("recordatorio_llave_reembolso", datosDelRecordatorio(PEDIDO, url, "ayuda@calibra.example"));
    expect(pedido()).toEqual(pedido());
    expect(recordatorio()).toEqual(recordatorio());
    // 15:00 UTC son las 10:00 a. m. en Bogotá.
    expect(pedido().texto.replace(/[  ]/g, " ")).toContain("Tienes hasta el jueves, 8 de octubre de 2026, 10:00 a. m. para enviarla.");
  });
});

describe("reabrir un caso cerrado desde la bandeja (supuesto 4)", () => {
  it("reconoce los cinco resultados de la base y nada más", () => {
    expect([...RESULTADOS_DE_REABRIR].sort()).toEqual(["no_cerrado", "no_encontrado", "reabierto", "sin_permiso", "sin_sesion"]);
    for (const resultado of RESULTADOS_DE_REABRIR) expect(esResultadoDeReabrir(resultado)).toBe(true);
    for (const raro of ["", "reenviado", null, 2]) expect(esResultadoDeReabrir(raro), JSON.stringify(raro)).toBe(false);
  });

  it("cada desenlace tiene su aviso: el éxito como estado y lo demás como error", () => {
    expect(avisoDeReabrir({ reembolso: "reabierto" })).toEqual({
      exito: true,
      texto: "Reabriste el caso: quien pagó tiene otra vez el plazo completo y le mandamos de nuevo el enlace para enviar su llave.",
    });
    expect(avisoDeReabrir({ reembolso: "no_cerrado" })).toEqual({
      exito: false,
      texto: "Ese caso ya no estaba cerrado: sigue esperando la llave o ya la recibimos.",
    });
    expect(avisoDeReabrir({ reembolso: "no_encontrado" })).toEqual({ exito: false, texto: "No encontramos ese reembolso." });
    for (const sinPermiso of ["sin_permiso", "sin_sesion"]) {
      expect(avisoDeReabrir({ reembolso: sinPermiso })).toEqual({ exito: false, texto: "Solo un admin activo puede reabrir un caso." });
    }
    expect(avisoDeReabrir({ reembolso: "fallo" })?.exito).toBe(false);
    expect(avisoDeReabrir({ reembolso: "fallo" })?.texto).toContain("No pudimos reabrir el caso.");
  });

  it("sin el parámetro, con uno que no conoce o repetido no muestra nada", () => {
    for (const consulta of [{}, { reembolso: "" }, { reembolso: "otro" }, { reembolso: "toString" }, { reembolso: ["reabierto", "reabierto"] }, { otro: "reabierto" }]) {
      expect(avisoDeReabrir(consulta), JSON.stringify(consulta)).toBeNull();
    }
  });
});
