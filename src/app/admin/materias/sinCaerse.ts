import { unstable_rethrow } from "next/navigation";

/**
 * La acción del formulario, sin que un fallo de la red o un despliegue nuevo tumbe la página (como `cancelarSinCaerse`
 * en HU-024). Si la acción se rechaza, `alFallar` arma el estado de error con los valores del `FormData`, para que los
 * campos conserven lo escrito. El `redirect` de la acción (borrar) llega aquí como un rechazo: no es una falla, se deja
 * pasar para que Next haga la navegación.
 */
export function sinCaerse<Estado>(
  accion: (anterior: Estado, datos: FormData) => Promise<Estado>,
  alFallar: (anterior: Estado, datos: FormData) => Estado,
): (anterior: Estado, datos: FormData) => Promise<Estado> {
  return async (anterior, datos) => {
    try {
      return await accion(anterior, datos);
    } catch (error) {
      unstable_rethrow(error);
      return alFallar(anterior, datos);
    }
  };
}
