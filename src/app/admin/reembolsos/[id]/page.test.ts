import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReembolsoParaGestionar } from "@/lib/admin/reembolsos";
import { MENSAJE_DE_CAMBIO, MENSAJES_DE_REGISTRO } from "@/lib/admin/reembolsos-reglas";
import GestionarUnReembolso from "./page";

// Sin navegador ni base: la página de un reembolso con la sesión y el reembolso inventados, y se lee el HTML. Aquí se
// fija qué ve el admin en cada estado (criterios 1 a 3), que la llave de quien pagó se le pinta a cualquier admin
// activo en pendiente y reembolsado (HU-082, D-48), que el formulario de registrar sale en pendiente para cualquiera,
// y que nunca hay cifras de comisión. El recorrido con la base lo cubren la integración y la e2e.

const ID = "70000000-0000-4000-8000-000000000026";
const YO = "a0a0a0a0-0000-4000-8000-000000000026";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002601";
const LLAVE = "3001234567";

const rutas = vi.hoisted(() => ({ pedidas: [] as string[] }));
const datos = vi.hoisted(() => ({ reembolso: null as ReembolsoParaGestionar | null, falla: null as Error | null }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.pedidas.push(ruta);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/reembolsos", () => ({
  cargarReembolso: async () => {
    if (datos.falla) throw datos.falla;
    return datos.reembolso;
  },
  ejecutarReembolso: vi.fn(),
}));
vi.mock("@/lib/reembolsos/servidor", () => ({ reenviarPedidoDeLlave: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

/** 9:00 en Bogotá del 10 de enero de 2030. */
const AHORA = new Date("2030-01-10T14:00:00.000Z");

function reembolso(cambios: Partial<Omit<ReembolsoParaGestionar, "monitoria">> = {}): ReembolsoParaGestionar {
  return {
    id: ID,
    estadoVista: "pendiente",
    // 10:00 a. m. del 13 de enero en Bogotá.
    venceEn: new Date("2030-01-13T15:00:00.000Z"),
    cerradoEn: null,
    monto: 25_000,
    motivo: "Cancelaste la monitoría dentro del plazo.",
    nombrePagador: "Laura Pérez",
    contacto: "laura@uniandes.edu.co",
    llaveDestino: LLAVE,
    asignado: { id: YO, nombre: "Admin Uno" },
    registradoPor: null,
    fechaMinima: "2030-01-06",
    transferencia: null,
    monitoria: {
      estado: "cancelada",
      motivoCancelacion: "estudiante",
      fecha: "2030-01-15",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
    },
    ...cambios,
  };
}

const ESPERANDO = reembolso({ estadoVista: "esperando_llave", llaveDestino: null });
const VENCIDO = reembolso({ estadoVista: "cerrado", llaveDestino: null, venceEn: new Date("2030-01-09T15:00:00.000Z") });
const CERRADO = reembolso({ ...VENCIDO, cerradoEn: new Date("2030-01-09T15:10:00.000Z") });
const DE_OTRO = reembolso({ asignado: { id: OTRO, nombre: "Admin Dos" } });
const SIN_ADMIN = reembolso({ asignado: null });
const REEMBOLSADO = reembolso({
  estadoVista: "reembolsado",
  // Mediodía en Bogotá del 9 de enero: así se guarda el día de la transferencia.
  transferencia: { referencia: "REF-26-1", fecha: new Date("2030-01-09T17:00:00.000Z") },
  registradoPor: { id: YO, nombre: "Admin Uno" },
});

async function pintar(r: ReembolsoParaGestionar | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.reembolso = r;
  return renderToStaticMarkup(await GestionarUnReembolso({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();

/** El HTML sin el `<script>` que React pone al final para reenviar un formulario enviado antes de hidratar. */
const sinScriptDeReact = (html: string) => html.replace(/<script>[\s\S]*?<\/script>/g, "");

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  rutas.pedidas = [];
  datos.falla = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Gestionar un reembolso (HU-026): pendiente, del admin de la sesión (criterio 2)", () => {
  it("muestra el pagador, su correo, el monto, el motivo, el estado, a quién está asignado, la monitoría y la llave con su botón", async () => {
    const html = await pintar(reembolso());
    const t = texto(html);
    for (const dato of [
      "Reembolsos",
      "Transferir el reembolso",
      "Transfiere el monto a la llave de quien pagó desde la cuenta de Calibra y después registra la referencia y la fecha.",
      "Pagador Laura Pérez",
      "Correo de quien pagó laura@uniandes.edu.co",
      "Monto $ 25.000",
      "Motivo Cancelaste la monitoría dentro del plazo.",
      "Estado Listo para transferir",
      "Asignado a Admin Uno",
      "Materia Cálculo Diferencial",
      "Fecha 15 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Estado Cancelada",
      "Transferir $ 25.000",
      "Llave de quien pagó",
      "La que envió desde el enlace del correo. Revísala antes de transferir.",
      "Copiar llave",
      "Volver a mi bandeja",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toMatch(new RegExp(`<input id="llave-destino" readOnly=""[^>]*value="${LLAVE}"`));
    expect(rutas.pedidas).toEqual([`/admin/reembolsos/${ID}`]);
  });

  it("el formulario pide la referencia y la fecha (hoy por defecto, entre el día en que se creó y hoy)", async () => {
    const html = await pintar(reembolso());
    expect(html).toMatch(/<input id="referencia" type="text" maxLength="100"[^>]*required=""[^>]*name="referencia" value=""/);
    expect(html).toMatch(/<input id="fecha" type="date" min="2030-01-06" max="2030-01-10"[^>]*name="fecha" value="2030-01-10"/);
    expect(html).toContain(`<input type="hidden" name="id_reembolso" value="${ID}"/>`);
    expect(html).toContain('<input type="hidden" name="fecha_minima" value="2030-01-06"/>');
    expect(texto(html)).toContain("La que te da el banco al transferir. Hasta 100 caracteres.");
    expect(texto(html)).toContain("No puede ser posterior a hoy ni anterior al día en que se creó el reembolso.");
    // Quién registra lo pone la sesión, no el formulario.
    expect(html).not.toContain(YO);
  });

  it("hoy es el día en Bogotá, no el del servidor: a las 11 p. m. del 10 (en UTC ya es el 11) la fecha llega con el 10 y no deja pasar de él", async () => {
    // 04:00 UTC del 11 de enero = 11:00 p. m. del 10 en Bogotá.
    vi.setSystemTime(new Date("2030-01-11T04:00:00.000Z"));
    const html = await pintar(reembolso());
    expect(html).toMatch(/<input id="fecha" type="date" min="2030-01-06" max="2030-01-10"[^>]*name="fecha" value="2030-01-10"/);
  });

  it("el formulario entero (la referencia, la fecha y el botón) está dentro de la confirmación, que empieza cerrada: sin abrirla no hay dónde pulsar Enter", async () => {
    const html = await pintar(reembolso());
    expect(html.match(/<details/g)).toHaveLength(1);
    const inicio = html.indexOf("<details");
    const fin = html.indexOf("</details>");
    expect(html.slice(inicio, html.indexOf(">", inicio) + 1)).not.toContain("open");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Registrar la transferencia<\/summary>/);
    const dentro = html.slice(inicio, fin);
    const fuera = html.slice(0, inicio) + html.slice(fin);
    for (const pieza of ["<form", 'name="id_reembolso"', 'name="fecha_minima"', 'id="referencia"', 'id="fecha"', 'type="submit"', "No se puede deshacer."]) {
      expect(dentro, pieza).toContain(pieza);
      expect(fuera, pieza).not.toContain(pieza);
    }
    // Dentro, lo que se registra va antes de los campos, y el botón dice que confirma.
    const consecuencias = "Registra la transferencia de $ 25.000 a 3001234567. No se puede deshacer.";
    expect(texto(dentro)).toContain(consecuencias);
    expect(dentro.indexOf("No se puede deshacer.")).toBeLessThan(dentro.indexOf('id="referencia"'));
    expect(texto(dentro)).toContain("Sí, registrar la transferencia");
  });

  it("no ofrece reenviar el enlace: quien pagó ya envió su llave", async () => {
    const html = await pintar(reembolso());
    expect(texto(html)).not.toContain("Reenviar el enlace");
    expect(texto(html)).not.toContain("¿No le llegó el correo?");
  });
});

describe("Gestionar un reembolso: pendiente de otro admin o sin admin (HU-082, D-48)", () => {
  it.each([
    ["de otro admin", DE_OTRO, "Asignado a Admin Dos"],
    ["sin admin todavía (D-28)", SIN_ADMIN, "Asignado a Nadie todavía: en unos minutos se asigna al primer admin activo."],
  ])("%s: igual que al asignado, pinta la llave con «Copiar llave» y el formulario con su confirmación", async (_caso, r, asignado) => {
    const html = await pintar(r);
    const t = texto(html);
    expect(t).toContain("Transferir el reembolso");
    expect(t).toContain("Transfiere el monto a la llave de quien pagó desde la cuenta de Calibra y después registra la referencia y la fecha.");
    expect(t).toContain(asignado);
    expect(t).toContain("Estado Listo para transferir");
    expect(t).toContain("Transferir $ 25.000");
    expect(t).toContain("Llave de quien pagó");
    expect(t).toContain("Copiar llave");
    expect(html).toMatch(new RegExp(`<input id="llave-destino" readOnly=""[^>]*value="${LLAVE}"`));
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain('name="referencia"');
    expect(html).toContain('name="fecha"');
    expect(t).toContain("Registra la transferencia de $ 25.000 a 3001234567. No se puede deshacer.");
    expect(t).toContain("Sí, registrar la transferencia");
  });

  it("ya no dice que solo el asignado registra", async () => {
    for (const r of [DE_OTRO, SIN_ADMIN]) {
      const t = texto(await pintar(r));
      expect(t).not.toContain("solo esa persona registra");
      expect(t).not.toContain("Lo tiene asignado");
      expect(t).not.toContain("esa persona registra la transferencia");
    }
  });
});

describe("Gestionar un reembolso: esperando la llave (criterio 3)", () => {
  it("dice hasta cuándo puede enviarla y ofrece reenviar el enlace al correo de quien pagó, sin cambiar el plazo", async () => {
    const html = await pintar(ESPERANDO);
    const t = texto(html);
    expect(t).toContain("Esperando la llave");
    expect(t).toContain("Le pedimos la llave a quien pagó. Cuando la envíe, el reembolso queda listo para transferir.");
    expect(t).toContain("Estado Esperando la llave");
    expect(t).toContain("Plazo para enviar la llave Hasta el domingo, 13 de enero de 2030, 10:00 a. m.");
    expect(html).toContain('<time dateTime="2030-01-13T15:00:00.000Z">');
    expect(t).toContain("¿No le llegó el correo?");
    expect(t).toContain(
      "Le volvemos a mandar el enlace a laura@uniandes.edu.co. El plazo no cambia: sigue venciendo el domingo, 13 de enero de 2030, 10:00 a. m.",
    );
  });

  it("reenviar es un formulario común, sin confirmación: el id oculto y un solo botón secundario", async () => {
    const html = sinScriptDeReact(await pintar(ESPERANDO));
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).not.toContain("<details");
    expect(html).toContain(`<input type="hidden" name="id_reembolso" value="${ID}"/>`);
    expect(html).toMatch(/<button type="submit" aria-describedby="reenviar-explicacion"[^>]*>Reenviar el enlace<\/button>/);
    // Ni registrar ni la llave.
    expect(html).not.toContain('name="referencia"');
    expect(texto(html)).not.toContain("Registrar la transferencia");
  });

  it("también lo ofrece a un admin que no es el asignado: reenviar es de cualquier admin activo, como en la base", async () => {
    const html = await pintar(reembolso({ ...ESPERANDO, asignado: { id: OTRO, nombre: "Admin Dos" } }));
    expect(texto(html)).toContain("Reenviar el enlace");
    expect(texto(html)).toContain("Asignado a Admin Dos");
  });

  it.each([
    ["reenviado", "status", "Le mandamos otra vez el enlace a quien pagó. Le llega en unos minutos y el plazo no cambia."],
    ["fallo", "alert", "No pudimos reenviar el enlace. Intenta de nuevo; si sigue igual, avisa al equipo."],
  ])("tras reenviar con %s lo dice arriba con role=%s", async (reenvio, rol, mensaje) => {
    const html = await pintar(ESPERANDO, { reenvio });
    expect(html).toMatch(new RegExp(`<p role="${rol}"[^>]*>${mensaje.replace(/\./g, "\\.")}</p>`));
  });
});

describe("Gestionar un reembolso: cerrado sin llave (supuesto 11)", () => {
  it.each([
    ["vencido, antes de que corra el cierre", VENCIDO, false],
    ["ya cerrado por pg_cron", CERRADO, true],
  ])("%s: lo muestra sin ningún formulario y remite a la bandeja para reabrirlo", async (_caso, r, conCierre) => {
    const html = sinScriptDeReact(await pintar(r));
    const t = texto(html);
    expect(t).toContain("Caso cerrado sin llave");
    expect(t).toContain("Pasó el plazo sin que quien pagó enviara su llave.");
    expect(t).toContain("Estado Cerrado sin llave");
    expect(t).toContain("Plazo para enviar la llave Terminó el miércoles, 9 de enero de 2030, 10:00 a. m.");
    expect(t).toContain(
      "Si quien pagó te escribe, reábrelo desde “Cerrados sin llave”, en tu bandeja. Si acaba de vencer, puede tardar hasta 15 minutos en aparecer ahí.",
    );
    // Ni registrar, ni reenviar, ni reabrir (el formulario de la bandeja usa name="reembolso").
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="reembolso"');
    expect(html).not.toContain("<button");
    expect(t).not.toContain("Reenviar el enlace");
    if (conCierre) {
      expect(t).toContain("Cierre Se cerró el miércoles, 9 de enero de 2030, 10:10 a. m.");
      expect(html).toContain('<time dateTime="2030-01-09T15:10:00.000Z">');
    } else {
      expect(t).not.toContain("Se cerró");
    }
  });
});

describe("Gestionar un reembolso: reembolsado", () => {
  it("muestra la referencia, la fecha y quién lo registró, sin formularios, y la llave", async () => {
    const html = sinScriptDeReact(await pintar(REEMBOLSADO));
    const t = texto(html);
    expect(t).toContain("Reembolso registrado");
    expect(t).toContain("Estado Reembolsado");
    expect(t).toContain("Referencia REF-26-1");
    expect(t).toContain("Fecha de la transferencia 9 de enero de 2030");
    expect(html).toContain('<time dateTime="2030-01-09">');
    expect(t).toContain("Registrado por Admin Uno");
    expect(t).toContain(`Llave de quien pagó ${LLAVE}`);
    expect(html).not.toContain("<form");
    expect(t).not.toContain("Copiar llave");
    // En un reembolsado se dice quién lo registró, no a quién estaba asignado (pregunta 2 de HU-082).
    expect(t).not.toContain("Asignado a");
  });

  it("lo registró otro admin: dice quién, distinto del asignado, y cualquier admin activo ve la llave", async () => {
    const html = await pintar(reembolso({ ...REEMBOLSADO, registradoPor: { id: OTRO, nombre: "Admin Dos" } }));
    const t = texto(html);
    expect(t).toContain("Registrado por Admin Dos");
    expect(t).not.toContain("Registrado por Admin Uno");
    expect(t).toContain(`Llave de quien pagó ${LLAVE}`);
  });

  it("el asignado no registró (id_admin_registro de otro) y la sesión es el asignado: la llave se ve igual", async () => {
    const html = await pintar(reembolso({ ...REEMBOLSADO, asignado: { id: OTRO, nombre: "Admin Dos" }, registradoPor: { id: YO, nombre: "Admin Uno" } }));
    expect(texto(html)).toContain("Registrado por Admin Uno");
    expect(texto(html)).toContain(`Llave de quien pagó ${LLAVE}`);
  });

  it("sin dato de quién lo registró dice Sin dato, aunque haya asignado", async () => {
    const html = await pintar(reembolso({ ...REEMBOLSADO, registradoPor: null }));
    expect(texto(html)).toContain("Registrado por Sin dato");
    expect(texto(html)).not.toContain("Registrado por Admin Uno");
  });

  it("tras registrarla, el éxito es un role=status; un enlace viejo o el de otro admin no lo anuncia", async () => {
    const exito = await pintar(REEMBOLSADO, { registrado: "reembolsado" });
    expect(exito).toMatch(
      /<p role="status"[^>]*>Registraste la transferencia\. Quien pagó ve en su enlace que ya le devolvimos el dinero\.<\/p>/,
    );
    expect(await pintar(reembolso(), { registrado: "reembolsado" })).not.toContain("Registraste");
    // Lo registró otro admin: aunque la sesión sea la del asignado, no anuncia una transferencia que no registró.
    expect(await pintar(reembolso({ ...REEMBOLSADO, registradoPor: { id: OTRO, nombre: "Admin Dos" } }), { registrado: "reembolsado" })).not.toContain("Registraste");
    expect(await pintar(reembolso({ ...REEMBOLSADO, registradoPor: null }), { registrado: "reembolsado" })).not.toContain("Registraste");
  });

  it("si ya estaba registrado, la alerta pide no transferirlo de nuevo", async () => {
    const html = await pintar(REEMBOLSADO, { error: "ya_reembolsado" });
    expect(html).toContain('<p role="alert" class="');
    expect(texto(html)).toContain(MENSAJES_DE_REGISTRO.ya_reembolsado);
  });
});

describe("Gestionar un reembolso: lo que cambió mientras el admin miraba", () => {
  it("sin_llave vuelve como alerta y la página se pinta como quedó", async () => {
    const html = await pintar(ESPERANDO, { error: "sin_llave" });
    expect(html).toMatch(/<p role="alert"/);
    expect(texto(html)).toContain(MENSAJE_DE_CAMBIO);
  });

  it("no_asignado ya no es un cambio que se diga: la base no lo responde", async () => {
    const html = await pintar(DE_OTRO, { error: "no_asignado" });
    expect(html).not.toContain('role="alert"');
  });
});

describe("Gestionar un reembolso: lo que se pinta", () => {
  it("nunca habla de bruto ni de comisión, en ningún estado", async () => {
    for (const r of [reembolso(), DE_OTRO, SIN_ADMIN, ESPERANDO, VENCIDO, CERRADO, REEMBOLSADO]) {
      const html = (await pintar(r)).toLowerCase();
      expect(html).not.toContain("comisi");
      expect(html).not.toContain("bruto");
    }
  });

  it("escapa lo que viene de la base: el motivo, el pagador, el correo y la llave", async () => {
    const html = await pintar(
      reembolso({
        motivo: '<img src=x onerror="alert(1)">',
        nombrePagador: "<b>Laura</b>",
        contacto: "<i>correo</i>",
        llaveDestino: "<script>alert(2)</script>",
      }),
    );
    // El único <img> es el logo de la pantalla.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<b>Laura");
    expect(html).not.toContain("<i>correo");
    // El único <script> es el que React pone para reenviar el formulario si se envía antes de hidratar.
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('value="&lt;script&gt;alert(2)&lt;/script&gt;"');
    expect(html).toContain("a &lt;script&gt;alert(2)&lt;/script&gt;. No se puede deshacer.");
  });
});

describe("Gestionar un reembolso: lo que no existe", () => {
  it("un id que no es un uuid es un 404", async () => {
    await expect(pintar(reembolso(), {}, "no-es-un-id")).rejects.toThrow("notFound");
  });

  it("un reembolso que no existe (o que la sesión no puede leer) es un 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("un error de la base no es un 404: lo dice como alerta y deja volver a la bandeja", async () => {
    datos.falla = new Error("se cayó la base");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await pintar(reembolso());
    espia.mockRestore();
    expect(texto(html)).toContain("No pudimos cargar el reembolso");
    expect(html).toMatch(/<p role="alert"[^>]*>Recarga la página; si sigue igual, avisa al equipo\.<\/p>/);
    expect(texto(html)).toContain("Volver a mi bandeja");
  });
});
