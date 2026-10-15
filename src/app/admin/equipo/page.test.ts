import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MiembroDelEquipo } from "@/lib/admin/equipo-reglas";
import {
  MENSAJES_DE_CANCELAR,
  MENSAJES_DE_INVITAR,
  type InvitacionAbierta,
} from "@/lib/admin/invitaciones-reglas";
import { formatearFechaHora } from "@/lib/fechas";
import EquipoDeAdmins from "./page";

// HU-072 sin navegador ni base: la página con la sesión, el equipo y las invitaciones inventados, y se lee el HTML. Se
// fijan los avisos (con su rol), la lista de invitaciones abiertas, el botón «Reactivar» solo en los desactivados, el
// formulario de invitar y que una lectura que falla no esconde la otra. Los recorridos de punta a punta los cubre
// e2e/invitar-admin.spec.ts.

const YO = "a0a0a0a0-0000-4000-8000-000000000072";
const BEATRIZ = "b0b0b0b0-0000-4000-8000-000000000072";

const h = vi.hoisted(() => ({
  equipo: undefined as unknown,
  invitaciones: undefined as unknown,
  cliente: {} as object | null,
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "a0a0a0a0-0000-4000-8000-000000000072", rol: "admin" }) }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/equipo", () => ({
  cargarEquipo: async () => {
    if (h.equipo instanceof Error) throw h.equipo;
    return h.equipo;
  },
}));
vi.mock("@/lib/admin/invitaciones", () => ({
  listarInvitaciones: async () => {
    if (h.invitaciones instanceof Error) throw h.invitaciones;
    return h.invitaciones;
  },
}));
vi.mock("./acciones", () => ({
  mover: async () => {},
  desactivar: async () => {},
  invitar: async () => {},
  cancelarInvitacion: async () => {},
  reactivar: async () => {},
}));

const miembro = (id: string, nombre: string, ordenRevision: number, activo = true, casosAbiertos = 0): MiembroDelEquipo => ({
  id,
  nombre,
  correo: `${id}@calibra.test`,
  ordenRevision,
  activo,
  casosAbiertos,
});

const invitacion = (n: number, cambios: Partial<InvitacionAbierta> = {}): InvitacionAbierta => ({
  id: `1a1a1a1a-0000-4000-8000-${String(n).padStart(12, "0")}`,
  correo: `persona${n}@calibra.test`,
  invitadaPor: "Admin Uno",
  invitoActivo: true,
  creadaEn: new Date("2026-10-12T10:00:00.000Z"),
  venceEn: new Date("2026-10-19T15:00:00.000Z"),
  ...cambios,
});

const EQUIPO = [miembro(YO, "Admin Uno", 1), miembro(BEATRIZ, "Beatriz", 2, false), miembro("c", "Carlos", 3)];

