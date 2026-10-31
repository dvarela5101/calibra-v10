# Ensamblador Intel y apuntadores

Traducción de C a ensamblador Intel de 32 bits, apuntadores y manejo de la pila. Es del Parcial 1.

## Habilidades
kc: traducir-expresiones · Traducir a ensamblador Intel una expresión de C aritmética o de bits (mov, add, imul, idiv, and, desplazamientos) · prerrequisitos: complemento-a-dos
kc: apuntadores · Seguir el efecto de &, * y la aritmética de apuntadores en C según el tipo apuntado
kc: control-flujo-asm · Traducir a ensamblador ciclos y condicionales de C con comparaciones y saltos · prerrequisitos: traducir-expresiones
kc: pila-procedimientos · Describir la pila en una llamada a función: parámetros, dirección de retorno, EBP guardado y variables locales · prerrequisitos: control-flujo-asm, apuntadores

## Errores
mc: asm-destino-a-la-derecha · traducir-expresiones · en la sintaxis Intel pones el destino a la derecha y el origen a la izquierda
mc: asm-idiv-sin-edx · traducir-expresiones · usas idiv sin preparar EDX (cdq) y esperas que el cociente quede en otro registro distinto de EAX
mc: asm-and-por-y-logico · traducir-expresiones · traduces && como and de bits y & como si fuera un operador lógico, cuando son cosas distintas
mc: asm-shift-por-multiplicar-mal · traducir-expresiones · usas shl en un valor dividiendo entre una potencia de 2, o shr para multiplicar, con el sentido invertido
mc: asm-operacion-memoria-a-memoria · traducir-expresiones · escribes una instrucción con dos operandos en memoria, que el procesador no permite
mc: ptr-incrementa-un-byte · apuntadores · crees que sumar 1 a un apuntador a int avanza un byte y no el tamaño del tipo
mc: ptr-asterisco-y-ampersand-cruzados · apuntadores · confundes & (dirección) con * (contenido) y tomas p por el valor al que apunta
mc: ptr-copia-del-valor · apuntadores · crees que al pasar un apuntador a una función se copia la variable y no se modifica la original
mc: ptr-diferencia-en-bytes · apuntadores · al restar dos apuntadores del mismo tipo das la diferencia en bytes en vez de en elementos
mc: ptr-corchetes-sin-escala · apuntadores · interpretas a[i] como la dirección base más i bytes y olvidas multiplicar por el tamaño del elemento
mc: flujo-salto-condicion-invertida · control-flujo-asm · saltas cuando la condición del if se cumple, cuando el salto debe saltarse el bloque si NO se cumple
mc: flujo-cmp-sin-salto-correcto · control-flujo-asm · usas un salto condicional que no corresponde a la comparación (por ejemplo jl donde la condición es mayor o igual)
mc: flujo-ciclo-sin-regreso · control-flujo-asm · terminas el cuerpo del ciclo sin un salto de vuelta a la comparación
mc: flujo-signo-sin-signo · control-flujo-asm · usas saltos para enteros sin signo (ja, jb) cuando las variables son con signo, y los negativos se comparan mal
mc: flujo-else-sin-salto-final · control-flujo-asm · no pones el salto incondicional al final del bloque del if, y se ejecuta también el else
mc: pila-parametros-izq-der · pila-procedimientos · crees que los parámetros se apilan de izquierda a derecha y el primero queda arriba
mc: pila-crece-hacia-arriba · pila-procedimientos · crees que la pila crece hacia direcciones mayores y las variables locales quedan en EBP más un desplazamiento
mc: pila-retorno-por-ebp · pila-procedimientos · crees que la dirección de retorno es el EBP guardado, y mezclas las dos casillas
mc: pila-ebp-no-guardado · pila-procedimientos · piensas que la función no necesita guardar el EBP de quien la llamó
mc: pila-locales-antes-del-retorno · pila-procedimientos · colocas las variables locales entre los parámetros y la dirección de retorno

## Preguntas

