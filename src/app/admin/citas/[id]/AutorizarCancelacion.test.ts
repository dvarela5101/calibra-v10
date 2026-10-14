import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutorizarCancelacion } from "./AutorizarCancelacion";

// HU-052 sin navegador: lo que `renderToStaticMarkup` no puede ver del formulario, que son los manejadores y el estado de
// envío. `useActionState` se sustituye por un estado que la prueba controla y el componente se llama como función para leer
// su árbol de elementos: que el formulario no se envía con la confirmación cerrada, que el botón se inactiva mientras envía
// y que un error abre la confirmación y devuelve lo escrito. El recorrido con el navegador lo cubre
// e2e/cancelar-fuera-de-plazo.spec.ts.

const ID = "52525252-0000-4000-8000-000000000052";

const h = vi.hoisted(() => ({
  estado: { error: null, valores: { categoria: "", nota: "" } } as { error: string | null; valores: { categoria: string; nota: string } },
  enviando: false,
  accion: () => {},
}));

vi.mock("react", async (importar) => {
  const real = await importar<typeof import("react")>();
  return { ...real, useActionState: () => [h.estado, h.accion, h.enviando] };
});
vi.mock("./acciones", () => ({ autorizar: async () => ({ error: null, valores: { categoria: "", nota: "" } }) }));

type Elemento = ReactElement<Record<string, unknown>>;

/** Todos los elementos del árbol, a cualquier profundidad. */
function elementos(nodo: ReactNode): Elemento[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return [];
  const el = nodo as Elemento;
  return [el, ...elementos(el.props.children as ReactNode)];
}

/** El texto de un nodo, sin etiquetas. */
function textoDe(nodo: ReactNode): string {
  if (Array.isArray(nodo)) return nodo.map(textoDe).join("");
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (nodo && typeof nodo === "object" && "props" in nodo) return textoDe((nodo as Elemento).props.children as ReactNode);
  return "";
}

const pintar = () => elementos(AutorizarCancelacion({ idMonitoria: ID, consecuencias: "Lo que va a pasar." }));
const de = (etiqueta: string) => pintar().filter((el) => el.type === etiqueta);

beforeEach(() => {
  h.estado = { error: null, valores: { categoria: "", nota: "" } };
  h.enviando = false;
});

describe("AutorizarCancelacion: el envío", () => {
  function enviarCon(detalles: { open: boolean } | null) {
    const [formulario] = de("form");
    const preventDefault = vi.fn();
    const evento = { currentTarget: { closest: (selector: string) => (selector === "details" ? detalles : null) }, preventDefault };
    (formulario.props.onSubmit as (e: unknown) => void)(evento);
    return preventDefault;
  }

  it("el formulario envía a la acción, con la validación del navegador apagada: el motivo y la nota los pide la acción", () => {
    const [formulario] = de("form");
    expect(formulario.props.action).toBe(h.accion);
    expect(formulario.props.noValidate).toBe(true);
  });

  it("con la confirmación cerrada el envío no llega a la acción", () => {
    expect(enviarCon({ open: false })).toHaveBeenCalledTimes(1);
    // Sin un <details> alrededor tampoco se envía.
    expect(enviarCon(null)).toHaveBeenCalledTimes(1);
  });

  it("con la confirmación abierta el envío sigue su camino", () => {
    expect(enviarCon({ open: true })).not.toHaveBeenCalled();
  });

  it("mientras envía, el botón queda inactivo y dice «Cancelando…»; si no, está activo y dice «Sí, cancelar la monitoría»", () => {
    const [reposo] = de("button");
    expect(reposo.props.disabled).toBe(false);
    expect(textoDe(reposo)).toBe("Sí, cancelar la monitoría");
    expect(reposo.props["aria-describedby"]).toBe("autorizar-consecuencias");

    h.enviando = true;
    const [enviando] = de("button");
    expect(enviando.props.disabled).toBe(true);
    expect(textoDe(enviando)).toBe("Cancelando…");
  });
});

