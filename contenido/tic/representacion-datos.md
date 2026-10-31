# Representación de datos

Cómo se guardan números y caracteres en binario. Es del Parcial 1.

## Habilidades
kc: base-hexa-binario · Convertir un valor entre binario, octal, decimal y hexadecimal
kc: codigo-ascii · Pasar de un carácter a su código ASCII en hexadecimal y al revés · prerrequisitos: base-hexa-binario
kc: complemento-a-dos · Representar un entero con signo en complemento a dos e interpretar un patrón de bits como entero sin signo, con signo o carácter · prerrequisitos: base-hexa-binario
kc: capacidad-almacenamiento · Calcular cuántos datos caben en una memoria usando unidades binarias (KiB, MiB, GiB)

## Errores
mc: base-grupos-de-tres-para-hexa · base-hexa-binario · agrupas los bits de a tres para pasar a hexadecimal, en vez de a cuatro
mc: base-cifra-hexa-como-decimal · base-hexa-binario · lees una cifra hexadecimal como si fuera decimal (por ejemplo, tomas 1F como 1 y 5)
mc: base-letras-hexa-valor-errado · base-hexa-binario · le asignas a las letras A a F valores corridos (A = 11 o F = 16) en lugar de 10 a 15
mc: base-decimal-pesos-de-16-mal · base-hexa-binario · al pasar de hexadecimal a decimal multiplicas cada cifra por 10 elevado a su posición, no por 16
mc: base-agrupa-desde-la-izquierda · base-hexa-binario · agrupas el binario desde la izquierda sin completar con ceros el grupo de la derecha, y el valor sale desplazado
mc: ascii-codigo-decimal-como-hexa · codigo-ascii · escribes el código decimal del carácter (por ejemplo 65 para la A) y lo tomas como si ya fuera hexadecimal
mc: ascii-minuscula-igual-mayuscula · codigo-ascii · crees que la letra minúscula y la mayúscula tienen el mismo código
mc: ascii-digito-igual-a-su-valor · codigo-ascii · crees que el carácter '7' tiene código 7 y no 0x37
mc: ascii-letra-siguiente-suma-mal · codigo-ascii · para hallar el código de la letra siguiente sumas 1 al código en decimal y lo dejas escrito como hexadecimal
mc: ascii-cuenta-dos-bytes-por-caracter · codigo-ascii · crees que un carácter ASCII ocupa dos bytes y no uno
mc: c2-complemento-es-solo-invertir · complemento-a-dos · para negar un número invertes los bits y no sumas 1
mc: c2-signo-y-magnitud · complemento-a-dos · lees el bit más alto como un signo y el resto como el valor absoluto, sin restar 2 elevado al número de bits
mc: c2-sin-signo-con-bit-alto · complemento-a-dos · interpretas un patrón con el bit alto en 1 como negativo aunque el enunciado lo pide sin signo
mc: c2-rango-simetrico · complemento-a-dos · crees que con n bits el rango con signo va de −(2ⁿ⁻¹−1) a 2ⁿ⁻¹−1, simétrico, y no de −2ⁿ⁻¹ a 2ⁿ⁻¹−1
mc: c2-patron-como-caracter-con-signo · complemento-a-dos · conviertes un patrón a carácter usando su valor negativo, cuando un código de carácter es siempre positivo
mc: capacidad-kilo-es-mil · capacidad-almacenamiento · usas 1000 en vez de 1024 al pasar de KiB a bytes
mc: capacidad-bits-por-bytes · capacidad-almacenamiento · confundes bits y bytes y divides entre 8 donde debías multiplicar
mc: capacidad-salto-de-unidad · capacidad-almacenamiento · pasas de MiB a KiB multiplicando por 1024 una sola vez cuando faltan dos saltos de unidad
mc: capacidad-no-redondea-hacia-abajo · capacidad-almacenamiento · cuando la división de la capacidad no es exacta, redondeas hacia arriba el número de elementos que caben

## Preguntas

