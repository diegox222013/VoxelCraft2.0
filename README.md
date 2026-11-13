# VoxelCraft 2.0 — Multiplayer Sandbox

Un sandbox 3D de bloques para navegador, construido con **Three.js**, **Socket.IO**, **Express** y **Node.js**.

## Características

- Mundo compartido en tiempo real para varios jugadores.
- Movimiento en primera persona, salto, carrera y colisiones básicas.
- Construcción y destrucción sincronizada de bloques.
- Cinco materiales: césped, tierra, piedra, madera y hojas.
- Avatares de jugadores con nombres e interpolación de movimiento.
- Chat global dentro del juego.
- Isla inicial con terreno por capas y árboles.
- Validación en el servidor de posiciones, distancia, materiales y límites.
- Renderizado de bloques mediante `InstancedMesh`.
- Endpoint `/health` para comprobar el estado del servicio.

## Requisitos

- Node.js 18 o superior.
- npm.
- Navegador moderno con WebGL.

## Ejecutar localmente

```bash
npm install
npm start
```

Abre http://localhost:3000. Para probar el multijugador, abre el juego en dos pestañas o dispositivos.

## Despliegue en Render

Crea un Web Service conectado a este repositorio y configura:

- Build Command: `npm install`
- Start Command: `npm start`
- Runtime: Node

El servidor escucha en `process.env.PORT` y ofrece `/health` como comprobación de salud.

## Controles

| Acción | Control |
|---|---|
| Moverse | WASD |
| Mirar | Ratón |
| Saltar | Espacio |
| Correr | Shift |
| Seleccionar bloque | 1–5 |
| Romper | Clic izquierdo |
| Colocar | Clic derecho |
| Chat | Enter |
| Pausar | Esc |

## Estructura

```text
├── package.json
├── server.js
├── README.md
├── .gitignore
└── public/
    ├── index.html
    └── game.js
```

## Limitaciones conocidas

- El mundo se mantiene en memoria; los cambios se pierden si el servidor se reinicia.
- Todavía no hay cuentas, permisos, inventario persistente ni salas privadas.
- La validación del servidor es básica y el prototipo no tiene física completamente autoritativa.
- Three.js se carga desde un CDN, por lo que el navegador necesita conexión a Internet.
