# Bot de Discord con IA (Groq)

Bot de Discord que responde al comando `/pregunta` usando la API gratuita de Groq (modelos open-source como Llama).

## Requisitos

- [Node.js](https://nodejs.org) versión 18 o superior.
- Una aplicación/bot creada en el [portal de desarrolladores de Discord](https://discord.com/developers/applications).
- Una API key gratuita de [console.groq.com](https://console.groq.com).

## Instalación

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env` y llena los valores:

   ```bash
   cp .env.example .env
   ```

   - `DISCORD_TOKEN`: token del bot (portal de Discord > tu app > Bot > Reset Token).
   - `DISCORD_CLIENT_ID`: Application ID (portal de Discord > tu app > General Information).
   - `DISCORD_GUILD_ID`: ID de tu servidor (clic derecho en el ícono del servidor > Copiar ID, requiere modo desarrollador activado en Discord).
   - `GROQ_API_KEY`: tu API key gratuita de Groq.

3. Registra el comando slash en tu servidor (solo se necesita una vez, o cuando cambies el comando):

   ```bash
   npm run deploy
   ```

4. Enciende el bot:

   ```bash
   npm start
   ```

## Uso

En cualquier canal donde esté el bot, escribe:

```
/pregunta mensaje: ¿Cuál es la capital de Francia?
```

El bot responderá usando Claude. Cada canal mantiene su propio historial de conversación reciente (en memoria, se pierde si el bot se reinicia) para dar continuidad a las respuestas.

### Convertir video o imagen a GIF

```
/gif archivo: [adjunta tu video o imagen] duracion: 5 ancho: 320
```

- `archivo` (obligatorio): el video o imagen que quieres convertir.
- `duracion` (opcional, default 5): segundos a tomar desde el inicio del video (máximo 15).
- `ancho` (opcional, default 320): ancho en píxeles del GIF resultante; el alto se ajusta automáticamente.

El bot descarga el archivo, lo convierte con ffmpeg y responde con el GIF. Archivos de más de 25 MB no se aceptan.

## Notas

- El modelo usado es `llama-3.3-70b-versatile` (gratis en Groq). Puedes cambiarlo en `index.js` por otro modelo disponible en Groq si quieres, como uno más pequeño y rápido.
- Discord limita los mensajes a 2000 caracteres; el bot parte automáticamente las respuestas largas en varios mensajes.
- La conversión a GIF usa `ffmpeg-static`, que incluye el propio ejecutable de ffmpeg — no necesitas instalar nada aparte en el sistema.
- Para invitar el bot a otro servidor, genera un nuevo link en el portal de Discord (OAuth2 > URL Generator) con los scopes `bot` y `applications.commands`.
