import { vi } from "vitest";

// D-75 a: el acceso de la cabecera lee la sesión en el servidor y es asíncrono, y las pruebas de las páginas las pintan con
// `renderToStaticMarkup`, que no espera. Aquí no pinta nada; src/components/AccesoDeCabecera.test.ts prueba el de verdad.
vi.mock("@/components/AccesoDeCabecera", () => ({ AccesoDeCabecera: () => null }));