describe("AutorizarCancelacion: Enter no envía desde un motivo", () => {
  /** Lo que el formulario hace con una tecla: devuelve si frenó el envío implícito del navegador. */
  function pulsar(tecla: string, objetivo: { tagName: string; type?: string }): boolean {
    const [formulario] = de("form");
    const preventDefault = vi.fn();
    (formulario.props.onKeyDown as (e: unknown) => void)({ key: tecla, target: objetivo, preventDefault });
    return preventDefault.mock.calls.length > 0;
  }

  it("el formulario escucha el teclado", () => {
    expect(typeof de("form")[0].props.onKeyDown).toBe("function");
  });

  it("Enter sobre un motivo no envía: el navegador enviaría el formulario con el botón de confirmar y cancelaría sin pedirlo", () => {
    expect(pulsar("Enter", { tagName: "INPUT", type: "radio" })).toBe(true);
  });

  it("lo demás sigue igual: Enter en la nota (un salto de línea), en el botón (el envío que sí se pide) y sobre el título de la confirmación", () => {
    expect(pulsar("Enter", { tagName: "TEXTAREA" })).toBe(false);
    expect(pulsar("Enter", { tagName: "BUTTON", type: "submit" })).toBe(false);
    expect(pulsar("Enter", { tagName: "SUMMARY" })).toBe(false);
  });

  it("las demás teclas sobre un motivo siguen igual: las flechas lo cambian y el espacio lo marca", () => {
    for (const tecla of ["ArrowDown", "ArrowUp", " ", "Tab"]) expect(pulsar(tecla, { tagName: "INPUT", type: "radio" }), JSON.stringify(tecla)).toBe(false);
  });

  it("el freno es solo de los motivos: Enter en otro tipo de campo no se toca", () => {
    expect(pulsar("Enter", { tagName: "INPUT", type: "text" })).toBe(false);
  });
});

describe("AutorizarCancelacion: después de un error", () => {
  it("sin error la confirmación está cerrada; con error se abre para que se lea", () => {
    expect(de("details")[0].props.open).toBeUndefined();
    h.estado = { error: "La nota puede tener hasta 500 caracteres.", valores: { categoria: "otro", nota: "Lo que escribí." } };
    expect(de("details")[0].props.open).toBe(true);
  });

  it("el error se dice como alerta, una sola vez, y no antes", () => {
    expect(de("p").filter((p) => p.props.role === "alert")).toHaveLength(0);
    h.estado = { error: "Escoge el motivo de la lista.", valores: { categoria: "", nota: "" } };
    const alertas = de("p").filter((p) => p.props.role === "alert");
    expect(alertas).toHaveLength(1);
    expect(textoDe(alertas[0])).toBe("Escoge el motivo de la lista.");
  });

  it("devuelve lo escrito: el motivo escogido queda marcado y la nota queda en el campo", () => {
    h.estado = { error: "Con “Otro” la nota es obligatoria: cuenta qué pasó.", valores: { categoria: "falla_de_calibra", nota: "Lo que escribí.\nOtra línea." } };
    const marcados = de("input")
      .filter((el) => el.props.type === "radio" && el.props.defaultChecked === true)
      .map((el) => el.props.value);
    expect(marcados).toEqual(["falla_de_calibra"]);
    const [nota] = de("textarea");
    expect(nota.props.defaultValue).toBe("Lo que escribí.\nOtra línea.");
  });

  it("sin nada escrito ningún motivo viene marcado", () => {
    expect(de("input").filter((el) => el.props.type === "radio" && el.props.defaultChecked === true)).toEqual([]);
  });

  it("los campos se vuelven a montar con lo devuelto: su llave cambia con lo escrito", () => {
    const llave = () => pintar().find((el) => el.props.className && String(el.props.className).includes("campos"))?.key;
    const antes = llave();
    h.estado = { error: "x", valores: { categoria: "otro", nota: "Otra cosa." } };
    expect(llave()).not.toBe(antes);
  });
});
