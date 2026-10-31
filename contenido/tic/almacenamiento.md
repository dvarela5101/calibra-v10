# Almacenamiento secundario y sistemas de archivos

Espacio libre, nodos-i y tiempos de acceso a disco. Es del Parcial 2.

## Habilidades
kc: espacio-libre · Comparar el espacio que ocupan una lista de bloques libres y un mapa de bits · prerrequisitos: capacidad-almacenamiento
kc: nodos-i-tamano · Calcular el tamaño máximo de un archivo con nodos-i de direcciones directas e indirectas · prerrequisitos: capacidad-almacenamiento
kc: tiempo-disco · Calcular el tiempo de leer o escribir en un HDD (búsqueda, latencia rotacional, transferencia) y comparar accesos aleatorios con secuenciales, en HDD y en SSD

## Errores
mc: libre-lista-siempre-menor · espacio-libre · crees que la lista de bloques libres siempre ocupa menos que el mapa de bits
mc: libre-mapa-por-libres · espacio-libre · calculas el mapa de bits con un bit por bloque libre y no por cada bloque del disco
mc: libre-lista-sin-direccion · espacio-libre · calculas la lista de libres con un bit por bloque, cuando cada elemento guarda una dirección de D bits
mc: libre-porcentaje-invertido · espacio-libre · das como respuesta el porcentaje de bloques ocupados y no el de bloques libres
mc: libre-bits-bytes · espacio-libre · comparas el tamaño de la lista y del mapa de bits sin pasar los dos a la misma unidad
mc: nodoi-sin-indirecto · nodos-i-tamano · cuentas solo las direcciones directas y olvidas los bloques que apunta el bloque indirecto
mc: nodoi-indirecto-un-bloque · nodos-i-tamano · tratas el bloque indirecto como un solo bloque de datos, en vez de un bloque con muchos apuntadores
mc: nodoi-entradas-por-bloque-mal · nodos-i-tamano · calculas las direcciones por bloque dividiendo el tamaño del bloque entre el de la dirección al revés
mc: nodoi-ultima-entrada-como-dato · nodos-i-tamano · cuentas la entrada reservada al indirecto como si apuntara a un bloque de datos más
mc: nodoi-kib-mib-mal · nodos-i-tamano · mezclas KiB, MiB y bytes y el tamaño máximo queda en una unidad equivocada
mc: disco-suma-solo-busqueda · tiempo-disco · calculas el tiempo de un acceso con solo la búsqueda y olvidas la latencia rotacional y la transferencia
mc: disco-latencia-es-vuelta-completa · tiempo-disco · tomas la latencia rotacional como una vuelta completa y no como media vuelta en promedio
mc: disco-transferencia-por-archivo-no-tamano · tiempo-disco · calculas la transferencia sin dividir el tamaño del archivo entre la tasa
mc: disco-ssd-igual-que-hdd · tiempo-disco · crees que en un SSD los accesos aleatorios son tan lentos como en un HDD por la búsqueda y la rotación
mc: disco-aleatorio-igual-que-secuencial · tiempo-disco · crees que leer muchos archivos pequeños dispersos cuesta lo mismo que uno secuencial del mismo tamaño total

## Preguntas

