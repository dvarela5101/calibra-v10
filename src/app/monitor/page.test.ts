import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leerHtml, porEtiqueta, textoDe, type Nodo } from "../../../pruebas/arbol-html";
import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";

// HU-022, criterio 16, HU-123 y HU-140: el panel del monitor. Sin navegador ni base: la sesión, las consultas y la agenda son inventadas.
// Se mira el subtítulo, que el panel no gane regiones de estado (la e2e de finalizar afirma un `status` único, el del recordatorio), el
// calendario de franjas (que sale con certificados y no sin ellos, el día elegido, los tres estados, el mes y el botón de agregar), las
// cuatro tarjetas con su dato y que la llave ya no está en el panel. «Hoy» es el miércoles 18 de noviembre de 2026, en Bogotá.

type Proxima = { id: string; estado: "confirmada" | "pendiente_pago"; dia: string; hora?: string };
type FranjaInventada = {
  id: string;
  dia: number;
  hora: string;
  duracion_min: number;
  presencial: boolean;
  precio: number;
  abierta_desde: string;
  cerrada_desde: string | null;
};

const datos = vi.hoisted(() => ({
  certificados: [] as { id: string; fecha_emision: string; materia: { nombre: string; codigo: string } | null }[],
  errorDeCertificados: null as { message: string } | null,
  porFinalizar: false,
  proximas: [] as Proxima[],
  agendaFalla: false,
  franjas: [] as FranjaInventada[],
  errorDeFranjas: null as { message: string } | null,
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "d0d0d0d0-0000-4000-8000-000000000022", rol: "monitor" }) }));
vi.mock("@/lib/agenda/servidor", () => ({
  cargarAgenda: async () => {
    if (datos.agendaFalla) throw new Error("falló la agenda");
    const proximas = datos.proximas.map((p) => ({
      idMonitoria: p.id,
      fecha: p.dia,
      hora: p.hora ?? "14:00:00",
      duracionMin: 60,
      presencial: p.id === "p1",
      nombreMateria: "Cálculo I",
      codigoMateria: "MATE-1203",
      nombreEstudiante: "Valeria",
      estado: p.estado,
      motivoCancelacion: null,
      reservaVencida: false,
      estadoPago: "aprobado",
      inicio: new Date(`${p.dia}T19:00:00Z`),
    }));
    const porFinalizar = datos.porFinalizar
      ? [
          {
            idMonitoria: "5a5a5a5a-0000-4000-8000-000000000022",
            fecha: "2026-10-05",
            hora: "10:00:00",
            duracionMin: 60,
            presencial: true,
            nombreMateria: "Física II",
            codigoMateria: "FISI-1528",
            nombreEstudiante: "Camila",
            estado: "confirmada",
            motivoCancelacion: null,
            reservaVencida: false,
            estadoPago: "aprobado",
            inicio: new Date("2026-10-05T15:00:00Z"),
          },
        ]
      : [];
    return [...porFinalizar, ...proximas];
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: async () => ({
    from: (tabla: string) => {
      const respuesta =
        tabla === "monitor"
          ? { data: { nombre: "Andrés" }, error: null }
          : tabla === "franja"
            ? { data: datos.errorDeFranjas ? null : datos.franjas, error: datos.errorDeFranjas }
            : { data: datos.errorDeCertificados ? null : datos.certificados, error: datos.errorDeCertificados };
      // La consulta se encadena y se espera tal cual (certificados, franjas) o con `maybeSingle()` (monitor).
      const consulta: Record<string, unknown> = {
        select: () => consulta,
        eq: () => consulta,
        order: () => consulta,
        maybeSingle: async () => respuesta,
        then: (alResolver: (valor: unknown) => unknown) => alResolver(respuesta),
      };
      return consulta;
    },
  }),
}));
// El cierre de sesión es del servidor y del navegador: aquí no importa.
vi.mock("@/components/BotonSalir", () => ({ BotonSalir: () => null }));

import PanelMonitor from "./page";

const CERTIFICADO = { id: "c1", fecha_emision: "2026-09-01", materia: { nombre: "Física II", codigo: "FISI-1528" } };
const HOY = "2026-11-18";

const franja = (id: string, extra: Partial<FranjaInventada> = {}): FranjaInventada => ({
  id,
  dia: 4,
  hora: "10:00:00",
  duracion_min: 60,
  presencial: false,
  precio: 25000,
  abierta_desde: "2026-01-01",
  cerrada_desde: null,
  ...extra,
});

async function pintar(direccion: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await PanelMonitor({ params: Promise.resolve({}), searchParams: Promise.resolve(direccion) }));
}

