# Memoria virtual

Paginación, traducción de direcciones, TLB y reemplazo de páginas. Es del Parcial 2.

## Habilidades
kc: traduccion-direcciones · Traducir una dirección virtual a real con la tabla de páginas (número de página, desplazamiento y marco) · prerrequisitos: base-hexa-binario
kc: tabla-paginas-tamano · Calcular el número de entradas y el tamaño de la tabla de páginas, y decir de qué depende frente a la tabla auxiliar · prerrequisitos: traduccion-direcciones
kc: fallo-de-pagina · Explicar cuándo ocurre un fallo de página, qué hace el sistema para atenderlo y qué es el thrashing · prerrequisitos: traduccion-direcciones
kc: reemplazo-paginas · Contar los fallos de página de una secuencia de referencias con LRU y con FIFO
kc: tlb-tiempo · Calcular el tiempo promedio de traducción de direcciones con y sin TLB · prerrequisitos: tiempo-ejecucion
kc: localidad-fallos · Decidir qué recorrido de una matriz causa más fallos de página según el orden de los ciclos, el almacenamiento por filas y los marcos disponibles · prerrequisitos: reemplazo-paginas, fallo-de-pagina

## Errores
mc: trad-sin-bits-desplazamiento · traduccion-direcciones · sacas el número de página dividiendo sin usar el tamaño de página y tomas los bits de la dirección completa como página
mc: trad-no-conserva-desplazamiento · traduccion-direcciones · al armar la dirección real cambias también el desplazamiento y no solo el número de marco
mc: trad-pagina-con-x · traduccion-direcciones · traduces una página marcada como no cargada y le inventas un marco, en vez de decir que no se puede traducir
mc: trad-marco-como-pagina · traduccion-direcciones · lees la tabla al revés y tomas el número de página como número de marco
mc: trad-decimal-no-convertido · traduccion-direcciones · pegas el marco y el desplazamiento en decimal como si fueran dígitos y no en binario
mc: tabla-depende-de-ram · tabla-paginas-tamano · crees que el número de entradas de la tabla de páginas depende del tamaño de la RAM
mc: tabla-depende-de-swap · tabla-paginas-tamano · crees que el número de entradas de la tabla de páginas depende del tamaño del swap
mc: tabla-confunde-con-auxiliar · tabla-paginas-tamano · confundes la tabla de páginas con la tabla auxiliar y crees que ambas tienen el mismo número de entradas
mc: tabla-solo-entradas-no-bytes · tabla-paginas-tamano · das el número de entradas como tamaño de la tabla sin multiplicar por los bytes de cada entrada
mc: tabla-siempre-en-ram · tabla-paginas-tamano · crees que la tabla de páginas tiene que estar completa en la RAM, y no puede ir parte en el swap
mc: fallo-proceso-mayor-que-ram · fallo-de-pagina · crees que hay fallo de página cuando el proceso es más grande que la memoria física
mc: fallo-tabla-no-cabe · fallo-de-pagina · crees que hay fallo de página cuando la tabla de páginas no cabe en la RAM
mc: fallo-pierde-dato · fallo-de-pagina · crees que el fallo de página ocurre porque una página en RAM perdió su contenido
mc: fallo-thrashing-por-cpu · fallo-de-pagina · crees que el thrashing sale por falta de CPU y no porque el proceso no tiene marcos suficientes para su conjunto de trabajo
mc: fallo-sin-ir-a-disco · fallo-de-pagina · crees que el sistema atiende el fallo sin ir al swap, solo reordenando la tabla de páginas
mc: reemplazo-lru-por-llegada · reemplazo-paginas · aplicas LRU sacando la página que llegó primero, que es FIFO
mc: reemplazo-fifo-por-uso · reemplazo-paginas · aplicas FIFO sacando la página menos usada recientemente, que es LRU
mc: reemplazo-no-actualiza-uso · reemplazo-paginas · en LRU no actualizas el orden de uso cuando una página ya está en memoria
mc: reemplazo-cuenta-solo-aciertos · reemplazo-paginas · cuentas las referencias que ya estaban en memoria como fallos
mc: reemplazo-mas-marcos-menos-fallos · reemplazo-paginas · crees que con FIFO más marcos nunca aumentan los fallos, sin verificar la secuencia
mc: tlb-confunde-con-tabla · tlb-tiempo · confundes la TLB con la tabla de páginas o con la MMU
mc: tlb-sin-ponderar · tlb-tiempo · sumas el tiempo de acierto y el de fallo sin ponderarlos por sus probabilidades
mc: tlb-fallo-sin-sumar-tlb · tlb-tiempo · en un fallo de TLB cuentas solo el acceso a la tabla de páginas y olvidas el tiempo de buscar en la TLB
mc: tlb-ciclos-a-ns-mal · tlb-tiempo · pasas ciclos a nanosegundos multiplicando por la frecuencia en vez de dividir entre ella
mc: tlb-sin-tlb-con-dos-accesos · tlb-tiempo · sin TLB cuentas solo un acceso a memoria para traducir, cuando hace falta ir a la tabla de páginas
mc: localidad-columnas-es-barato · localidad-fallos · crees que recorrer por columnas una matriz guardada por filas es tan eficiente como recorrerla por filas
mc: localidad-filas-por-pagina-mal · localidad-fallos · calculas cuántas filas caben en una página dividiendo al revés y obtienes un número de fallos equivocado
mc: localidad-cada-elemento-un-fallo · localidad-fallos · cuentas un fallo por cada elemento y no uno por cada página que se carga
mc: localidad-ignora-marcos · localidad-fallos · no miras cuántos marcos hay y supones que todas las matrices caben siempre en memoria
mc: localidad-mayor-responsable-mal · localidad-fallos · culpas a la matriz que se escribe y no a la que se recorre contra el orden de almacenamiento

## Preguntas

