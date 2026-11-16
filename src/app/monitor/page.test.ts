import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerHtml, porEtiqueta, textoDe } from "../../../pruebas/arbol-html";
import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";

// HU-022, criterio 16 y HU-123: el panel del monitor. Sin navegador ni base: la sesión, las consultas y la agenda son inventadas. Se mira
// el subtítulo, que el panel no gane regiones de estado (la e2e de finalizar afirma un `status` único, el del recordatorio), la tarjeta
// de la próxima monitoría, las cuatro tarjetas con su dato y que la llave ya no está en el panel.

type Proxima = { id: string; estado: "confirmada" | "pendiente_pago"; dia: string };

const datos = vi.hoisted(() => ({
  certificados: [] as { id: string; fecha_emision: string; materia: { nombre: string; codigo: string } | null }[],
  errorDeCertificados: null as { message: string } | null,
  porFinalizar: false,
  proximas: [] as Proxima[],
  agendaFalla: false,
  franjas: [] as { id: string; cerrada_desde: string | null }[],
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "d0d0d0d0-0000-4000-8000-000000000022", rol: "monitor" }) }));
vi.mock("@/lib/agenda/servidor", () => ({
  cargarAgenda: async () => {
    if (datos.agendaFalla) throw new Error("falló la agenda");
    const proximas = datos.proximas.map((p) => ({
      idMonitoria: p.id,
      fecha: p.dia,
      hora: "14:00:00",
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
            ? { data: datos.franjas, error: null }
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

async function pintar(): Promise<string> {
  return renderToStaticMarkup(await PanelMonitor());
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

/** La tarjeta «Tu próxima monitoría». */
function proximaDe(html: string) {
  return porEtiqueta(leerHtml(html), "section").find((s) => textoDe(porEtiqueta(s, "h2")[0]) === "Tu próxima monitoría")!;
}

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
  datos.certificados = [CERTIFICADO];
  datos.errorDeCertificados = null;
  datos.porFinalizar = false;
  datos.proximas = [];
  datos.agendaFalla = false;
  datos.franjas = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    datos.porFinalizar = true;
    const html = await pintar();
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(textoDe(leerHtml(html))).toContain("Tienes 1 monitoría por finalizar.");
    expect(subtituloDe(html)).toBe(TEXTOS.panel);
  });
});

describe("la tarjeta «Tu próxima monitoría» (HU-123)", () => {
  it("con próximas muestra la primera: día, hora, materia, estudiante y modalidad, y su botón lleva a la agenda", async () => {
    datos.proximas = [
      { id: "p2", estado: "confirmada", dia: "2099-03-10" },
      { id: "p1", estado: "confirmada", dia: "2099-03-05" },
    ];
    const seccion = proximaDe(await pintar());
    const texto = textoDe(seccion);
    expect(texto).toContain("5 de marzo");
    expect(texto).toContain("14:00");
    expect(texto).toContain("Cálculo I · Presencial");
    expect(texto).toContain("Agendó: Valeria");
    expect(texto).toContain("Confirmada");
    const boton = porEtiqueta(seccion, "a")[0];
    expect([textoDe(boton), boton.atributos.href]).toEqual(["Ver los detalles", "/monitor/agenda"]);
    expect(boton.atributos["aria-describedby"]).toBe(`${seccion.atributos["aria-labelledby"]} cuando-es-la-proxima`);
  });

  it("una reserva pendiente de pago también cuenta y dice su estado", async () => {
    datos.proximas = [{ id: "p3", estado: "pendiente_pago", dia: "2099-03-05" }];
    const texto = textoDe(proximaDe(await pintar()));
    expect(texto).toContain("Reservada, esperando el pago");
    expect(texto).toContain("Cálculo I · Virtual");
  });

  it("sin próximas lo dice y ofrece abrir una franja", async () => {
    const seccion = proximaDe(await pintar());
    expect(textoDe(seccion)).toContain("No tienes monitorías próximas.");
    const enlace = porEtiqueta(seccion, "a")[0];
    expect([textoDe(enlace), enlace.atributos.href]).toEqual(["Abrir una franja", "/monitor/franjas"]);
  });

  it("si la agenda falla, lo dice con un alert dentro de la tarjeta, sin status, y el resto del panel funciona", async () => {
    datos.agendaFalla = true;
    const html = await pintar();
    const seccion = proximaDe(html);
    expect(textoDe(seccion)).toContain("No pudimos cargar tu agenda.");
    expect(porEtiqueta(seccion, "p")[0].atributos.role).toBe("alert");
    expect(html).not.toContain('role="status"');
    expect(tarjetasDe(html).map((t) => t.nombre)).toEqual(["Mi agenda", "Mis franjas", "Mis desembolsos", "Mi perfil"]);
    expect(textoDe(leerHtml(html))).toContain("Tus materias certificadas");
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
    datos.franjas = [
      { id: "f1", cerrada_desde: null },
      { id: "f2", cerrada_desde: "2099-01-01" },
      { id: "f3", cerrada_desde: "2020-01-01" },
    ];
    let tarjetas = tarjetasDe(await pintar());
    expect(tarjetas[0].dato).toBe("1 próxima");
    expect(tarjetas[1].dato).toBe("2 abiertas");
    datos.proximas.push({ id: "p2", estado: "pendiente_pago", dia: "2099-03-06" });
    datos.franjas = [{ id: "f1", cerrada_desde: null }];
    tarjetas = tarjetasDe(await pintar());
    expect(tarjetas[0].dato).toBe("2 próximas");
    expect(tarjetas[1].dato).toBe("1 abierta");
  });

  it("ningún otro enlace repite el nombre de una tarjeta y no hay cifras de dinero ni de comisión", async () => {
    datos.proximas = [{ id: "p1", estado: "confirmada", dia: "2099-03-05" }];
    datos.porFinalizar = true;
    const html = await pintar();
    const nombres = porEtiqueta(leerHtml(html), "a").map((a) => textoDe(a).toLowerCase());
    for (const nombre of ["mi agenda", "mis franjas", "mis desembolsos", "mi perfil"]) {
      expect(nombres.filter((n) => n.includes(nombre)), nombre).toHaveLength(1);
    }
    expect(html).not.toMatch(/\$|COP|comisi|bruto/i);
  });

  it("el recordatorio va arriba de todo, con su botón a la agenda, y sigue habiendo un solo status", async () => {
    datos.porFinalizar = true;
    const html = await pintar();
    expect(html.indexOf("por finalizar")).toBeLessThan(html.indexOf("Tu próxima monitoría"));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const enlace = porEtiqueta(leerHtml(html), "a").find((a) => textoDe(a) === "Finalizarla ahora");
    expect(enlace?.atributos.href).toBe("/monitor/agenda");
  });

  it("el panel ya no tiene el formulario de la llave", async () => {
    const html = await pintar();
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
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