/** El subtítulo de la pantalla: el párrafo que sigue al título. */
function subtituloDe(html: string): string {
  const arbol = leerHtml(html);
  const principal = porEtiqueta(arbol, "main")[0];
  const h1 = porEtiqueta(principal, "h1")[0];
  const hermanos = principal.hijos;
  const siguiente = hermanos[hermanos.indexOf(h1) + 1];
  if (typeof siguiente === "string") throw new Error("Después del título no hay un subtítulo.");
  return textoDe(siguiente);
}

/** La sección «Tu calendario», o `undefined` si el panel no la tiene. */
function calendarioDe(html: string): Nodo | undefined {
  return porEtiqueta(leerHtml(html), "section").find((s) => {
    const titulo = porEtiqueta(s, "h2")[0];
    return titulo !== undefined && textoDe(titulo) === "Tu calendario";
  });
}

/** El panel del día dentro del calendario. */
const panelDe = (html: string): Nodo => porEtiqueta(calendarioDe(html)!, "section")[0];

/** El grupo con ese nombre accesible dentro del calendario. */
const grupoDe = (html: string, nombre: string): Nodo | undefined =>
  porEtiqueta(calendarioDe(html)!, "div").find((d) => d.atributos["aria-label"] === nombre);

/** Las cuatro tarjetas del panel: nombre del enlace, destino y el dato de estado, que va fuera del enlace. */
function tarjetasDe(html: string): { nombre: string; href: string | undefined; dato: string }[] {
  const lista = porEtiqueta(leerHtml(html), "ul").find((ul) => {
    const items = porEtiqueta(ul, "li");
    return items.length > 0 && items.every((li) => porEtiqueta(li, "a").length === 1 && porEtiqueta(li, "p").length === 1);
  })!;
  return porEtiqueta(lista, "li").map((li) => {
    const enlace = porEtiqueta(li, "a")[0];
    return { nombre: textoDe(enlace), href: enlace.atributos.href, dato: textoDe(porEtiqueta(li, "p")[0]) };
  });
}

