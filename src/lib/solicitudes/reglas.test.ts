import { describe, expect, it } from "vitest";
import {
  ACCION_DEL_ESTADO,
  CAMPO_MATERIAS,
  CAMPO_TRAMPA,
  ESTADOS_DE_SOLICITUD,
  ESTADOS_QUE_MARCA_EL_ADMIN,
  MAXIMO_DE_MATERIAS,
  NOMBRE_DEL_ESTADO,
  cayoEnLaTrampa,
  confirmacionDelEstado,
  enlaceDeCorreo,
  leerCambioDeEstado,
  leerPagina,
  leerSolicitud,
  paginaDeInicio,
} from "./reglas";

const M1 = "0f9d5e1c-3b7a-4c52-9d11-6a1f2b3c4d5e";
const M2 = "6a1f2b3c-4d5e-4c52-9d11-0f9d5e1c3b7a";

function formulario(campos: Record<string, string | string[]>): FormData {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) {
    for (const v of Array.isArray(valor) ? valor : [valor]) datos.append(nombre, v);
  }
  return datos;
}

const BASE = { nombre: "Ana Pérez", correo: "ana@uniandes.edu.co", numero_telefono: "300 123 4567", [CAMPO_MATERIAS]: [M1] };

describe("leerSolicitud: lo que deja el aspirante (HU-062)", () => {
  it("lee nombre, correo, teléfono con indicativo y materias", () => {
    expect(leerSolicitud(formulario({ ...BASE, [CAMPO_MATERIAS]: [M1, M2] }))).toEqual({
      ok: true,
      datos: { nombre: "Ana Pérez", correo: "ana@uniandes.edu.co", numeroTelefono: "+573001234567", materias: [M1, M2] },
    });
  });

  it("normaliza: espacios de sobra en el nombre, correo en minúsculas, materias repetidas una vez", () => {
    const lectura = leerSolicitud(
      formulario({ ...BASE, nombre: "  Ana   Pérez ", correo: " ANA@Uniandes.edu.co ", [CAMPO_MATERIAS]: [M1, M1.toUpperCase(), M2] }),
    );
    expect(lectura).toMatchObject({ ok: true, datos: { nombre: "Ana Pérez", correo: "ana@uniandes.edu.co", materias: [M1, M2] } });
  });

  it("respeta el indicativo que venga", () => {
    expect(leerSolicitud(formulario({ ...BASE, numero_telefono: "+1 (415) 555-0100" }))).toMatchObject({
      ok: true,
      datos: { numeroTelefono: "+14155550100" },
    });
  });

  it.each([
    ["sin nombre", { nombre: "   " }, "Escribe tu nombre."],
    ["con un nombre demasiado largo", { nombre: "a".repeat(121) }, "Tu nombre es demasiado largo."],
    ["sin correo", { correo: "" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["con un correo que no es correo", { correo: "ana@uniandes" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["sin teléfono (es obligatorio para agendar la evaluación)", { numero_telefono: "" }, "Escribe tu teléfono: lo necesitamos para agendar tu evaluación."],
    ["con un teléfono que no es teléfono", { numero_telefono: "llámame" }, "Escribe el teléfono con su indicativo, por ejemplo +57 300 123 4567."],
    ["con un teléfono demasiado corto", { numero_telefono: "123" }, "Escribe el teléfono con su indicativo, por ejemplo +57 300 123 4567."],
    ["sin materias", { [CAMPO_MATERIAS]: [] }, "Elige al menos una materia."],
    ["con una materia que no es un id", { [CAMPO_MATERIAS]: ["calculo"] }, "Alguna materia no es válida. Recarga la página."],
  ])("rechaza un formulario %s", (_nombre, cambio, error) => {
    expect(leerSolicitud(formulario({ ...BASE, ...cambio }))).toEqual({ ok: false, error });
  });

  it(`acepta ${MAXIMO_DE_MATERIAS} materias y rechaza una más`, () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(leerSolicitud(formulario({ ...BASE, [CAMPO_MATERIAS]: ids(MAXIMO_DE_MATERIAS) })).ok).toBe(true);
    expect(leerSolicitud(formulario({ ...BASE, [CAMPO_MATERIAS]: ids(MAXIMO_DE_MATERIAS + 1) }))).toEqual({
      ok: false,
      error: "Elige como máximo 20 materias.",
    });
  });

  it("el máximo es el mismo que exige la base (20)", () => {
    expect(MAXIMO_DE_MATERIAS).toBe(20);
  });

  // Un ?, & o = en el correo se leería como parámetros (copia oculta, cuerpo) en el enlace mailto: del admin.
  // La regla es la compartida de esCorreo (HU-070): aquí solo se comprueba que el formulario la aplica.
  it.each([
    ["con parámetros de mailto", "ana@uniandes.edu.co?bcc=otro@example.com"],
    ["con & en el dominio", "ana@uniandes.edu.co&cc=otro"],
    ["con ? antes de la arroba", "ana?cc=x@uniandes.edu.co"],
    ["con = antes de la arroba", "ana=x@uniandes.edu.co"],
    ["con # en el dominio", "ana@uniandes.edu.co#x"],
    ["con guion bajo en el dominio", "ana@uni_andes.edu.co"],
    ["con dos arrobas", "ana@x@uniandes.edu.co"],
    ["con / en el dominio", "ana@uniandes.edu.co/x"],
    ["con % en el dominio", "ana@uniandes.edu.co%3Fbcc%3Dx"],
    ["con una etiqueta vacía en el dominio", "ana@uniandes..edu.co"],
  ])("rechaza un correo %s", (_nombre, correo) => {
    expect(leerSolicitud(formulario({ ...BASE, correo }))).toEqual({ ok: false, error: "Escribe un correo válido, por ejemplo ana@uniandes.edu.co." });
  });

  it.each(["ana.perez+monitor@uniandes.edu.co", "o'neil@example.com", "ana_p%1@sub.uniandes.edu.co", "ana@uni-andes.co"])("acepta el correo %s", (correo) => {
    expect(leerSolicitud(formulario({ ...BASE, correo }))).toMatchObject({ ok: true, datos: { correo } });
  });
});

describe("cayoEnLaTrampa: el campo que solo llena un programa", () => {
  it("una persona lo deja vacío o ni lo envía", () => {
    expect(cayoEnLaTrampa(formulario(BASE))).toBe(false);
    expect(cayoEnLaTrampa(formulario({ ...BASE, [CAMPO_TRAMPA]: "" }))).toBe(false);
    expect(cayoEnLaTrampa(formulario({ ...BASE, [CAMPO_TRAMPA]: "   " }))).toBe(false);
  });

  it("con texto, lo llenó un programa", () => {
    expect(cayoEnLaTrampa(formulario({ ...BASE, [CAMPO_TRAMPA]: "https://spam.example" }))).toBe(true);
  });
});

describe("enlaceDeCorreo: el mailto: del panel del admin", () => {
  it("deja el correo tal cual cuando no hay nada que codificar", () => {
    expect(enlaceDeCorreo("ana.perez-1@uniandes.edu.co")).toBe("mailto:ana.perez-1@uniandes.edu.co");
  });

  it("codifica lo que en un mailto: tiene otro sentido, y nunca deja un ? ni un & sueltos", () => {
    expect(enlaceDeCorreo("a%b+c@x.co")).toBe("mailto:a%25b%2Bc@x.co");
    const enlace = enlaceDeCorreo("x@y.co?bcc=z@w.co&body=hola");
    expect(enlace).toBe("mailto:x@y.co%3Fbcc%3Dz@w.co%26body%3Dhola");
    expect(enlace).not.toMatch(/[?&=]/);
  });
});

describe("paginaDeInicio: dónde abre la lista del admin", () => {
  it("en la página de la abierta más antigua", () => {
    expect(paginaDeInicio(0, 500, 50)).toBe(1);
    expect(paginaDeInicio(49, 500, 50)).toBe(1);
    expect(paginaDeInicio(50, 500, 50)).toBe(2);
    expect(paginaDeInicio(120, 500, 50)).toBe(3);
  });

  it("sin abiertas, en la última; sin ninguna, en la primera", () => {
    expect(paginaDeInicio(null, 120, 50)).toBe(3);
    expect(paginaDeInicio(null, 100, 50)).toBe(2);
    expect(paginaDeInicio(null, 0, 50)).toBe(1);
  });
});

describe("leerPagina: el ?pagina= de la lista del admin", () => {
  it.each([
    ["2", 2],
    ["999999", 999999],
    [["3", "4"], 3],
  ] as const)("lee %j como la página %i", (valor, pagina) => {
    expect(leerPagina(valor as string | string[])).toBe(pagina);
  });

  it.each([undefined, "", "0", "-1", "1.5", "02", "abc", "1e3", "9999999", " 2"])("lee %j como la primera", (valor) => {
    expect(leerPagina(valor)).toBe(1);
  });
});

describe("estados de una solicitud", () => {
  it("son los de la HU, y el admin no vuelve una a nueva", () => {
    expect(ESTADOS_DE_SOLICITUD).toEqual(["nueva", "contactada", "evaluada", "descartada"]);
    expect(ESTADOS_QUE_MARCA_EL_ADMIN).toEqual(["contactada", "evaluada", "descartada"]);
  });

  it("cada estado tiene su nombre y cada acción del admin su texto", () => {
    for (const estado of ESTADOS_DE_SOLICITUD) expect(NOMBRE_DEL_ESTADO[estado]).toMatch(/^[A-ZÁÉÍÓÚ]/);
    for (const estado of ESTADOS_QUE_MARCA_EL_ADMIN) expect(ACCION_DEL_ESTADO[estado]).toBeTruthy();
  });

  it("después de marcarla, el admin lee en qué estado quedó", () => {
    expect(confirmacionDelEstado("contactada")).toBe("Quedó como contactada.");
    expect(confirmacionDelEstado("descartada")).toBe("Quedó como descartada.");
  });
});

describe("leerCambioDeEstado", () => {
  it.each(ESTADOS_QUE_MARCA_EL_ADMIN)("acepta %s", (estado) => {
    expect(leerCambioDeEstado(formulario({ id_solicitud: M1, estado }))).toEqual({ ok: true, datos: { idSolicitud: M1, estado } });
  });

  it.each([
    ["volver a nueva", { id_solicitud: M1, estado: "nueva" }, "Ese estado no existe. Recarga la página."],
    ["un estado inventado", { id_solicitud: M1, estado: "aprobada" }, "Ese estado no existe. Recarga la página."],
    ["sin id", { id_solicitud: "", estado: "contactada" }, "No encontramos esa solicitud. Recarga la página."],
    ["un id que no es uuid", { id_solicitud: "1; drop table", estado: "contactada" }, "No encontramos esa solicitud. Recarga la página."],
  ])("rechaza %s", (_nombre, campos, error) => {
    expect(leerCambioDeEstado(formulario(campos))).toEqual({ ok: false, error });
  });
});
