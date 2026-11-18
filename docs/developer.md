# Tuboteca · developer

## Mapa del código

```text
tuboteca/
├── server.js            # servidor HTTP sin dependencias
├── public/              # interfaz de escritorio
├── data/                # datos demo (canales y árbol)
├── docs/                # página, datasheet y developer
├── start.sh
└── README.md
```

## Flujo de datos

1. `Navegador` — public/
2. `Node HTTP` — server.js
3. `YouTube` — HTML público
4. `Estado` — JSON

## Decisiones de diseño

- **Sin API oficial** (A): No hay OAuth ni cuota. Se lee la página pública y se usa Innertube como respaldo.
- **Caché con stale** (B): Si YouTube no responde, se muestra la última copia válida en vez de una pantalla vacía.
- **Escritorio propio** (C): Carpetas anidadas, arrastrar canales y estados por video.

## Stack

Node.js, http, fs, JavaScript, HTML/CSS.

El servidor usa únicamente módulos nativos de Node: `http`, `fs`, `path` y `url`. No hay `npm install`. El frontend es JavaScript vanilla y CSS propio. El estado se guarda en JSON y se escribe con `rename` atómico para evitar corrupciones.

## Cómo extenderlo

- Separá la lógica de dominio de la interfaz: el motor debe poder probarse sin navegador.
- Mantené los datos de demo fuera de la lógica y documentá su origen.
- Si agregás una integración externa, poné las credenciales en variables de entorno y un `.env.example` con `x`.
- Agregá una prueba de humo por cada flujo crítico antes de publicar.

## Puesta en marcha

```bash
# Sin dependencias: solo Node.js 18+
PORT=4321 node server.js
# Abrir http://127.0.0.1:4321
```

## Seguridad

El repo publica `data/channels.json` con canales demo, no suscripciones reales. La clave de respaldo de Innertube se reemplazó por `x`; la app lee la clave pública desde la página de YouTube y solo usa el fallback si el HTML cambia.

## Límites conocidos

- **Sin API oficial**: Depende del HTML público de YouTube. Si cambia, el parser puede necesitar ajustes.
- **Datos demo**: Los canales incluidos son públicos y sirven de ejemplo; no son suscripciones personales.
- **Sin descargas**: Reproduce con el reproductor nocookie; no descarga videos.
- **Un usuario**: No hay multiusuario ni autenticación: es una biblioteca local.

## Enlaces

- [README](../README.md)
- [Datasheet](datasheet.md)
- [Repositorio](https://github.com/jmadasme/tuboteca)