beforeEach(() => {
  h.cliente = {};
  h.equipo = EQUIPO;
  h.invitaciones = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const pintar = async (consulta: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await EquipoDeAdmins({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));

/** Los avisos con rol de la página: `status` y `alert`. */
const avisos = (html: string) => [...html.matchAll(/<p role="(status|alert)"[^>]*>([^<]*)<\/p>/g)].map((m) => ({ rol: m[1], texto: m[2] }));
const tarjetaDe = (html: string, texto: string) => {
  const piezas = html.split("<li ").filter((trozo) => trozo.includes(texto));
  expect(piezas, `tarjeta con «${texto}»`).toHaveLength(1);
  return piezas[0].split("</li>")[0];
};

describe("los avisos de la pantalla", () => {
  it("sin consulta no hay ningún aviso con rol, aunque haya invitaciones, un desactivado y un formulario", async () => {
    h.invitaciones = [invitacion(1), invitacion(2)];
    expect(avisos(await pintar())).toEqual([]);
  });

  it.each([
    [{ invitada: "1" }, "status", "Enviamos la invitación. El enlace sirve una sola vez y vence en 7 días. La ves en «Invitaciones abiertas»."],
    [
      { invitada: "sin_correo" },
      "alert",
      "La invitación quedó creada, pero el correo no salió todavía. Calibra lo reintenta solo; si no sale, lo verás en tu bandeja en «Correos que no salieron». No hace falta invitar de nuevo.",
    ],
    [{ cancelada: "1" }, "status", "La invitación quedó cancelada: su enlace ya no sirve."],
    [{ movido: "1" }, "status", "Listo: el orden de revisión cambió."],
    [{ desactivado: "Carlos", recibe: "Ana" }, "status", "Carlos quedó desactivado: ya no puede entrar. Sus casos abiertos pasaron a Ana."],
  ] as const)("%j: un solo aviso, %s, con su texto", async (consulta, rol, texto) => {
    expect(avisos(await pintar({ ...consulta }))).toEqual([{ rol, texto }]);
  });

  it.each(Object.entries({ ...MENSAJES_DE_INVITAR, ...MENSAJES_DE_CANCELAR }))("?error=%s es una alerta con su mensaje", async (clave, texto) => {
    expect(avisos(await pintar({ error: clave }))).toEqual([{ rol: "alert", texto }]);
  });

  it("los mensajes de reactivar salen como alerta", async () => {
    expect(avisos(await pintar({ error: "ya_activo" }))).toEqual([{ rol: "alert", texto: "Ese admin ya estaba activo." }]);
    expect(avisos(await pintar({ error: "no_encontrado" }))).toEqual([{ rol: "alert", texto: "No encontramos a ese admin en el equipo." }]);
  });

  it("el sin_permiso de «Subir» y «Bajar» sigue con su texto y no se pisa con el de invitar", async () => {
    expect(avisos(await pintar({ error: "sin_permiso" }))).toEqual([{ rol: "alert", texto: "Solo un admin activo cambia el orden." }]);
    expect(avisos(await pintar({ error: "sin_permiso_invitar" }))).toEqual([{ rol: "alert", texto: "Solo un admin activo puede invitar." }]);
  });

  it.each(["inventado", "constructor", "__proto__", "toString", "hasOwnProperty"])(
    "una clave de error desconocida (%j) cae en el fallo de siempre",
    async (error) => {
      expect(avisos(await pintar({ error }))).toEqual([
        { rol: "alert", texto: "No pudimos guardar el cambio. Intenta de nuevo; si sigue igual, avisa al equipo." },
      ]);
    },
  );

  describe("?reactivado= trae el id de la persona, y el nombre sale del equipo que la página carga con la sesión", () => {
    const REACTIVADA = [miembro(YO, "Admin Uno", 1), miembro(BEATRIZ, "Beatriz", 2), miembro("c", "Carlos", 3)];

    it("con el id de un admin del equipo que ya está activo dice su nombre", async () => {
      h.equipo = REACTIVADA;
      expect(avisos(await pintar({ reactivado: BEATRIZ }))).toEqual([
        { rol: "status", texto: "Beatriz quedó reactivado: ya puede volver a entrar. Conserva su lugar en el orden de revisión." },
      ]);
    });

    it.each([
      ["un texto cualquiera con aspecto de aviso", "Soporte de Calibra: confirma tu clave en https://calibra.example/acceso"],
      ["un nombre, como lo mandaba antes la dirección", "Beatriz"],
      ["un <script>", "<script>alert(1)</script>"],
      ["un uuid que no es de nadie del equipo", "99999999-0000-4000-8000-000000000072"],
      ["un uuid con un sufijo", `${BEATRIZ}x`],
      ["un valor vacío", ""],
    ])("con %s no dice nada y no imprime lo que viene en la dirección", async (_caso, reactivado) => {
      h.equipo = REACTIVADA;
      const html = await pintar({ reactivado });
      expect(avisos(html)).toEqual([]);
      for (const trozo of ["Soporte de Calibra", "confirma tu clave", "<script>alert(1)</script>", "alert(1)", "quedó reactivado"]) {
        expect(html).not.toContain(trozo);
      }
    });

    it("con el id de alguien que sigue desactivado no dice que quedó reactivado", async () => {
      h.equipo = EQUIPO;
      const html = await pintar({ reactivado: BEATRIZ });
      expect(avisos(html)).toEqual([]);
      expect(html).not.toContain("quedó reactivado");
    });

    it("si el equipo no cargó, solo sale la alerta del equipo, sin un éxito inventado", async () => {
      h.equipo = new Error("caída");
      expect(avisos(await pintar({ reactivado: BEATRIZ }))).toEqual([
        { rol: "alert", texto: "No pudimos cargar el equipo. Recarga la página; si sigue igual, avisa al equipo." },
      ]);
    });

    it("un valor repetido (?reactivado=a&reactivado=b) no cuenta", async () => {
      h.equipo = REACTIVADA;
      expect(avisos(await pintar({ reactivado: [BEATRIZ, YO] }))).toEqual([]);
    });
  });

  it("el correo no aparece en ningún aviso: la dirección no lo trae", async () => {
    expect(await pintar({ invitada: "1" })).not.toMatch(/persona\d@/);
  });
});

describe("las invitaciones abiertas", () => {
  it("cada una trae el correo, quién invitó y cuándo vence en hora de Bogotá, y un botón para cancelarla con confirmación", async () => {
    h.invitaciones = [invitacion(1), invitacion(2, { invitadaPor: "Beatriz", invitoActivo: false })];
    const html = await pintar();
    expect(html).toContain("Invitaciones abiertas (2)");

    const primera = tarjetaDe(html, "persona1@calibra.test");
    expect(primera).toContain("Invitó Admin Uno<");
    expect(primera).not.toContain("(desactivado)");
    expect(primera).toContain(`Vigente · vence el ${formatearFechaHora(new Date("2026-10-19T15:00:00.000Z"))}`);
    expect(primera).toContain("<summary");
    expect(primera).toContain("Cancelar la invitación a persona1@calibra.test");
    expect(primera).toContain("El enlace que ya salió dejará de servir. Si lo necesitas, puedes invitar de nuevo.");
    expect(primera).toContain("Sí, cancelar la invitación");
    expect(primera).toContain(`<input type="hidden" name="invitacion" value="${invitacion(1).id}"/>`);

    const segunda = tarjetaDe(html, "persona2@calibra.test");
    expect(segunda).toContain("Invitó Beatriz (desactivado)<");
    expect(segunda).toContain(`name="invitacion" value="${invitacion(2).id}"`);
  });

  it("la de un admin desactivado no se presenta como vigente: dice que no sirve mientras siga desactivado, y se puede cancelar", async () => {
    h.invitaciones = [invitacion(1), invitacion(2, { invitadaPor: "Beatriz", invitoActivo: false })];
    const html = await pintar();
    const vence = formatearFechaHora(new Date("2026-10-19T15:00:00.000Z"));

    const desactivada = tarjetaDe(html, "persona2@calibra.test");
    expect(desactivada).toContain(`No sirve mientras quien invitó siga desactivado · vence el ${vence}`);
    expect(desactivada).not.toContain("Vigente");
    expect(desactivada).toContain("Sí, cancelar la invitación");

    // La de un admin activo sigue diciendo que está vigente.
    const activa = tarjetaDe(html, "persona1@calibra.test");
    expect(activa).toContain(`Vigente · vence el ${vence}`);
    expect(activa).not.toContain("No sirve");
  });

  it("«Invitó …» va en un solo elemento, para no confundirse con la cabecera de la tarjeta de un admin", async () => {
    h.invitaciones = [invitacion(1)];
    expect(await pintar()).toMatch(/<span class="[^"]*">Invitó Admin Uno<\/span>/);
  });

  it("la lista tiene su nombre accesible, distinto del orden de revisión", async () => {
    h.invitaciones = [invitacion(1)];
    const html = await pintar();
    expect(html).toContain('aria-label="Invitaciones abiertas"');
    expect(html).toContain('aria-label="Orden de revisión"');
  });

  it("sin invitaciones dice «No hay invitaciones abiertas.» en un párrafo común, sin rol", async () => {
    const html = await pintar();
    expect(html).toContain("Invitaciones abiertas (0)");
    expect(html).toMatch(/<p class="[^"]*">No hay invitaciones abiertas\.<\/p>/);
    expect(html).not.toMatch(/role="(status|alert)"[^>]*>No hay invitaciones/);
  });

  it("un correo de 254 caracteres va en la tarjeta y en el resumen (las clases rompen la línea en el CSS)", async () => {
    const largo = `${"a".repeat(241)}@calibra.test`;
    h.invitaciones = [invitacion(1, { correo: largo })];
    const html = await pintar();
    expect(html.match(new RegExp(largo, "g"))).toHaveLength(2);
  });

  it("si las invitaciones no cargan, lo dice como alerta y el equipo se ve igual", async () => {
    h.invitaciones = new Error("caída");
    const html = await pintar();
    expect(avisos(html)).toEqual([{ rol: "alert", texto: "No pudimos cargar las invitaciones. Recarga la página; si sigue igual, avisa al equipo." }]);
    expect(html).toContain("Beatriz");
    expect(html).toContain("Carlos");
    expect(html).toContain("Invitar a una persona al equipo");
    expect(html).not.toContain("No hay invitaciones abiertas.");
  });

  it("si el equipo no carga, lo dice como alerta y las invitaciones se ven igual", async () => {
    h.equipo = new Error("caída");
    h.invitaciones = [invitacion(1)];
    const html = await pintar();
    expect(avisos(html)).toEqual([{ rol: "alert", texto: "No pudimos cargar el equipo. Recarga la página; si sigue igual, avisa al equipo." }]);
    expect(html).toContain("persona1@calibra.test");
    expect(html).not.toContain("Orden de revisión");
  });

  it("si falta la conexión a Supabase, las dos lecturas fallan sin romper la página", async () => {
    h.cliente = null;
    const html = await pintar();
    expect(avisos(html).map((a) => a.rol)).toEqual(["alert", "alert"]);
    expect(html).toContain("Invitar a una persona al equipo");
  });
});

describe("«Reactivar» en la tarjeta de un admin desactivado (D-64 a)", () => {
  it("solo el desactivado lo ofrece, con su confirmación y su botón con el nombre", async () => {
    const html = await pintar();
    const desactivada = tarjetaDe(html, "Beatriz");
    expect(desactivada).toContain("Desactivado · Sin casos abiertos");
    expect(desactivada).toContain("Reactivar a Beatriz");
    expect(desactivada).toContain("Sí, reactivar a Beatriz");
    expect(desactivada).toContain(`name="admin" value="${BEATRIZ}"`);
    expect(desactivada).toContain("Beatriz podrá volver a entrar a Calibra con su contraseña de siempre y conserva su lugar en el orden de revisión. Sus casos abiertos no se le devuelven.");
    // El desactivado no se vuelve a desactivar.
    expect(desactivada).not.toContain("Desactivar a Beatriz");

    expect(tarjetaDe(html, "Carlos")).not.toContain("Reactivar");
    expect(tarjetaDe(html, "Admin Uno (tú)")).not.toContain("Reactivar");
    expect(html.match(/Reactivar a /g)).toHaveLength(1);
  });

  it("dice que vuelve a recibir los pagos nuevos solo si queda primero entre los activos", async () => {
    // Beatriz (2) tiene antes a Admin Uno (1), activo: no queda primera.
    expect(tarjetaDe(await pintar(), "Beatriz")).not.toContain("volverá a recibir los pagos nuevos");

    // Con el primero desactivado, Beatriz (2) queda primera entre los activos.
    h.equipo = [miembro(YO, "Admin Uno", 3), miembro("a", "Ana", 1, false), miembro("b", "Beatriz", 2, false), miembro("c", "Carlos", 4)];
    const html = await pintar();
    expect(tarjetaDe(html, "Beatriz")).toContain("Queda primero entre los activos: volverá a recibir los pagos nuevos.");
    expect(tarjetaDe(html, "Ana")).toContain("Queda primero entre los activos: volverá a recibir los pagos nuevos.");
  });

  it("los botones que repiten el nombre del admin (reactivar y desactivar) pueden partir una palabra larga a 390 px", async () => {
    const nombre = "N".repeat(60);
    h.equipo = [miembro(YO, "Admin Uno", 1), miembro(BEATRIZ, nombre, 2, false), miembro("c", `${nombre}2`, 3)];
    h.invitaciones = [invitacion(1)];
    const html = await pintar();
    const boton = (texto: string) => new RegExp(`<button[^>]*class="([^"]*)"[^>]*>(?:<!-- -->)?${texto}`).exec(html)?.[1];
    // El nombre lo escribe quien se registra por invitación: lo que lo parte es una clase del CSS, que mide el e2e.
    expect(boton(`Sí, reactivar a ${nombre}`), "botón de reactivar").toMatch(/botonConNombre/);
    expect(boton(`Sí, desactivar a `), "botón de desactivar").toMatch(/botonConNombre/);
    // Y los que no repiten ningún nombre no la llevan.
    expect(boton("Sí, cancelar la invitación"), "botón de cancelar").not.toMatch(/botonConNombre/);
  });

  it("conserva lo de HU-054: subir, bajar y desactivar a otro", async () => {
    const html = await pintar();
    const carlos = tarjetaDe(html, "Carlos");
    expect(carlos).toContain("Desactivar a Carlos");
    expect(carlos).toContain("Subir");
    expect(tarjetaDe(html, "Admin Uno (tú)")).not.toContain("Desactivar a Admin Uno");
  });
});

describe("el formulario de invitar", () => {
  it("tiene el correo dos veces, la casilla y el botón, y no valida en el navegador para que los mensajes salgan del servidor", async () => {
    const html = await pintar();
    const formulario = html.slice(html.indexOf("Invitar a una persona al equipo"));
    expect(formulario).toContain("<form");
    expect(formulario).toContain('noValidate=""');
    const campo = (id: string) => {
      const etiqueta = new RegExp(`<input id="${id}"[^>]*>`).exec(formulario);
      expect(etiqueta, `campo ${id}`).not.toBeNull();
      return etiqueta![0];
    };
    for (const [id, tipo] of [["correo", "email"], ["correo_repetido", "email"], ["entiendo", "checkbox"]] as const) {
      expect(campo(id)).toContain(`name="${id}"`);
      expect(campo(id)).toContain(`type="${tipo}"`);
      expect(campo(id)).toContain('required=""');
    }
    expect(campo("correo")).toContain('autoComplete="off"');
    expect(campo("correo_repetido")).toContain('autoComplete="off"');
    expect(campo("entiendo")).toContain('value="si"');
    expect(formulario).toContain("Correo de la persona");
    expect(formulario).toContain("Escribe el correo otra vez");
    expect(formulario).toContain("Enviar invitación");
    expect(formulario).toContain("Le llega un enlace para crear su cuenta de admin. Sirve una sola vez y vence en 7 días.");
  });

  it("la casilla no viene marcada y su etiqueta dice a qué datos tendrá acceso la persona", async () => {
    const html = await pintar();
    expect(html).not.toMatch(/<input id="entiendo"[^>]*checked/);
    expect(html).toMatch(/<label for="entiendo"[^>]*>Entiendo que esta persona podrá ver datos personales de estudiantes, de quienes pagan y de monitores, incluidas las llaves de pago de unos y otros\.<\/label>/);
  });

  it("los campos salen vacíos: la consulta no puede traer el correo, y aunque lo traiga no se pinta", async () => {
    const html = await pintar({ error: "correos_distintos", correo: "secreto@calibra.test" });
    expect(html).not.toContain("secreto@calibra.test");
    expect(html).not.toMatch(/<input id="correo[^>]*value=/);
  });

  it("el subtítulo suma que también se puede invitar", async () => {
    expect(await pintar()).toContain("También puedes invitar a una persona al equipo.");
  });

  it("las dos secciones tienen su título y se llega a la bandeja desde el final", async () => {
    const html = await pintar();
    expect(html).toMatch(/<h2 id="titulo-invitaciones"[^>]*>Invitaciones abiertas \(0\)<\/h2>/);
    expect(html).toMatch(/<h2 id="titulo-invitar"[^>]*>Invitar a una persona al equipo<\/h2>/);
    expect(html).toContain("Volver a mi bandeja");
  });
});