beforeEach(() => {
  // Solo se finge la fecha: las promesas del panel siguen su curso normal.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
  datos.certificados = [CERTIFICADO];
  datos.errorDeCertificados = null;
  datos.porFinalizar = false;
  datos.proximas = [];
  datos.agendaFalla = false;
  datos.franjas = [];
  datos.errorDeFranjas = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("el panel del monitor certificado (criterio 16)", () => {
  it("dice el texto de la HU y ya no dice «Pronto»", async () => {
    const html = await pintar();
    expect(subtituloDe(html)).toBe(
      "Abre tus franjas para que te agenden. En tu agenda ves quién agendó y abres el diagnóstico de cada cita confirmada o realizada.",
    );
    expect(subtituloDe(html)).toBe(TEXTOS.panel);
    expect(textoDe(leerHtml(html))).not.toContain("Pronto");
    expect(html).not.toContain("Pronto");
  });

  it("sigue teniendo los enlaces a su agenda y a sus franjas", async () => {
    const enlaces = porEtiqueta(leerHtml(await pintar()), "a").map((a) => [textoDe(a), a.atributos.href]);
    expect(enlaces).toContainEqual(["Mi agenda", "/monitor/agenda"]);
    expect(enlaces).toContainEqual(["Mis franjas", "/monitor/franjas"]);
  });

  it("no gana ninguna región de estado: sin citas por finalizar no hay `status`, y con ellas hay uno solo (M53)", async () => {
    expect(await pintar()).not.toContain('role="status"');
    expect(await pintar({ vista: "mes" })).not.toContain('role="status"');
    datos.porFinalizar = true;
    const html = await pintar();
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain("aria-live");
    expect(textoDe(leerHtml(html))).toContain("Tienes 1 monitoría por finalizar.");
    expect(subtituloDe(html)).toBe(TEXTOS.panel);
  });
});

describe("el calendario (HU-140)", () => {
  it("sale con certificados, reemplaza la tarjeta «Tu próxima monitoría» y va después del recordatorio", async () => {
    datos.porFinalizar = true;
    const html = await pintar();
    const calendario = calendarioDe(html)!;
    expect(calendario).toBeDefined();
    expect(porEtiqueta(calendario, "h2").map((h) => textoDe(h))).toEqual(["Tu calendario"]);
    expect(html).not.toContain("Tu próxima monitoría");
    expect(html).not.toContain("Ver los detalles");
    expect(html.indexOf("por finalizar")).toBeLessThan(html.indexOf("Tu calendario"));
    expect(html.indexOf("Tu calendario")).toBeLessThan(html.indexOf("Tus materias certificadas"));
  });

  it("no sale sin certificados", async () => {
    datos.certificados = [];
    const html = await pintar();
    expect(calendarioDe(html)).toBeUndefined();
    expect(html).not.toContain("Tu calendario");
  });

  it("por defecto muestra la semana de hoy y elige hoy", async () => {
    const html = await pintar();
    const tira = grupoDe(html, "Días de la semana")!;
    const dias = porEtiqueta(tira, "a");
    expect(dias).toHaveLength(7);
    expect(dias.map((a) => a.atributos.href)).toEqual(
      ["16", "17", "18", "19", "20", "21", "22"].map((d) => `/monitor?vista=semana&dia=2026-11-${d}`),
    );
    const elegidos = dias.filter((a) => a.atributos["aria-current"] === "date");
    expect(elegidos).toHaveLength(1);
    expect(elegidos[0].atributos["aria-label"]).toBe("miércoles 18 de noviembre (hoy), sin franjas");
    expect(textoDe(porEtiqueta(panelDe(html), "h3")[0])).toBe("miércoles 18 de noviembre");
    expect(textoDe(calendarioDe(html)!)).toContain("16 a 22 de nov.");
    const conmutador = porEtiqueta(grupoDe(html, "Vista del calendario")!, "a");
    expect(conmutador.map((a) => [textoDe(a), a.atributos["aria-current"]])).toEqual([
      ["Semana", "true"],
      ["Mes", undefined],
    ]);
  });

  it("la navegación son enlaces con nombre accesible y sin scroll al navegar", async () => {
    const html = await pintar({ dia: "2026-11-30" });
    const enlaces = porEtiqueta(grupoDe(html, "Cambiar de periodo")!, "a");
    expect(enlaces.map((a) => [a.atributos["aria-label"], a.atributos.href])).toEqual([
      ["Semana anterior", "/monitor?vista=semana&dia=2026-11-23"],
      ["Semana siguiente", "/monitor?vista=semana&dia=2026-12-07"],
    ]);
    expect(textoDe(calendarioDe(html)!)).toContain("30 de nov. a 6 de dic.");
    const hoy = porEtiqueta(calendarioDe(html)!, "a").find((a) => textoDe(a) === "Hoy")!;
    expect(hoy.atributos.href).toBe(`/monitor?vista=semana&dia=${HOY}`);
  });

  it("valores inválidos de la dirección caen a hoy y a la semana", async () => {
    const html = await pintar({ vista: "año", dia: "2026-02-30" });
    expect(grupoDe(html, "Días de la semana")).toBeDefined();
    expect(grupoDe(html, "Días del mes")).toBeUndefined();
    expect(textoDe(porEtiqueta(panelDe(html), "h3")[0])).toBe("miércoles 18 de noviembre");
  });

  it("un día con una franja libre, una reservada y una por pagar las muestra con su etiqueta, su precio y a dónde llevan", async () => {
    datos.franjas = [
      franja("f-libre", { hora: "10:00:00" }),
      franja("f-reservada", { hora: "14:00:00", presencial: true }),
      franja("f-por-pagar", { hora: "16:00:00" }),
    ];
    datos.proximas = [
      { id: "p1", estado: "confirmada", dia: "2026-11-19", hora: "14:00:00" },
      { id: "p2", estado: "pendiente_pago", dia: "2026-11-19", hora: "16:00:00" },
    ];
    const html = await pintar({ dia: "2026-11-19" });
    const panel = panelDe(html);
    expect(textoDe(porEtiqueta(panel, "h3")[0])).toBe("jueves 19 de noviembre");
    expect(textoDe(panel)).toContain("3 franjas · 1 libre");

    const items = porEtiqueta(panel, "li");
    expect(items).toHaveLength(3);
    const [libre, reservada, porPagar] = items.map((li) => ({ texto: textoDe(li), enlace: porEtiqueta(li, "a")[0] }));

    expect(textoDe(libre.enlace)).toBe("10:00 a 11:00");
    expect(libre.enlace.atributos.href).toBe("/monitor/franjas/f-libre");
    expect(libre.texto).toContain("Libre");
    expect(libre.texto).toContain("Virtual");
    expect(libre.texto).toMatch(/25\.000/);
    expect(libre.texto).not.toContain("Agendó");

    expect(textoDe(reservada.enlace)).toBe("14:00 a 15:00");
    expect(reservada.enlace.atributos.href).toBe("/monitor/agenda");
    expect(reservada.texto).toContain("Reservada");
    expect(reservada.texto).toContain("Presencial");
    expect(reservada.texto).toContain("Agendó: Valeria · Cálculo I");

    expect(textoDe(porPagar.enlace)).toBe("16:00 a 17:00");
    expect(porPagar.enlace.atributos.href).toBe("/monitor/agenda");
    expect(porPagar.texto).toContain("Por pagar");
    expect(porPagar.texto).toContain("Agendó: Valeria");

    // La tira marca el día con tres franjas.
    const dia19 = porEtiqueta(grupoDe(html, "Días de la semana")!, "a").find((a) => a.atributos["aria-current"] === "date")!;
    expect(dia19.atributos["aria-label"]).toBe("jueves 19 de noviembre, 3 franjas");
  });

  it("en la rejilla por horas cada franja es un enlace que elige ese día", async () => {
    datos.franjas = [franja("f-libre")];
    const html = await pintar();
    const horas = grupoDe(html, "Semana por horas")!;
    const bloques = porEtiqueta(horas, "a").filter((a) => (a.atributos.style ?? "").includes("--hora-px"));
    expect(bloques).toHaveLength(1);
    expect(bloques[0].atributos.href).toBe("/monitor?vista=semana&dia=2026-11-19");
    expect(textoDe(bloques[0])).toBe("10:00Libre");
    expect(bloques[0].atributos["aria-label"]).toBe("jueves 19 de noviembre, de 10:00 a 11:00, libre");
  });

  it("una franja libre de un día pasado no sale, y una cerrada no sale desde su cierre", async () => {
    datos.franjas = [franja("f-pasada", { dia: 1 }), franja("f-cerrada", { dia: 4, cerrada_desde: "2026-11-19" })];
    const html = await pintar({ dia: "2026-11-16" });
    expect(textoDe(panelDe(html))).toContain("Sin franjas este día");
    expect(porEtiqueta(panelDe(html), "li")).toHaveLength(0);
    expect(textoDe(porEtiqueta(grupoDe(await pintar({ dia: "2026-11-19" }), "Días de la semana")!, "a")[3])).not.toContain("+");
  });

  it("?vista=mes pinta la rejilla del mes con sus semanas completas", async () => {
    datos.franjas = [franja("f-libre")];
    const html = await pintar({ vista: "mes" });
    const mes = grupoDe(html, "Días del mes")!;
    expect(grupoDe(html, "Días de la semana")).toBeUndefined();
    expect(grupoDe(html, "Semana por horas")).toBeUndefined();
    // Noviembre de 2026 va del lunes 26 de octubre al domingo 6 de diciembre: seis semanas.
    const dias = porEtiqueta(mes, "a");
    expect(dias).toHaveLength(42);
    expect(dias[0].atributos.href).toBe("/monitor?vista=mes&dia=2026-10-26");
    expect(dias[41].atributos.href).toBe("/monitor?vista=mes&dia=2026-12-06");
    expect(textoDe(calendarioDe(html)!)).toContain("Noviembre de 2026");
    expect(porEtiqueta(mes, "span").map((s) => textoDe(s))).toEqual(expect.arrayContaining(["lun", "dom"]));
    const elegidos = dias.filter((a) => a.atributos["aria-current"] === "date");
    expect(elegidos.map((a) => a.atributos["aria-label"])).toEqual(["miércoles 18 de noviembre (hoy), sin franjas"]);
    expect(dias.find((a) => a.atributos.href?.endsWith("2026-11-19"))!.atributos["aria-label"]).toBe("jueves 19 de noviembre, 1 franja");
    const conmutador = porEtiqueta(grupoDe(html, "Vista del calendario")!, "a");
    expect(conmutador.map((a) => a.atributos["aria-current"])).toEqual([undefined, "true"]);
    const nav = porEtiqueta(grupoDe(html, "Cambiar de periodo")!, "a").map((a) => [a.atributos["aria-label"], a.atributos.href]);
    // El mes de hoy cae en hoy, no en el día 1.
    expect(nav).toEqual([
      ["Mes anterior", "/monitor?vista=mes&dia=2026-10-01"],
      ["Mes siguiente", "/monitor?vista=mes&dia=2026-12-01"],
    ]);
    // Debajo, el mismo panel del día.
    expect(textoDe(porEtiqueta(panelDe(html), "h3")[0])).toBe("miércoles 18 de noviembre");
  });

  it("de hoy en adelante se puede agregar una franja, con el formulario dentro; en un día pasado no", async () => {
    for (const dia of [HOY, "2026-11-25", "2027-02-01"]) {
      const html = await pintar({ dia });
      const panel = panelDe(html);
      const detalles = porEtiqueta(panel, "details");
      expect(detalles, dia).toHaveLength(1);
      expect(textoDe(porEtiqueta(detalles[0], "summary")[0])).toBe("Agregar una franja este día");
      const campos = porEtiqueta(detalles[0], "input", "select").map((c) => c.atributos.name);
      expect(campos).toEqual(expect.arrayContaining(["fecha", "hora", "duracion_min", "precio", "modalidad", "repite", "semanas"]));
      expect(campos).not.toContain("dia");
      expect(porEtiqueta(detalles[0], "input").find((i) => i.atributos.name === "fecha")!.atributos.value).toBe(dia);
    }
    for (const dia of ["2026-11-17", "2026-11-01", "2025-12-31"]) {
      const html = await pintar({ dia });
      expect(textoDe(panelDe(html)), dia).not.toContain("Agregar una franja");
      expect(porEtiqueta(panelDe(html), "details"), dia).toHaveLength(0);
      expect(porEtiqueta(panelDe(html), "form"), dia).toHaveLength(0);
    }
  });

  it("el formulario no envía `dia`, tiene todas las etiquetas y su texto de repetición, y el éxito no es un status", async () => {
    const html = await pintar({ dia: "2026-11-19" });
    const formulario = porEtiqueta(panelDe(html), "form")[0];
    const etiquetas = porEtiqueta(formulario, "label").map((l) => l.atributos.for).filter(Boolean);
    const ids = porEtiqueta(formulario, "input", "select").map((c) => c.atributos.id).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id!.startsWith("nueva-"), id).toBe(true);
      expect(etiquetas, id).toContain(id);
    }
    const texto = textoDe(formulario);
    expect(texto).toContain("Cada jueves durante N semanas");
    expect(texto).toContain("Solo este día");
    expect(texto).toContain("Todas las semanas, sin fecha final");
    expect(texto).toContain("Quedará abierta el 19 y el 26 de noviembre, y el 3 y el 10 de diciembre, y así cada jueves, sin fecha final.");
    const repite = porEtiqueta(formulario, "input").filter((i) => i.atributos.name === "repite");
    expect(repite.map((i) => [i.atributos.value, "checked" in i.atributos])).toEqual([
      ["una", false],
      ["semanas", false],
      ["siempre", true],
    ]);
    expect(html).not.toContain('role="status"');
  });

  it("si la agenda falla dice «No pudimos cargar tu calendario.» con alert, sin status, y el resto del panel funciona", async () => {
    datos.agendaFalla = true;
    const html = await pintar();
    const calendario = calendarioDe(html)!;
    expect(textoDe(calendario)).toContain("No pudimos cargar tu calendario.");
    expect(porEtiqueta(calendario, "p")[0].atributos.role).toBe("alert");
    expect(porEtiqueta(calendario, "a")).toHaveLength(0);
    expect(html).not.toContain('role="status"');
    expect(tarjetasDe(html).map((t) => t.nombre)).toEqual(["Mi agenda", "Mis franjas", "Mis desembolsos", "Mi perfil"]);
    expect(textoDe(leerHtml(html))).toContain("Tus materias certificadas");
  });

  it("si las franjas no cargan, también", async () => {
    datos.errorDeFranjas = { message: "falló" };
    const html = await pintar();
    expect(textoDe(calendarioDe(html)!)).toContain("No pudimos cargar tu calendario.");
    expect(tarjetasDe(html).map((t) => t.nombre)).toEqual(["Mi agenda", "Mis franjas", "Mis desembolsos", "Mi perfil"]);
  });
});

