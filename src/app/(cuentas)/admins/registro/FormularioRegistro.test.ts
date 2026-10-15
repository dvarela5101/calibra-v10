import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormularioRegistro } from "./FormularioRegistro";

// HU-072 (criterio 8) sin navegador: lo que la pantalla hace con el estado que devuelve la acción. No hay Testing Library,
// así que se fija con `renderToStaticMarkup` y un `useActionState` al que se le pone el estado. Que el perdedor de dos
// registros llegue a ese estado lo cubren invitaciones.test.ts (la lectura repetida) y la integración; el recorrido de las
// dos pestañas, e2e/invitar-admin.spec.ts.

const TOKEN = "ab".repeat(32);
const TEXTO = "Este enlace ya se usó o venció. Pide otra invitación al equipo de Calibra.";

const h = vi.hoisted(() => ({ estado: { error: null, invitacionNoSirve: false, valores: {} } as Record<string, unknown> }));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => [h.estado, () => {}, false],
}));
vi.mock("./acciones", () => ({ registrarse: async () => ({}) }));

const pintar = () => renderToStaticMarkup(createElement(FormularioRegistro, { token: TOKEN, correo: "nuevo@calibra.test" }));

beforeEach(() => {
  h.estado = { error: null, invitacionNoSirve: false, valores: {} };
});

describe("el formulario de registro de un admin", () => {
  it("al empezar muestra los campos, el correo como texto y el botón, y ninguna alerta", () => {
    const html = pintar();
    expect(html).toContain("<form");
    expect(html).toContain('name="nombre"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Crear mi cuenta");
    expect(html).toContain(">nuevo@calibra.test</dd>");
    expect(html).not.toContain('role="alert"');
  });

  it("si la acción dice que la invitación ya no sirve (otra pestaña la gastó antes), esconde el formulario y deja solo el aviso", () => {
    h.estado = { error: TEXTO, invitacionNoSirve: true, valores: { nombre: "Ana" } };
    const html = pintar();
    expect(html).toBe(`<p role="alert" class="${/class="([^"]*)"/.exec(html)?.[1]}">${TEXTO}</p>`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Crear mi cuenta");
    expect(html).not.toContain('name="nombre"');
    expect(html).not.toContain(TOKEN);
  });

  it("si es otro error (contraseñas distintas, un fallo), conserva el formulario con el aviso y lo escrito", () => {
    h.estado = { error: "Las contraseñas no coinciden.", invitacionNoSirve: false, valores: { nombre: "Ana" } };
    const html = pintar();
    expect(html).toContain("<form");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Las contraseñas no coinciden.");
    expect(html).toContain('value="Ana"');
    expect(html).toContain('type="password"');
  });
});
