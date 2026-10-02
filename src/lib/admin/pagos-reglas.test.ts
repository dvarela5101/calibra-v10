import { describe, expect, it } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import { renderizar } from "@/lib/correo/plantillas";
import {
  avisoDelEnvio,
  avisosDeLaPagina,
  ayudaDeObservaciones,
  casoDeRechazo,
  consecuenciasDelRechazo,
  correoDeRechazo,
  esAvisoAlPagador,
  esResultadoDeRevision,
  LARGO_MAXIMO_OBSERVACIONES,
  leerRevision,
  MENSAJE_DEL_COMPROBANTE,
  MENSAJES_DE_REVISION,
  pideObservaciones,
  RESULTADOS_DE_REVISION,
  type PagoParaElCorreo,
} from "./pagos-reglas";

const ID = "6a6a6a6a-0000-4000-8000-000000000020";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

describe("resultados de la revisión (HU-020)", () => {
  it.each(Object.keys(MENSAJES_DE_REVISION))("%s tiene un mensaje para el admin", (resultado) => {
    const mensaje = MENSAJES_DE_REVISION[resultado as keyof typeof MENSAJES_DE_REVISION];
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("todo resultado que no es aprobar ni rechazar tiene mensaje", () => {
    const sinMensaje = RESULTADOS_DE_REVISION.filter((r) => r !== "aprobado" && r !== "rechazado" && !(r in MENSAJES_DE_REVISION));
    expect(sinMensaje).toEqual([]);
  });

  it("reconoce solo lo que responde la base", () => {
    for (const resultado of RESULTADOS_DE_REVISION) expect(esResultadoDeRevision(resultado)).toBe(true);
    expect(esResultadoDeRevision("revisado")).toBe(false);
    expect(esResultadoDeRevision(null)).toBe(false);
  });

  it("P-24: el mensaje pide anotar qué se hará con el cobro", () => {
    expect(MENSAJES_DE_REVISION.observaciones_requeridas).toMatch(/cobrarlo por fuera o asumirlo/);
  });
});

describe("leerRevision", () => {
  it("lee el pago, la decisión y las observaciones recortadas", () => {
    expect(leerRevision(formulario({ id_pago: ` ${ID.toUpperCase()} `, decision: "rechazar", observaciones: "  Se cobra por fuera.\n " }))).toEqual({
      ok: true,
      datos: { idPago: ID, decision: "rechazar", observaciones: "Se cobra por fuera." },
    });
  });

  it("observaciones vacías o en blanco cuentan como ninguna, y aprobar no las necesita", () => {
    expect(leerRevision(formulario({ id_pago: ID, decision: "aprobar" }))).toEqual({ ok: true, datos: { idPago: ID, decision: "aprobar", observaciones: null } });
    expect(leerRevision(formulario({ id_pago: ID, decision: "rechazar", observaciones: " \n\t " }))).toEqual({
      ok: true,
      datos: { idPago: ID, decision: "rechazar", observaciones: null },
    });
  });

  it("cuenta caracteres como la base, no unidades de JavaScript: 500 caracteres de dos unidades caben", () => {
    // U+1D11E (clave de sol) ocupa dos unidades de JavaScript y es un solo carácter para char_length.
    const quinientos = "\u{1D11E}".repeat(LARGO_MAXIMO_OBSERVACIONES);
    expect(quinientos.length).toBe(2 * LARGO_MAXIMO_OBSERVACIONES);
    expect(leerRevision(formulario({ id_pago: ID, decision: "rechazar", observaciones: quinientos })).ok).toBe(true);
    expect(leerRevision(formulario({ id_pago: ID, decision: "rechazar", observaciones: `${quinientos}a` }))).toEqual({
      ok: false,
      error: MENSAJES_DE_REVISION.observaciones_invalidas,
    });
  });

  it.each([
    ["sin pago", { decision: "aprobar" }, MENSAJES_DE_REVISION.no_encontrado],
    ["con un pago que no es un id", { id_pago: "1 or 1=1", decision: "aprobar" }, MENSAJES_DE_REVISION.no_encontrado],
    ["sin decisión", { id_pago: ID }, MENSAJES_DE_REVISION.decision_invalida],
    ["con otra decisión", { id_pago: ID, decision: "deshacer" }, MENSAJES_DE_REVISION.decision_invalida],
  ])("rechaza un formulario %s", (_caso, campos, error) => {
    expect(leerRevision(formulario(campos))).toEqual({ ok: false, error });
  });

  it("un archivo en vez de texto no cuenta como observaciones", () => {
    const datos = formulario({ id_pago: ID, decision: "rechazar" });
    datos.set("observaciones", new Blob(["texto"]));
    expect(leerRevision(datos)).toEqual({ ok: true, datos: { idPago: ID, decision: "rechazar", observaciones: null } });
  });
});

describe("casoDeRechazo (RN-43, P-24, supuesto 2)", () => {
  const INICIO = new Date("2030-01-07T15:00:00.000Z");
  const antes = new Date(INICIO.getTime() - 1);

  it("una confirmada que aún no empieza se cancela", () => {
    expect(casoDeRechazo("confirmada", INICIO, antes)).toBe("cancela_la_cita");
  });

  it("una confirmada en su inicio exacto ya empezó (P-40, borde incluido), y después también", () => {
    expect(casoDeRechazo("confirmada", INICIO, INICIO)).toBe("ya_empezo");
    expect(casoDeRechazo("confirmada", INICIO, new Date(INICIO.getTime() + 60_000))).toBe("ya_empezo");
  });

  it("la realizada no se cancela, aunque su inicio sea futuro para este reloj", () => {
    expect(casoDeRechazo("realizada", INICIO, antes)).toBe("ya_realizada");
  });

  it("la cancelada se queda como está, y la pendiente de pago (defensivo) se cancela", () => {
    expect(casoDeRechazo("cancelada", INICIO, antes)).toBe("ya_cancelada");
    expect(casoDeRechazo("cancelada", INICIO, INICIO)).toBe("ya_cancelada");
    expect(casoDeRechazo("pendiente_pago", INICIO, antes)).toBe("cancela_la_cita");
  });

  it("solo P-24 pide observaciones, y la ayuda lo dice", () => {
    expect(pideObservaciones("ya_empezo")).toBe(true);
    expect(pideObservaciones("ya_realizada")).toBe(true);
    expect(pideObservaciones("cancela_la_cita")).toBe(false);
    expect(pideObservaciones("ya_cancelada")).toBe(false);
    expect(ayudaDeObservaciones("ya_empezo")).toMatch(/^Obligatorias: .*cobrarlo por fuera o asumirlo\. Hasta 500 caracteres\.$/);
    expect(ayudaDeObservaciones("cancela_la_cita")).toMatch(/^Opcionales: .*Hasta 500 caracteres\.$/);
  });
});

describe("consecuenciasDelRechazo (supuestos 4 y 7)", () => {
  const PAGO = { fechaSesion: "2030-01-07", nombrePagador: "Camila Rojas", contacto: "camila@uniandes.edu.co" };

  it("criterio 3: se cancela la cita, la fecha queda libre, no hay reembolso y se le avisa al pagador", () => {
    expect(consecuenciasDelRechazo("cancela_la_cita", PAGO)).toBe(
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisamos a Camila Rojas por correo, a camila@uniandes.edu.co.",
    );
  });

  it("con un teléfono de contacto, dice que no sale correo y que avise el admin", () => {
    expect(consecuenciasDelRechazo("cancela_la_cita", { ...PAGO, contacto: "3001234567" })).toMatch(
      /El contacto de Camila Rojas no es un correo: tendrás que avisarle tú, al 3001234567\.$/,
    );
  });

  it.each(["ya_empezo", "ya_realizada", "ya_cancelada"] as const)("%s: no se cancela nada, no hay reembolso y no se escribe al pagador", (caso) => {
    const texto = consecuenciasDelRechazo(caso, PAGO);
    expect(texto).toContain("no se reembolsa");
    expect(texto).toContain("al pagador no le escribimos");
    expect(texto).not.toMatch(/Se cancela|queda libre|Le avisamos/);
  });

  it("P-24: el pago queda fuera del desembolso del monitor", () => {
    expect(consecuenciasDelRechazo("ya_empezo", PAGO)).toMatch(/^La sesión ya empezó, así que la monitoría no se cancela y el pago queda fuera del desembolso/);
    expect(consecuenciasDelRechazo("ya_realizada", PAGO)).toMatch(/^La monitoría ya se realizó, así que no se cancela/);
    expect(consecuenciasDelRechazo("ya_cancelada", PAGO)).toMatch(/^La monitoría ya estaba cancelada: solo cambia el pago\./);
  });
});

describe("correoDeRechazo (criterio 3, supuesto 4)", () => {
  const RECHAZADO: PagoParaElCorreo = {
    estado: "rechazado",
    contacto: "camila@uniandes.edu.co",
    nombrePagador: "Camila Rojas",
    monto: 32_000,
    monitoria: { estado: "cancelada", motivoCancelacion: "pago_rechazado", fecha: "2030-01-07" },
  };

  it("va al contacto del pago, con su nombre, su monto, el día de la sesión y el correo de Calibra", () => {
    expect(correoDeRechazo(RECHAZADO, "datos@calibra.example")).toEqual({
      destinatario: "camila@uniandes.edu.co",
      datos: { nombre: "Camila Rojas", monto: 32_000, fechaSesion: "2030-01-07", contactoSoporte: "datos@calibra.example" },
    });
  });

  it("sin correo de Calibra configurado, no promete un contacto de soporte", () => {
    const correo = correoDeRechazo(RECHAZADO, null);
    expect(correo?.datos).toEqual({ nombre: "Camila Rojas", monto: 32_000, fechaSesion: "2030-01-07" });
    expect(renderizar("pago_rechazado_individual", correo!.datos).texto).not.toContain("escríbenos");
  });

  it("la plantilla lo arma con el día legible y sin reembolso", () => {
    const correo = renderizar("pago_rechazado_individual", correoDeRechazo(RECHAZADO, "datos@calibra.example")!.datos);
    // El peso lleva un espacio duro.
    const texto = correo.texto.replace(/[\xa0 ]/g, " ");
    expect(correo.asunto).toBe("No pudimos verificar tu pago y la monitoría se canceló");
    expect(texto).toContain("No pudimos verificar tu pago de $ 32.000, así que la monitoría del 7 de enero de 2030 quedó cancelada.");
    expect(texto).toContain("no hay reembolso");
    expect(texto).toContain("escríbenos a datos@calibra.example");
  });

  it.each([
    ["el pago sigue en revisión", { ...RECHAZADO, estado: "en_revision" as const }],
    ["el pago se aprobó", { ...RECHAZADO, estado: "aprobado" as const }],
    ["P-24: la monitoría se realizó", { ...RECHAZADO, monitoria: { estado: "realizada" as const, motivoCancelacion: null, fecha: "2030-01-07" } }],
    ["P-24: la monitoría sigue confirmada", { ...RECHAZADO, monitoria: { estado: "confirmada" as const, motivoCancelacion: null, fecha: "2030-01-07" } }],
    ["la canceló el estudiante", { ...RECHAZADO, monitoria: { estado: "cancelada" as const, motivoCancelacion: "estudiante" as const, fecha: "2030-01-07" } }],
    ["no tiene monitoría legible", { ...RECHAZADO, monitoria: null }],
  ])("no aplica si %s", (_caso, pago) => {
    expect(correoDeRechazo(pago, "datos@calibra.example")).toBeNull();
  });
});

describe("avisoDelEnvio", () => {
  const fallo = (motivo: Extract<ResultadoEnvio, { ok: false }>["motivo"]): ResultadoEnvio => ({ ok: false, motivo, error: "x", intentos: 1 });

  it("separa lo que se reintenta solo de lo que tiene que resolver el admin", () => {
    expect(avisoDelEnvio({ ok: true, yaEnviado: false, intentos: 1, idProveedor: null })).toBe("enviado");
    expect(avisoDelEnvio({ ok: true, yaEnviado: true, intentos: 0, idProveedor: null })).toBe("enviado");
    expect(avisoDelEnvio(fallo("contacto_no_es_correo"))).toBe("no_es_correo");
    // Sin fila en correo_envio, HU-065 no lo ve: no se reintenta.
    expect(avisoDelEnvio(fallo("fallo_del_registro"))).toBe("fallo");
    for (const motivo of ["sin_proveedor", "fallo_del_proveedor", "en_curso"] as const) expect(avisoDelEnvio(fallo(motivo))).toBe("por_reintentar");
  });

  it("reconoce los avisos que la acción pone en la dirección", () => {
    for (const aviso of ["enviado", "por_reintentar", "no_es_correo", "fallo"]) expect(esAvisoAlPagador(aviso)).toBe(true);
    expect(esAvisoAlPagador("otro")).toBe(false);
  });
});

describe("avisosDeLaPagina", () => {
  const RECHAZADO = { estado: "rechazado" as const, contacto: "camila@uniandes.edu.co" };

  it("dice que se aprobó solo si el pago de verdad está aprobado", () => {
    expect(avisosDeLaPagina({ revisado: "aprobado" }, { ...RECHAZADO, estado: "aprobado" })).toEqual([
      { exito: true, texto: "Aprobaste el pago. Ya no aparece en tu bandeja." },
    ]);
    expect(avisosDeLaPagina({ revisado: "aprobado" }, { ...RECHAZADO, estado: "en_revision" })).toEqual([]);
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...RECHAZADO, estado: "aprobado" })).toEqual([]);
  });

  it("al rechazar dice si el correo salió", () => {
    expect(avisosDeLaPagina({ revisado: "rechazado", correo: "enviado" }, RECHAZADO)).toEqual([
      { exito: true, texto: "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisamos al pagador por correo." },
    ]);
    expect(avisosDeLaPagina({ revisado: "rechazado" }, RECHAZADO)).toEqual([{ exito: true, texto: "Rechazaste el pago. Ya no aparece en tu bandeja." }]);
  });

  it.each([
    ["por_reintentar", 'El correo a camila@uniandes.edu.co no salió todavía. Calibra lo reintenta solo; si no sale, lo verás en tu bandeja en "Correos que no salieron".'],
    ["no_es_correo", "El contacto del pagador no es un correo: avísale tú, al camila@uniandes.edu.co."],
    ["fallo", "No pudimos avisarle al pagador. Escríbele tú a camila@uniandes.edu.co."],
  ])("si el correo quedó %s, se lo dice al admin como alerta", (correo, texto) => {
    expect(avisosDeLaPagina({ revisado: "rechazado", correo }, RECHAZADO)).toEqual([
      { exito: true, texto: "Rechazaste el pago. Ya no aparece en tu bandeja." },
      { exito: false, texto },
    ]);
  });

  it("los errores que vuelven a la página se dicen como alerta; los desconocidos no", () => {
    for (const error of ["ya_revisado", "no_asignado", "no_individual"] as const) {
      expect(avisosDeLaPagina({ error }, RECHAZADO)).toEqual([{ exito: false, texto: MENSAJES_DE_REVISION[error] }]);
    }
    expect(avisosDeLaPagina({ error: "comprobante" }, RECHAZADO)).toEqual([{ exito: false, texto: MENSAJE_DEL_COMPROBANTE }]);
    expect(avisosDeLaPagina({ error: "<script>" }, RECHAZADO)).toEqual([]);
    expect(avisosDeLaPagina({ error: ["ya_revisado", "no_asignado"] }, RECHAZADO)).toEqual([]);
  });
});
