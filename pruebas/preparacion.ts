import { vi } from "vitest";

// D-75 a: el acceso de la cabecera lee la sesión en el servidor y es asíncrono, y las pruebas de las páginas las pintan con
// `renderToStaticMarkup`, que no espera. Aquí no pinta nada; src/components/AccesoDeCabecera.test.ts prueba el de verdad.
vi.mock("@/components/AccesoDeCabecera", () => ({ AccesoDeCabecera: () => null }));
// D-77 a (HU-108): lo mismo con el de la landing; lo prueba src/components/portada/AccesoDeLaPortada.test.ts.
vi.mock("@/components/portada/AccesoDeLaPortada", () => ({ AccesoDeLaPortada: () => null }));
