import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarHtml, armarTexto, enlaceSeguro, escaparHtml } from "./html";
import { PLANTILLAS, renderizar, type DatosPorPlantilla, type Plantilla } from "./plantillas";

const ENLACE = "https://calibra.example/resultados?token=abc123";

/** Datos de ejemplo de cada plantilla, con todos sus campos. */
const EJEMPLOS: { [P in Plantilla]: DatosPorPlantilla[P] } = {
  recuperacion_diagnostico: { nombre: "Ana", materia: "Cálculo Integral", enlace: ENLACE },
  resena_individual: { nombre: "Ana", monitor: "Camilo Rojas", enlace: ENLACE },
  solicitud_llave_reembolso: { nombre: "Ana", monto: 25_000, motivo: "Cancelaste la monitoría a tiempo", enlace: ENLACE },
  pago_rechazado_individual: { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte: "ayuda@calibra.example" },
  pago_rechazado_grupal: { nombre: "Ana", monto: 20_000, fechaSesion: "2020-01-13", enlace: ENLACE },
  escalamiento_pago: { nombreAdmin: "Admin Uno", nombrePagador: "Ana Pérez", monto: 25_000, enlace: "https://calibra.example/admin" },
};

const render = <P extends Plantilla>(plantilla: P, cambios: Partial<DatosPorPlantilla[P]> = {}) =>
  renderizar(plantilla, { ...EJEMPLOS[plantilla], ...cambios });

