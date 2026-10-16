import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerHtml, porEtiqueta, textoDe } from "../../../pruebas/arbol-html";
import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";

// HU-022, criterio 16: el texto del panel del monitor. Sin navegador ni base: la sesión, las consultas y la agenda son inventadas. Solo
// se mira el subtítulo y que el panel no gane regiones de estado (la e2e de finalizar afirma un `status` único, el del recordatorio).

const datos = vi.hoisted(() => ({
  certificados: [] as { id: string; fecha_emision: string; materia: { nombre: string; codigo: string } | null }[],
  errorDeCertificados: null as { message: string } | null,
  porFinalizar: false,
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "d0d0d0d0-0000-4000-8000-000000000022", rol: "monitor" }) }));
vi.mock("@/lib/agenda/servidor", () => ({
  cargarAgenda: async () =>
    datos.porFinalizar
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
      : [],
}));
vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: async () => ({
    from: (tabla: string) => {
      const respuesta =
        tabla === "monitor"
          ? { data: { nombre: "Andrés" }, error: null }
          : tabla === "monitor_privado"
            ? { data: null, error: null }
            : { data: datos.errorDeCertificados ? null : datos.certificados, error: datos.errorDeCertificados };
      // La consulta se encadena y se espera tal cual (certificados) o con `maybeSingle()` (monitor y llave).
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
// El cierre de sesión y el formulario de la llave son del servidor y del navegador: aquí no importan.
vi.mock("@/components/BotonSalir", () => ({ BotonSalir: () => null }));
vi.mock("./FormularioLlave", () => ({ FormularioLlave: () => null }));

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

beforeEach(() => {
  datos.certificados = [CERTIFICADO];
  datos.errorDeCertificados = null;
  datos.porFinalizar = false;
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

describe("el panel de quien todavía no tiene certificados", () => {
  it("conserva su texto de espera y no habla del diagnóstico", async () => {
    datos.certificados = [];
    const html = await pintar();
    expect(subtituloDe(html)).toBe(
      "Tu cuenta está lista. Espera a que un admin te certifique en tu materia: cuando lo haga, podrás abrir tus franjas y recibir estudiantes.",
    );
    expect(subtituloDe(html)).not.toContain("diagnóstico");
  });
});