describe("las cuatro tarjetas del panel (HU-123)", () => {
  it("el enlace dice solo el nombre y el dato va aparte; sin datos, textos de reposo", async () => {
    expect(tarjetasDe(await pintar())).toEqual([
      { nombre: "Mi agenda", href: "/monitor/agenda", dato: "Sin monitorías próximas" },
      { nombre: "Mis franjas", href: "/monitor/franjas", dato: "Ninguna abierta" },
      { nombre: "Mis desembolsos", href: "/monitor/desembolsos", dato: "Lo que has recibido y lo que viene" },
      { nombre: "Mi perfil", href: "/monitor/perfil", dato: "Carrera, semestre, presentación y tu llave" },
    ]);
  });

  it("cuenta las próximas y las franjas abiertas, con singular y plural; una franja ya cerrada no cuenta", async () => {
    datos.proximas = [{ id: "p1", estado: "confirmada", dia: "2099-03-05" }];
    datos.franjas = [franja("f1"), franja("f2", { cerrada_desde: "2099-01-01" }), franja("f3", { cerrada_desde: "2020-01-01" })];
    let tarjetas = tarjetasDe(await pintar());
    expect(tarjetas[0].dato).toBe("1 próxima");
    expect(tarjetas[1].dato).toBe("2 abiertas");
    datos.proximas.push({ id: "p2", estado: "pendiente_pago", dia: "2099-03-06" });
    datos.franjas = [franja("f1")];
    tarjetas = tarjetasDe(await pintar());
    expect(tarjetas[0].dato).toBe("2 próximas");
    expect(tarjetas[1].dato).toBe("1 abierta");
  });

  it("ningún otro enlace repite el nombre de una tarjeta (ni en su texto ni en su nombre accesible) y no hay cifras de comisión", async () => {
    datos.proximas = [{ id: "p1", estado: "confirmada", dia: "2026-11-19" }];
    datos.franjas = [franja("f1"), franja("f2", { hora: "14:00:00" })];
    datos.porFinalizar = true;
    for (const direccion of [{}, { vista: "mes" }, { dia: "2026-11-19" }] as Record<string, string>[]) {
      const html = await pintar(direccion);
      const nombres = porEtiqueta(leerHtml(html), "a").map((a) => `${textoDe(a)} ${a.atributos["aria-label"] ?? ""}`.toLowerCase());
      for (const nombre of ["mi agenda", "mis franjas", "mis desembolsos", "mi perfil"]) {
        expect(nombres.filter((n) => n.includes(nombre)), nombre).toHaveLength(1);
      }
      expect(html).not.toMatch(/comisi|bruto|neto/i);
    }
  });

  it("sin franjas ni monitorías no hay cifras de dinero en el panel", async () => {
    datos.porFinalizar = true;
    // El texto visible: el marcado lleva el script de React del formulario, que tiene sus propios «$».
    expect(textoDe(porEtiqueta(leerHtml(await pintar()), "main")[0])).not.toMatch(/\$|COP/);
  });

  it("el recordatorio va arriba de todo, con su botón a la agenda, y sigue habiendo un solo status", async () => {
    datos.porFinalizar = true;
    const html = await pintar();
    expect(html.indexOf("por finalizar")).toBeLessThan(html.indexOf("Tu calendario"));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const enlace = porEtiqueta(leerHtml(html), "a").find((a) => textoDe(a) === "Finalizarla ahora");
    expect(enlace?.atributos.href).toBe("/monitor/agenda");
  });

  it("el panel ya no tiene el formulario de la llave", async () => {
    const html = await pintar();
    expect(html).not.toContain('name="llave');
    expect(html).not.toContain("Guardar mi llave");
    expect(html).not.toContain("Tu llave para recibir pagos");
  });
});

describe("el panel de quien todavía no tiene certificados", () => {
  it("conserva su texto de espera y no habla del diagnóstico", async () => {
    datos.certificados = [];
    const html = await pintar();
    expect(subtituloDe(html)).toBe(
      "Tu cuenta está lista. Espera a que un admin te certifique en tu materia: cuando lo haga, podrás abrir tus franjas y recibir estudiantes.",
    );
    expect(subtituloDe(html)).not.toContain("diagnóstico");
  });

  it("muestra los tres pasos con el actual marcado y solo la tarjeta de «Mi perfil»", async () => {
    datos.certificados = [];
    const html = await pintar();
    const items = porEtiqueta(porEtiqueta(leerHtml(html), "ol")[0], "li");
    expect(items.map((li) => textoDe(li))).toEqual([
      expect.stringContaining("Cuenta creada"),
      expect.stringContaining("Certificación pendiente"),
      expect.stringContaining("Abrir tus franjas"),
    ]);
    expect(items.map((li) => li.atributos["aria-current"])).toEqual([undefined, "step", undefined]);
    expect(tarjetasDe(html).map((t) => t.nombre)).toEqual(["Mi perfil"]);
    expect(html).not.toContain("Tu próxima monitoría");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});
