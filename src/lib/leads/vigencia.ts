/**
 * Cuánto dura el enlace de verificación del correo de un Lead (P-23, HU-068). El vencimiento lo pone la base
 * (`verificacion_lead.vence_en`, 24 horas): aquí solo se muestra en los avisos.
 *
 * Va en su propio módulo, sin importar nada, porque lo lee `avisos.ts`, que importa el formulario de contacto (un componente
 * de cliente). `verificacion.ts` usa `node:crypto` y es solo del servidor: si `avisos.ts` lo importara, el navegador bajaría
 * el polyfill de Node (`crypto-browserify`, 417 KB) por una constante. `verificacion.ts` la reexporta para quien ya la
 * pedía allí. La guarda es `pruebas/cliente-sin-node.test.ts`.
 */
export const HORAS_DE_VIGENCIA = 24;
