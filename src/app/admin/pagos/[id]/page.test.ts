import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoParaRevisar } from "@/lib/admin/pagos";
import { MENSAJES_DE_REVISION } from "@/lib/admin/pagos-reglas";
import RevisarPago from "./page";

// Sin navegador ni base: la revisión de un pago con la sesión y el pago inventados, y se lee el HTML. Aquí se fija
// qué ve cada admin (criterio 1, supuestos 1, 7 y 8; HU-077: otro admin antes y después de la hora del asignado, y
// quién revisó), qué consecuencias se leen antes de rechazar según la monitoría (criterio 3, P-24) y que al pintar no
// se firma ningún enlace (criterio 6). El recorrido con la base lo cubre e2e/revisar-pagos.spec.ts.

const ID = "6a6a6a6a-0000-4000-8000-000000000020";
const YO = "a0a0a0a0-0000-4000-8000-000000000020";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002001";

const rutas = vi.hoisted(() => ({ pedidas: [] as string[] }));
const datos = vi.hoisted(() => ({ pago: null as PagoParaRevisar | null, falla: null as Error | null }));
const firmar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.pedidas.push(ruta);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/pagos", () => ({
  cargarPagoParaRevisar: async () => {
    if (datos.falla) throw datos.falla;
    return datos.pago;
  },
  revisarPago: vi.fn(),
}));
vi.mock("@/lib/admin/casos-p24", () => ({ cerrarCasoP24: vi.fn() }));
vi.mock("@/lib/comprobantes/almacenamiento", () => ({ enlaceDeComprobanteDePago: firmar }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

const AHORA = new Date("2030-01-07T14:00:00.000Z");
/** 10:00 en Bogotá: una hora después de AHORA. */
const INICIO = new Date("2030-01-07T15:00:00.000Z");

function pago(cambios: Partial<Omit<PagoParaRevisar, "monitoria">> = {}, monitoria: Partial<PagoParaRevisar["monitoria"]> = {}): PagoParaRevisar {
  return {
    id: ID,
    monto: 32_000,
    nombrePagador: "Camila Rojas",
    contacto: "camila@uniandes.edu.co",
    referencia: null,
    estado: "en_revision",
    idAdmin: YO,
    nombreAdmin: "Admin Uno",
    revisionHasta: new Date("2030-01-07T14:30:00.000Z"),
    restante: { texto: "Quedan 30 min", vencido: false },
    fechaRevision: null,
    idAdminRevisor: null,
    nombreAdminRevisor: null,
    observaciones: null,
    cierre: null,
    monitoria: {
      estado: "confirmada",
      motivoCancelacion: null,
      fecha: "2030-01-07",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      nombreMonitor: "Andrés Gómez",
      inicio: INICIO,
      grupal: false,
      ...monitoria,
    },
    ...cambios,
  };
}

async function pintar(p: PagoParaRevisar | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.pago = p;
  return renderToStaticMarkup(await RevisarPago({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  rutas.pedidas = [];
  datos.falla = null;
  firmar.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Revisión de un pago (HU-020): lo que ve el admin (criterio 1)", () => {
  it("pagador, contacto, monto, referencia, monitoría y tiempo restante", async () => {
    const html = await pintar(pago());
    const t = texto(html);
    for (const dato of [
      "Revisar el pago",
      "Pagador Camila Rojas",
      "Contacto camila@uniandes.edu.co",
      "Monto $ 32.000",
      "Referencia Sin referencia",
      "Estado En revisión",
      "Tiempo para revisarlo Quedan 30 min",
      "Materia Cálculo Diferencial",
      "Monitor Andrés Gómez",
      "Fecha 7 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Estado Confirmada",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toContain('<time dateTime="2030-01-07T14:30:00.000Z">Quedan 30 min</time>');
    expect(rutas.pedidas).toEqual([`/admin/pagos/${ID}`]);
  });

  it("criterio 6: el comprobante es un enlace a su ruta, que firma al tocarlo; al pintar no se firma nada", async () => {
    const html = await pintar(pago());
    expect(html).toContain(`<a href="/admin/pagos/${ID}/comprobante" target="_blank" rel="noopener noreferrer"`);
    expect(texto(html)).toContain("Ver comprobante");
    expect(texto(html)).toContain("vence a los 60 segundos");
    expect(firmar).not.toHaveBeenCalled();
    expect(html).not.toMatch(/token=|storage\/v1|sign\//);
  });

  it("con referencia la muestra tal cual", async () => {
    expect(texto(await pintar(pago({ referencia: "M12345678" })))).toContain("Referencia M12345678");
  });

  it("un plazo vencido lo dice con palabras, y el asignado todavía puede revisarlo (supuesto 1, sin escalamiento hasta HU-034)", async () => {
    const html = await pintar(pago({ restante: { texto: "Vencido hace 5 min", vencido: true } }));
    expect(texto(html)).toContain("Tiempo para revisarlo Vencido hace 5 min");
    expect(texto(html)).toContain("Aprobar pago");
  });

  it("escapa lo que viene de la base", async () => {
    // Con la monitoría cancelada no es un caso P-24 (HU-078): sin formulario, React no agrega su <script> de reenvío.
    const html = await pintar(
      pago(
        { nombrePagador: '<img src=x onerror="alert(1)">', estado: "rechazado", observaciones: "<script>alert(2)</script>" },
        { estado: "cancelada", motivoCancelacion: "pago_rechazado" },
      ),
    );
    // El único <img> es el logo de la pantalla.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("Revisión de un pago: aprobar y rechazar (criterios 2, 3 y 7, supuesto 7)", () => {
  it("el asignado ve Aprobar y, dentro del rechazo, las consecuencias antes del botón de confirmar", async () => {
    const html = await pintar(pago());
    const t = texto(html);
    expect(t).toContain("Aprobar pago");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Rechazar el pago<\/summary>/);
    const consecuencias =
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co. También le avisaremos al monitor.";
    expect(t).toContain(consecuencias);
    expect(t.indexOf(consecuencias)).toBeLessThan(t.indexOf("Sí, rechazar el pago"));
    expect(t).toContain("Observaciones (opcionales)");
    expect(html).not.toMatch(/<textarea[^>]*required/);
    // La decisión viaja con el pago; quién revisa lo pone la sesión, no el formulario.
    expect(html.match(new RegExp(`name="id_pago" value="${ID}"`, "g"))).toHaveLength(2);
    expect(html).toContain('name="decision" value="aprobar"');
    expect(html).toContain('name="decision" value="rechazar"');
    expect(html).not.toContain(YO);
  });

  it("P-24: una confirmada en su inicio exacto ya empezó (P-40): no se cancela y las observaciones son obligatorias", async () => {
    const html = await pintar(pago({}, { inicio: AHORA }));
    const t = texto(html);
    // HU-078 (D-39): el caso queda por cobrar o asumir y cuenta en el desembolso cuando alguien lo cierra.
    expect(t).toContain(
      "La sesión ya empezó, así que la monitoría no se cancela y el caso queda en «Pagos por cobrar o asumir»: el pago cuenta en el desembolso del monitor solo cuando alguien lo cierre como cobrado o asumido.",
    );
    expect(t).not.toContain("queda fuera del desembolso");
    expect(t).not.toContain("Se cancela la monitoría");
    expect(t).not.toContain("Observaciones (opcionales)");
    expect(t).toContain("Obligatorias: escribe qué se hará con ese cobro, si cobrarlo por fuera o asumirlo.");
    expect(html).toMatch(/<textarea[^>]*required/);
  });

  it("un milisegundo antes del inicio, todavía se cancela", async () => {
    const t = texto(await pintar(pago({}, { inicio: new Date(AHORA.getTime() + 1) })));
    expect(t).toContain("Se cancela la monitoría");
  });

  it("P-24: una realizada tampoco se cancela", async () => {
    const html = await pintar(pago({}, { estado: "realizada" }));
    expect(texto(html)).toContain("La monitoría ya se realizó, así que no se cancela");
    expect(html).toMatch(/<textarea[^>]*required/);
  });

  it("HU-076, D-39 d: con la cita ya cancelada por el estudiante, solo cambia el pago y se le avisa al pagador que no hay reembolso", async () => {
    const t = texto(await pintar(pago({}, { estado: "cancelada", motivoCancelacion: "estudiante" })));
    expect(t).toContain("Estado Cancelada: la canceló el estudiante");
    expect(t).toContain(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co, que no hay reembolso.",
    );
    expect(t).not.toContain("al monitor");
    expect(t).toContain("Aprobar pago");
  });

  it("HU-076: si el contacto no es un correo, el admin lee que tiene que avisarle él (sin prometer el correo)", async () => {
    const cancela = texto(await pintar(pago({ contacto: "3001234567" })));
    expect(cancela).toContain(
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. El contacto de Camila Rojas no es un correo: tendrás que avisarle tú, al 3001234567. También le avisaremos al monitor.",
    );
    const yaCancelada = texto(await pintar(pago({ contacto: "3001234567" }, { estado: "cancelada", motivoCancelacion: "estudiante" })));
    expect(yaCancelada).toContain(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. El contacto de Camila Rojas no es un correo: tendrás que avisarle tú, al 3001234567.",
    );
  });

  it("HU-076: una monitoría pendiente de pago (defensivo) se cancela sin avisarle al monitor", async () => {
    const t = texto(await pintar(pago({}, { estado: "pendiente_pago" })));
    expect(t).toContain("Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co.");
    expect(t).not.toContain("También le avisaremos al monitor");
  });

  it("cancelada por otro motivo (monitor que no asistió), al pagador no se le escribe", async () => {
    const t = texto(await pintar(pago({}, { estado: "cancelada", motivoCancelacion: "monitor_no_asistio" })));
    expect(t).toContain("La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa y al pagador no le escribimos.");
  });
});

describe("Revisión de un pago: quién revisa (supuestos 1 y 8; HU-077)", () => {
  const ASIGNADO_EN_HORA =
    "Este pago está asignado a Admin Dos hasta el lunes, 7 de enero de 2030, 9:30 a. m. Si para entonces no lo ha revisado, podrás aprobarlo o rechazarlo tú.";
  const ASIGNADO_VENCIDO = "Este pago está asignado a Admin Dos, pero se le pasó la hora el lunes, 7 de enero de 2030, 8:59 a. m. Puedes aprobarlo o rechazarlo tú.";
  /** La hora del asignado venció un milisegundo antes de AHORA. */
  const VENCIDO = { revisionHasta: new Date(AHORA.getTime() - 1), restante: { texto: "Venció hace menos de 1 min", vencido: true } };

  it("HU-077 criterio 2: otro admin dentro de la hora ve el pago, a quién está asignado y hasta cuándo, sin acciones", async () => {
    const html = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos" }));
    const t = texto(html);
    expect(t).toContain(ASIGNADO_EN_HORA);
    expect(t).toContain("Pagador Camila Rojas");
    expect(t).toContain("Ver comprobante");
    expect(html).not.toContain("<form");
    expect(t).not.toContain("Aprobar pago");
    expect(t).not.toContain("Rechazar el pago");
    expect(t).not.toContain("Compara el comprobante");
  });

  it("supuesto 1 (P-40): justo en el límite el pago todavía es solo del asignado", async () => {
    const html = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos", revisionHasta: AHORA, restante: { texto: "Queda menos de 1 min", vencido: false } }));
    expect(texto(html)).toContain("Este pago está asignado a Admin Dos hasta el lunes, 7 de enero de 2030, 9:00 a. m.");
    expect(html).not.toContain("<form");
  });

  it("HU-077 criterio 1: con la hora vencida, otro admin ve de quién era la hora y puede aprobarlo o rechazarlo con las mismas reglas", async () => {
    const vencido = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos", ...VENCIDO }));
    const t = texto(vencido);
    // AHORA son las 9:00 en Bogotá: la hora venció un milisegundo antes, a las 8:59:59.
    expect(t).toContain(ASIGNADO_VENCIDO);
    expect(t).toContain("Compara el comprobante con estos datos antes de aprobarlo o rechazarlo.");
    expect(t).toContain("Aprobar pago");
    expect(vencido).toMatch(/<details[^>]*><summary[^>]*>Rechazar el pago<\/summary>/);
    // Las mismas consecuencias que ve el asignado (criterio 3 de HU-020), y el aviso antes de las acciones.
    expect(t).toContain("Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona.");
    expect(t.indexOf("se le pasó la hora")).toBeLessThan(t.indexOf("Aprobar pago"));
    // Quién revisa lo pone la sesión, no el formulario.
    expect(vencido).not.toContain(YO);
  });

  it("HU-077: con la hora vencida y P-24, otro admin también tiene que escribir las observaciones", async () => {
    const html = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos", ...VENCIDO }, { inicio: AHORA }));
    expect(texto(html)).toContain("La sesión ya empezó, así que la monitoría no se cancela");
    expect(html).toMatch(/<textarea[^>]*required/);
  });

  it("el asignado no lee ningún aviso de quién revisa, ni antes ni después de su hora", async () => {
    for (const p of [pago(), pago(VENCIDO)]) {
      const t = texto(await pintar(p));
      expect(t).not.toContain("Este pago está asignado a");
      expect(t).toContain("Aprobar pago");
    }
  });

  it("el pago de una grupal no se revisa aquí todavía (HU-038)", async () => {
    const html = await pintar(pago({}, { grupal: true }));
    expect(texto(html)).toContain(MENSAJES_DE_REVISION.no_individual);
    expect(html).not.toContain("<form");
  });

  it("la grupal de otro admin con la hora vencida tampoco: no promete que puede revisarla", async () => {
    const html = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos", ...VENCIDO }, { grupal: true }));
    const t = texto(html);
    expect(t).toContain(MENSAJES_DE_REVISION.no_individual);
    expect(t).not.toContain("Puedes aprobarlo o rechazarlo tú");
    expect(html).not.toContain("<form");
  });
});

describe("Revisión de un pago: después de revisar", () => {
  const RECHAZADO = pago(
    { estado: "rechazado", fechaRevision: new Date("2030-01-07T14:10:00.000Z"), observaciones: "Se cobra por fuera.\nLlamar el lunes." },
    { estado: "cancelada", motivoCancelacion: "pago_rechazado" },
  );

  it("un pago revisado muestra cómo quedó y cuándo, con sus observaciones, sin acciones", async () => {
    const html = await pintar(RECHAZADO);
    const t = texto(html);
    expect(t).toContain("Pago rechazado");
    expect(t).toContain("Estado Rechazado");
    expect(t).toContain("Revisado lunes, 7 de enero de 2030, 9:10 a. m.");
    expect(t).toContain("Observaciones Se cobra por fuera. Llamar el lunes.");
    expect(t).toContain("Estado Cancelada: el pago fue rechazado");
    expect(t).not.toContain("Tiempo para revisarlo");
    expect(html).not.toContain("<form");
    expect(t).toContain("Volver a mi bandeja");
  });

  it("HU-077 criterio 3: dice quién lo revisó; si fue el asignado, no repite a quién estaba asignado", async () => {
    const t = texto(await pintar({ ...RECHAZADO, idAdminRevisor: YO, nombreAdminRevisor: "Admin Uno" }));
    expect(t).toContain("Revisado lunes, 7 de enero de 2030, 9:10 a. m. Revisado por Admin Uno Observaciones");
    expect(t).not.toContain("Asignado a");
  });

  it("HU-077 criterio 3: si lo revisó otro admin, dice quién lo revisó y a quién estaba asignado", async () => {
    const html = await pintar({ ...RECHAZADO, idAdmin: OTRO, nombreAdmin: "Admin Dos", idAdminRevisor: YO, nombreAdminRevisor: "Admin Uno" });
    const t = texto(html);
    expect(t).toContain("Revisado por Admin Uno Asignado a Admin Dos");
    expect(html).not.toContain("<form");
    expect(t).not.toContain("Este pago está asignado a");
  });

  it("un pago revisado sin revisor registrado (insertado ya revisado) no inventa uno", async () => {
    const t = texto(await pintar(RECHAZADO));
    expect(t).not.toContain("Revisado por");
    expect(t).not.toContain("Asignado a");
  });

  it("HU-076: tras rechazar, el mensaje de éxito es un role=status y dice que el correo saldrá en unos minutos", async () => {
    const html = await pintar(RECHAZADO, { revisado: "rechazado" });
    expect(html).toMatch(
      /<p role="status"[^>]*>Rechazaste el pago\. Ya no aparece en tu bandeja\. Le avisaremos al pagador por correo en unos minutos\.<\/p>/,
    );
  });

  it("HU-076: con la cita ya cancelada por el estudiante también sale el correo, y el mensaje es el mismo", async () => {
    const yaCancelada = { ...RECHAZADO, monitoria: { ...RECHAZADO.monitoria, motivoCancelacion: "estudiante" as const } };
    expect(texto(await pintar(yaCancelada, { revisado: "rechazado" }))).toContain(
      "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisaremos al pagador por correo en unos minutos.",
    );
  });

  it("HU-076: si el contacto no es un correo, no promete el correo y se lo dice al admin como alerta", async () => {
    const html = await pintar({ ...RECHAZADO, contacto: "3001234567" }, { revisado: "rechazado" });
    expect(html).toMatch(/<p role="status"[^>]*>Rechazaste el pago\. Ya no aparece en tu bandeja\.<\/p>/);
    expect(html).toMatch(/<p role="alert"[^>]*>El contacto del pagador no es un correo: avísale tú, al 3001234567\.<\/p>/);
  });

  it("HU-076: el parámetro ?correo= de antes ya no dice nada", async () => {
    const t = texto(await pintar(RECHAZADO, { revisado: "rechazado", correo: "por_reintentar" }));
    expect(t).not.toContain("no salió todavía");
    expect(t).not.toContain("Correos que no salieron");
  });

  it("tras aprobar, el éxito; y un enlace viejo no anuncia una aprobación que no pasó", async () => {
    const aprobado = await pintar(pago({ estado: "aprobado", fechaRevision: new Date("2030-01-07T14:10:00.000Z") }), { revisado: "aprobado" });
    expect(aprobado).toMatch(/<p role="status"[^>]*>Aprobaste el pago\. Ya no aparece en tu bandeja\.<\/p>/);
    expect(texto(aprobado)).toContain("Pago aprobado");
    const sinRevisar = await pintar(pago(), { revisado: "aprobado" });
    expect(sinRevisar).not.toContain('role="status"');
    expect(texto(sinRevisar)).not.toContain("Aprobaste");
  });

  it("lo que cambió mientras el admin miraba vuelve como alerta", async () => {
    const html = await pintar(RECHAZADO, { error: "ya_revisado" });
    expect(html).toMatch(/<p role="alert"[^>]*>Este pago ya se revisó, y una revisión no se puede cambiar\.<\/p>/);
    expect(texto(html)).toContain(MENSAJES_DE_REVISION.ya_revisado);
  });
});

describe("Pagos por cobrar o asumir (HU-078)", () => {
  const OBSERVACIONES = "Se cobra por fuera.\nLlamar el lunes.";
  /** Un caso P-24 abierto: rechazado y la monitoría ya realizada, sin cierre. */
  const ABIERTO = pago(
    { estado: "rechazado", fechaRevision: new Date("2030-01-07T14:10:00.000Z"), idAdminRevisor: YO, nombreAdminRevisor: "Admin Uno", observaciones: OBSERVACIONES },
    { estado: "realizada" },
  );
  const CERRADO = {
    ...ABIERTO,
    cierre: { como: "cobrado" as const, nota: "Pagó por Nequi.", idAdmin: OTRO, nombreAdmin: "Admin Dos", fecha: new Date("2030-01-08T15:30:00.000Z") },
  };
  const CONSECUENCIAS =
    "Cerrar el caso no se puede deshacer. Sale de «Pagos por cobrar o asumir», el pago sigue rechazado y su monto cuenta en el desembolso del monitor.";

  it("criterio 2: un caso abierto se explica, con las observaciones del rechazo, y se cierra dentro de una confirmación que dice que no se deshace", async () => {
    const html = await pintar(ABIERTO);
    const t = texto(html);
    expect(t).toContain("Observaciones Se cobra por fuera. Llamar el lunes.");
    expect(t).toContain("Por cobrar o asumir");
    expect(t).toContain(
      "Este pago se rechazó cuando la sesión ya había empezado, así que la monitoría no se canceló. Lo que se anotó al rechazarlo está en Observaciones.",
    );
    // Criterio 4: el admin sabe que el desembolso espera.
    expect(t).toContain("Mientras siga abierto, el desembolso de esta monitoría no se puede ejecutar.");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Cerrar el caso<\/summary>/);
    expect(t).toContain(CONSECUENCIAS);
    expect(t.indexOf(CONSECUENCIAS)).toBeLessThan(t.indexOf("Sí, cerrar el caso"));
    expect(t).toContain("¿Cómo se resolvió?");
    expect(t).toContain("Cobrado: el pagador pagó por fuera");
    expect(t).toContain("Asumido: Calibra no lo cobra");
    expect(t).toContain("Nota (opcional)");
    // Ninguna opción viene marcada: el admin elige.
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*checked/);
    // Quién cierra lo pone la sesión, no el formulario; nunca se habla de comisión ni de bruto.
    expect(html).not.toContain(YO);
    expect(html.toLowerCase()).not.toMatch(/comisi|bruto/);
  });

  it("el formulario entero (las opciones, la nota y el botón) está dentro de la confirmación, que empieza cerrada", async () => {
    const html = await pintar(ABIERTO);
    const inicio = html.indexOf("<details");
    const fin = html.indexOf("</details>");
    expect(inicio).toBeGreaterThan(-1);
    // La única confirmación de la página es la del caso: la revisión ya pasó.
    expect(html.indexOf("<details", inicio + 1)).toBe(-1);
    expect(html.slice(inicio, html.indexOf(">", inicio) + 1)).not.toContain("open");
    const dentro = html.slice(inicio, fin);
    const fuera = html.slice(0, inicio) + html.slice(fin);
    for (const pieza of ["<form", `name="id_pago" value="${ID}"`, 'value="cobrado"', 'value="asumido"', 'id="nota"', 'maxLength="500"', 'type="submit"', "no se puede deshacer"]) {
      expect(dentro, pieza).toContain(pieza);
      expect(fuera, pieza).not.toContain(pieza);
    }
    expect(dentro.match(/<input type="radio"[^>]*name="cierre"/g)).toHaveLength(2);
    expect(dentro.indexOf("no se puede deshacer")).toBeLessThan(dentro.indexOf('type="radio"'));
  });

  it("supuesto 1: una confirmada que ya empezó también es un caso", async () => {
    const html = await pintar({ ...ABIERTO, monitoria: { ...ABIERTO.monitoria, estado: "confirmada", inicio: new Date(AHORA.getTime() - 60_000) } });
    expect(texto(html)).toContain("Cerrar el caso");
  });

  it("supuesto 1: un pago rechazado de una monitoría cancelada no es un caso, ni un pago aprobado o en revisión", async () => {
    for (const p of [
      pago({ estado: "rechazado", fechaRevision: new Date("2030-01-07T14:10:00.000Z") }, { estado: "cancelada", motivoCancelacion: "pago_rechazado" }),
      pago({ estado: "rechazado", fechaRevision: new Date("2030-01-07T14:10:00.000Z") }, { estado: "cancelada", motivoCancelacion: "estudiante" }),
      pago({ estado: "aprobado", fechaRevision: new Date("2030-01-07T14:10:00.000Z") }, { estado: "realizada" }),
      pago({}, { estado: "realizada" }),
    ]) {
      const t = texto(await pintar(p));
      expect(t).not.toContain("Por cobrar o asumir");
      expect(t).not.toContain("Cerrar el caso");
    }
  });

  it("criterio 2: un caso cerrado dice cómo, quién, cuándo y la nota, sin formulario", async () => {
    const html = await pintar(CERRADO);
    const t = texto(html);
    expect(t).toContain("Caso Cerrado. Cobrado: el pagador pagó por fuera");
    expect(t).toContain("Cerrado por Admin Dos");
    expect(t).toContain("Cerrado martes, 8 de enero de 2030, 10:30 a. m.");
    expect(html).toContain('<time dateTime="2030-01-08T15:30:00.000Z">');
    expect(t).toContain("Nota Pagó por Nequi.");
    expect(html).not.toContain("<form");
    expect(t).not.toContain("Cerrar el caso");
    expect(t).not.toContain("Mientras siga abierto");
  });

  it("P-28: si la monitoría se canceló después del cierre, el cierre se sigue mostrando, sin formulario", async () => {
    const html = await pintar({ ...CERRADO, monitoria: { ...CERRADO.monitoria, estado: "cancelada", motivoCancelacion: "monitor_no_asistio" } });
    expect(texto(html)).toContain("Caso Cerrado. Cobrado: el pagador pagó por fuera");
    expect(html).not.toContain("<form");
  });

  it("un caso asumido sin nota no inventa una", async () => {
    const t = texto(await pintar({ ...CERRADO, cierre: { ...CERRADO.cierre, como: "asumido", nota: null } }));
    expect(t).toContain("Caso Cerrado. Asumido: Calibra no lo cobra");
    expect(t).not.toContain("Nota");
  });

  it("criterio 5: tras un rechazo en P-24 el éxito dice que el caso quedó en Pagos por cobrar o asumir", async () => {
    const html = await pintar(ABIERTO, { revisado: "rechazado" });
    expect(html).toMatch(
      /<p role="status"[^>]*>Rechazaste el pago\. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido\.<\/p>/,
    );
    expect(texto(html)).not.toContain("Ya no aparece en tu bandeja");
  });

  it("tras cerrarlo, el éxito es un role=status; un enlace viejo o el cierre de otro admin no lo anuncian", async () => {
    const mio = { ...CERRADO, cierre: { ...CERRADO.cierre, idAdmin: YO, nombreAdmin: "Admin Uno" } };
    expect(await pintar(mio, { caso: "cerrado" })).toMatch(
      /<p role="status"[^>]*>Cerraste el caso como cobrado\. Ya no aparece en «Pagos por cobrar o asumir»\.<\/p>/,
    );
    expect(await pintar(CERRADO, { caso: "cerrado" })).not.toContain("Cerraste");
    expect(await pintar(ABIERTO, { caso: "cerrado" })).not.toContain("Cerraste");
  });

  it("si otro admin lo cerró mientras tanto, lo dice como alerta y muestra cómo quedó", async () => {
    const html = await pintar(CERRADO, { caso: "ya_cerrado" });
    expect(html).toMatch(/<p role="alert"[^>]*>Este caso ya estaba cerrado, y un cierre no se puede cambiar\.<\/p>/);
    expect(texto(html)).toContain("Cerrado por Admin Dos");
  });

  it("escapa la nota y el nombre de quien lo cerró", async () => {
    const html = await pintar({ ...CERRADO, cierre: { ...CERRADO.cierre, nota: "<script>alert(1)</script>", nombreAdmin: "<b>Admin</b>" } });
    // Cerrado no tiene formulario: el único <script> sería el de la nota.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>Admin");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("Revisión de un pago: lo que no existe", () => {
  it("un id que no es un uuid es un 404, sin leer nada", async () => {
    await expect(pintar(pago(), {}, "no-es-un-id")).rejects.toThrow("notFound");
  });

  it("un pago que no existe (o que la sesión no puede leer) es un 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("un error de la base no es un 404: lo dice y deja volver a la bandeja", async () => {
    datos.falla = new Error("se cayó la base");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = texto(await pintar(pago()));
    espia.mockRestore();
    expect(t).toContain("No pudimos cargar el pago");
    expect(t).toContain("Volver a mi bandeja");
  });
});