describe("las seis plantillas de la sección 8", () => {
  it("son las que salen por correo: diagnóstico, reseña, llave, dos rechazos y escalamiento", () => {
    expect([...PLANTILLAS].sort()).toEqual(Object.keys(EJEMPLOS).sort());
    expect(PLANTILLAS).toHaveLength(6);
  });

  it.each(PLANTILLAS)("%s sale en español con HTML y texto plano", (plantilla) => {
    const { asunto, html, texto } = render(plantilla);

    expect(asunto.length).toBeGreaterThan(0);
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<h1");
    expect(texto.length).toBeGreaterThan(0);
    expect(texto).not.toMatch(/<[a-z][^>]*>/i);
    // El texto plano trae lo mismo que el HTML: el saludo y el título están en las dos versiones.
    const titulo = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)![1];
    expect(texto).toContain(titulo.replaceAll("&amp;", "&"));
  });

  it.each(PLANTILLAS)("%s no lleva emojis, rayas largas, comisión ni marcadores sin llenar", (plantilla) => {
    const { asunto, html, texto } = render(plantilla);
    for (const contenido of [asunto, html, texto]) {
      expect(contenido).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(contenido).not.toMatch(/[—–]/);
      expect(contenido).not.toMatch(/comisi/i);
      expect(contenido).not.toMatch(/undefined|null|NaN|\{\{|TODO/);
    }
  });

  it.each(PLANTILLAS)("%s es determinista: los mismos datos dan el mismo correo (la Idempotency-Key lo exige)", (plantilla) => {
    expect(render(plantilla)).toEqual(render(plantilla));
  });

  it.each(PLANTILLAS)("%s no baja de 14 px en ningún texto del HTML", (plantilla) => {
    const tamanos = [...render(plantilla).html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(tamanos.length).toBeGreaterThan(0);
    expect(Math.min(...tamanos)).toBeGreaterThanOrEqual(14);
  });
});

describe("el contenido de cada plantilla", () => {
  it("recuperación del diagnóstico: la materia en el asunto y el enlace con token en el HTML y el texto", () => {
    const { asunto, html, texto } = render("recuperacion_diagnostico");
    expect(asunto).toBe("Tus resultados del diagnóstico de Cálculo Integral");
    expect(html).toContain(`href="${ENLACE}"`);
    expect(texto).toContain(`Ver mis resultados: ${ENLACE}`);
    expect(texto).toContain("Hola, Ana.");
  });

  it("reseña individual: dice el monitor y que el enlace no vence (RN-72)", () => {
    const { asunto, texto } = render("resena_individual");
    expect(asunto).toBe("¿Cómo te fue con Camilo Rojas?");
    expect(texto).toContain("Tu monitoría con Camilo Rojas ya terminó.");
    expect(texto).toContain("El enlace no vence");
  });

  it("solicitud de llave: el monto en pesos, el motivo con su punto y el enlace para dar la llave", () => {
    const { asunto, texto } = render("solicitud_llave_reembolso");
    expect(asunto.replace(/ /g, " ")).toBe("Necesitamos tu llave para devolverte $ 25.000");
    expect(texto.replace(/ /g, " ")).toContain("Vamos a devolverte $ 25.000 de tu pago en Calibra. Motivo: Cancelaste la monitoría a tiempo.");
    expect(texto).toContain(`Enviar mi llave: ${ENLACE}`);
    expect(texto).toContain("Calibra nunca te pide claves del banco");
  });

  it("solicitud de llave: un motivo que ya trae punto no queda con dos", () => {
    const { texto } = render("solicitud_llave_reembolso", { motivo: "El monitor no asistió." });
    expect(texto).toContain("Motivo: El monitor no asistió.");
    expect(texto).not.toContain("asistió..");
  });

  it("pago rechazado en una individual: la cita cancelada, sin reembolso (RN-43) y sin enlace de pago", () => {
    const { texto, html } = render("pago_rechazado_individual");
    expect(texto).toContain("la monitoría del 6 de enero de 2020 quedó cancelada");
    expect(texto).toContain("no hay reembolso");
    expect(texto).toContain("escríbenos a ayuda@calibra.example");
    expect(html).not.toContain("<a href");
  });

  it("pago rechazado en una individual: sin contacto de soporte no promete uno", () => {
    const { texto } = renderizar("pago_rechazado_individual", { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06" });
    expect(texto).not.toContain("escríbenos");
  });

  it("pago rechazado en una grupal: solo ese cupo, y el enlace del grupo para volver a intentar (RN-43)", () => {
    const { texto } = render("pago_rechazado_grupal");
    expect(texto).toContain("tu cupo en la sesión grupal del 13 de enero de 2020 quedó anulado");
    expect(texto).toContain("Los demás cupos siguen como estaban.");
    expect(texto).toContain(`Volver a pagar: ${ENLACE}`);
  });

  it("escalamiento: al admin, con el pagador y el monto, y el enlace a su bandeja (RN-42)", () => {
    const { asunto, texto } = render("escalamiento_pago");
    expect(asunto).toBe("Pago pendiente de revisión: Ana Pérez");
    expect(texto.replace(/ /g, " ")).toContain("El pago de $ 25.000 de Ana Pérez no se revisó a tiempo y ahora te toca a ti.");
    expect(texto).toContain("Abrir mi bandeja: https://calibra.example/admin");
  });

  it("no lleva plazos escritos: viven en la base (HU-003)", () => {
    for (const plantilla of PLANTILLAS) {
      expect(render(plantilla).texto).not.toMatch(/\b\d+\s?(horas?|minutos?|min|h)\b/);
    }
  });
});

describe("lo que viene de fuera no se interpreta como HTML", () => {
  it("escapa etiquetas y comillas de un nombre en el HTML, y las deja tal cual en el texto plano", () => {
    const nombre = '<img src=x onerror="alert(1)"> & compañía';
    const { html, texto } = render("recuperacion_diagnostico", { nombre });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; compañía");
    expect(texto).toContain(`Hola, ${nombre}.`);
  });

  it("un valor con salto de línea no parte el asunto ni cuela una cabecera", () => {
    const { asunto } = render("resena_individual", { monitor: "Camilo\r\nBcc: alguien@otro.co" });
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toBe("¿Cómo te fue con Camilo Bcc: alguien@otro.co?");
  });

  it.each(["", "   ", "\n\t"])("un nombre vacío (%j) es un error de quien llama, no un correo con hueco", (nombre) => {
    expect(() => render("recuperacion_diagnostico", { nombre })).toThrow(RangeError);
    expect(() => render("escalamiento_pago", { nombreAdmin: nombre })).toThrow(/nombreAdmin/);
  });

  it("una fecha de sesión inválida es un error", () => {
    expect(() => render("pago_rechazado_individual", { fechaSesion: "2020-02-30" })).toThrow(RangeError);
  });
});

describe("enlaces", () => {
  it("acepta https y http y los devuelve normalizados", () => {
    expect(enlaceSeguro("https://calibra.example/a?x=1&y=2")).toBe("https://calibra.example/a?x=1&y=2");
    expect(enlaceSeguro("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp:", "ftp://calibra.example/a"],
    ["sin protocolo", "calibra.example/a"],
    ["ruta relativa", "/admin"],
    ["con espacio", "https://calibra.example/a b"],
    ["con salto de línea", "https://calibra.example/a\nBcc: x@y.co"],
    ["vacío", ""],
  ])("rechaza %s", (_nombre, enlace) => {
    expect(() => enlaceSeguro(enlace)).toThrow(RangeError);
  });

  it("una plantilla con un enlace peligroso falla en vez de armar el correo", () => {
    expect(() => render("recuperacion_diagnostico", { enlace: "javascript:alert(1)" })).toThrow(RangeError);
  });

  it("el enlace del botón va escapado en el href y también como texto para copiar", () => {
    const enlace = "https://calibra.example/r?a=1&b=2";
    const { html } = render("recuperacion_diagnostico", { enlace });
    expect(html).toContain('href="https://calibra.example/r?a=1&amp;b=2"');
    expect(html).toContain("Si el botón no abre, copia este enlace en tu navegador: https://calibra.example/r?a=1&amp;b=2");
  });
});

describe("escaparHtml y el armado", () => {
  it("escapa los cinco caracteres que abren una etiqueta o un atributo", () => {
    expect(escaparHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escaparHtml("sin nada raro: ñ, á, ¿?")).toBe("sin nada raro: ñ, á, ¿?");
  });

  it("sin botón no hay enlace ni el aviso de copiarlo; sin pie no hay pie", () => {
    const contenido = { titulo: "Hola", parrafos: ["Un párrafo."] };
    const html = armarHtml(contenido);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("copia este enlace");
    expect(armarTexto(contenido)).toBe("Calibra\n\nHola\n\nUn párrafo.\n");
  });

  it("el texto plano separa los bloques con una línea en blanco y termina con salto de línea", () => {
    const texto = armarTexto({ titulo: "T", parrafos: ["A", "B"], boton: { texto: "Ir", enlace: "https://x.co/" }, pie: "P" });
    expect(texto).toBe("Calibra\n\nT\n\nA\n\nB\n\nIr: https://x.co/\n\nP\n");
  });
});

describe("todo texto libre que llega al asunto se limpia de saltos de línea, y ninguno puede venir vacío", () => {
  const salto = String.fromCharCode(13, 10);

  it.each([
    ["recuperacion_diagnostico", "materia"],
    ["resena_individual", "monitor"],
    ["escalamiento_pago", "nombrePagador"],
  ] as const)("%s: un salto de línea en %s no parte el asunto ni cuela una cabecera", (plantilla, campo) => {
    const { asunto } = render(plantilla, { [campo]: `X${salto}Bcc: a@b.co` } as Partial<DatosPorPlantilla[typeof plantilla]>);
    expect(asunto).not.toMatch(/[\r\n]/);
    expect(asunto).toContain("X Bcc: a@b.co");
  });

  it.each([
    ["recuperacion_diagnostico", "materia"],
    ["resena_individual", "monitor"],
    ["escalamiento_pago", "nombrePagador"],
    ["solicitud_llave_reembolso", "motivo"],
  ] as const)("%s: %s vacío o en blanco es un error, no un correo con hueco", (plantilla, campo) => {
    for (const vacio of ["", "   ", String.fromCharCode(10, 9)]) {
      const cambios = { [campo]: vacio } as Partial<DatosPorPlantilla[typeof plantilla]>;
      expect(() => render(plantilla, cambios), `${campo}=${JSON.stringify(vacio)}`).toThrow(new RegExp(campo));
    }
  });
});

describe("el contacto de soporte es opcional", () => {
  it.each([undefined, "", "   "])("con %j no se promete ningún canal de soporte", (contactoSoporte) => {
    const { texto } = renderizar("pago_rechazado_individual", { nombre: "Ana", monto: 25_000, fechaSesion: "2020-01-06", contactoSoporte });
    expect(texto).not.toContain("escríbenos");
  });

  it("con uno informado lo escribe, sin espacios sobrantes", () => {
    const { texto } = render("pago_rechazado_individual", { contactoSoporte: "  ayuda@calibra.example  " });
    expect(texto).toContain("escríbenos a ayuda@calibra.example.");
  });
});

describe("la puntuación no se duplica cuando el dato ya termina en punto", () => {
  it("un nombre con punto final no deja dos puntos, y uno sin punto recibe el suyo", () => {
    expect(render("recuperacion_diagnostico", { nombre: "Ana M." }).texto).toContain("Hola, Ana M.\n");
    expect(render("recuperacion_diagnostico", { nombre: "Ana" }).texto).toContain("Hola, Ana.\n");
    expect(render("escalamiento_pago", { nombreAdmin: "Admin S." }).texto).toContain("Hola, Admin S.\n");
    expect(render("recuperacion_diagnostico", { nombre: "Ana M." }).texto).not.toContain("..");
  });

  it("un motivo con interrogación o exclamación no termina en ?. ni !.", () => {
    expect(render("solicitud_llave_reembolso", { motivo: "¿El monitor no llegó?" }).texto).toContain("Motivo: ¿El monitor no llegó?\n");
    expect(render("solicitud_llave_reembolso", { motivo: "Cancelaste a tiempo" }).texto).toContain("Motivo: Cancelaste a tiempo.\n");
    expect(render("solicitud_llave_reembolso", { motivo: "El monitor no asistió." }).texto).toContain("Motivo: El monitor no asistió.\n");
  });

  it("una materia con punto final no deja dos puntos antes de la frase siguiente", () => {
    const { texto } = render("recuperacion_diagnostico", { materia: "Cálculo I." });
    expect(texto).toContain("diagnóstico de Cálculo I. Con este enlace");
    expect(texto).not.toContain("..");
  });
});

describe("los errores de validación no repiten un enlace que puede traer un token", () => {
  it("enlaceSeguro no copia el enlace inválido en el mensaje", () => {
    for (const enlace of ["no es una url?token=SECRETO123", "https://calibra.example/a b?token=SECRETO123"]) {
      try {
        enlaceSeguro(enlace);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain("SECRETO123");
      }
    }
  });
});

describe("el HTML respeta las reglas de diseño del producto", () => {
  const html = render("recuperacion_diagnostico").html;

  it("usa los mismos colores que src/styles/tokens.css: si el token cambia, el correo también", () => {
    const tokens = readFileSync(join(__dirname, "../../styles/tokens.css"), "utf8");
    const valorDe = (token: string) => new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1].toLowerCase();
    const enHtml = html.toLowerCase();
    for (const token of ["bg", "text", "primary", "muted"]) {
      expect(enHtml, `--${token}`).toContain(valorDe(token));
    }
  });

  it("el botón mide 44 px o más de alto: el interlineado de 24 px más el relleno de arriba y de abajo", () => {
    const boton = /<a href=[^>]*style="([^"]*)"/.exec(html)![1];
    const relleno = Number(/padding:(\d+)px/.exec(boton)![1]);
    const interlineado = 16 * 1.5; // font-size y line-height que hereda del body
    expect(2 * relleno + interlineado).toBeGreaterThanOrEqual(44);
  });
});
