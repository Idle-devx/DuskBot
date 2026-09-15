# Bot de Discord con IA (Groq)

Bot de Discord que responde al comando `/ask` utilizando la API gratuita de Groq (con modelos de código abierto como Llama), además de moderación, conversión a GIF, publicaciones en foro, sistema de tickets, verificación de miembros, protección anti-raid, y un pequeño sistema de almacenamiento de fragmentos de código.

> Nota: este archivo estaba desactualizado en una versión anterior — mencionaba un comando `/pregunta` que ya no existe. El comando real, registrado en `src/commands/definitions.js`, es `/ask` (en inglés, como el resto de los comandos de barra del bot).

## Estructura del proyecto

Ver la sección "Project structure" en `README.md` para el detalle completo. En resumen: `src/index.js` es el punto de entrada, cada funcionalidad vive en su propio archivo bajo `src/handlers/`, lo compartido entre varias funcionalidades vive en `src/lib/`, los scripts de línea de comandos (deploy, limpieza, verificación) viven en `scripts/`, y todo el estado/configuración que se genera en tiempo de ejecución se guarda bajo `data/` (ignorado por git).

## Requisitos

- [Node.js](https://nodejs.org), versión 18 o superior.
- Una aplicación/bot creado en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).
- Una clave de API gratuita de [console.groq.com](https://console.groq.com).
- Una clave de API gratuita de [developers.giphy.com](https://developers.giphy.com) (para las respuestas automáticas con GIF).

## Instalación

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env` y completa los valores:

   ```bash
   cp .env.example .env
   ```

   - `DISCORD_TOKEN`: el token de tu bot (Portal de Discord > tu aplicación > Bot > Restablecer token).
   - `DISCORD_CLIENT_ID`: ID de la aplicación (Portal de Discord > tu aplicación > Información general).
   - `DISCORD_GUILD_ID`: ID de tu servidor (clic derecho en el ícono de tu servidor > Copiar ID del servidor; requiere Modo Desarrollador activado). Solo se usa para `deploy:dev` y `clear-guild-commands`, no para correr el bot en sí.
   - `GROQ_API_KEY`: tu clave de API gratuita de Groq.
   - `GIPHY_API_KEY`: tu clave de API gratuita de GIPHY.

3. Registra los comandos de barra (`/`) globalmente para que funcionen en cualquier servidor al que se una el bot (solo es necesario hacerlo una vez o cuando cambies algún comando; la primera vez puede tardar hasta 1 hora en propagarse):

   ```bash
   npm run deploy
   ```

   Para pruebas instantáneas en un solo servidor en vez de esperar la propagación global, usa el ID de tu servidor de pruebas (`DISCORD_GUILD_ID` en `.env`) con:

   ```bash
   npm run deploy:dev
   ```

4. Inicia el bot:

   ```bash
   npm start
   ```

## Uso

En cualquier canal donde esté presente el bot, escribe:

```text
/ask message: ¿Cuál es la capital de Francia?
```

El bot responderá utilizando un modelo de IA. Cada persona mantiene su propio historial reciente de conversación por canal (en memoria, se pierde si el bot se reinicia) para mantener las respuestas contextualizadas — las preguntas de una persona nunca se filtran hacia las respuestas de otra, aunque estén en el mismo canal.

### Convertir un video o una imagen a GIF

```text
/gif file: [adjunta tu video o imagen] duration: 5 width: 320
```

- `file` (obligatorio): el video o imagen que quieres convertir.
- `duration` (opcional, predeterminado 5): segundos que se tomarán desde el inicio del video (máximo 15).
- `width` (opcional, predeterminado 320): ancho en píxeles del GIF resultante; la altura se ajusta automáticamente.

El bot descarga el archivo, lo convierte utilizando ffmpeg y responde con el GIF. No se aceptan archivos de más de 25 MB.

### Moderación

- `/ban user:[usuario] reason:[opcional] delete_days:[0-7, opcional]` — banea permanentemente.
- `/kick user:[usuario] reason:[opcional]` — expulsa al usuario del servidor (puede volver a entrar mediante una invitación).
- `/softban user:[usuario] reason:[opcional] delete_days:[opcional, predeterminado 1]` — banea y desbanea inmediatamente. **Esto ya elimina los mensajes recientes del usuario**, ya que técnicamente se le banea durante un instante antes de desbanearlo; el usuario puede volver a entrar con una nueva invitación.
- `/mute user:[usuario] minutes:[1-40320] reason:[opcional]` — silencia al usuario (mediante el tiempo de espera nativo de Discord).
- `/unmute user:[usuario]` — elimina el silencio antes de que expire.
- `/unban user_id:[ID de usuario] reason:[opcional]` — quita el baneo utilizando el ID del usuario.

Ban, kick, softban y unban intentan enviar un mensaje directo al usuario afectado explicando qué ocurrió — **el DM se envía solo después de que la acción se realizó con éxito**, así que nunca vas a recibir un DM de "fuiste baneado" por un baneo que en realidad falló (por ejemplo, porque el rol del bot está por debajo del tuyo). Si el usuario tiene los mensajes directos cerrados, esto falla en silencio y la acción de moderación se realiza de todas formas. Puedes cambiar los textos y colores en `src/lib/embeds.js`.

Para que el bot pueda moderar a alguien, su rol debe estar **por encima** del rol de esa persona en la lista de roles del servidor.

### Canal de logs de moderación

```
/modlogs-setup log_channel:[canal]
```

Comando solo para administradores. Guardado por servidor en `data/modlogs-config.json`.

### Publicaciones en foro

```
/forum channel: [elige un canal de foro] title: Mi publicación content: Texto aquí image1: [opcional]
```

### Sistema de tickets

```
/ticket-setup panel_channel:[canal] category:[opcional] log_channel:[opcional] support_roles:[opcional] alert_hours:[opcional, predeterminado 3] inactivity_hours:[opcional, predeterminado 24]
```

Publica un panel con botón "Open Ticket". Las categorías se editan en `TICKET_CATEGORIES` dentro de `src/handlers/tickets.js`. El seguimiento de tickets abiertos vive en `data/tickets-state.json`, y solo se borra una vez que el canal fue efectivamente eliminado — así un reinicio del bot a mitad del cierre nunca deja un ticket huérfano sin seguimiento.

### Anti-raid

```
/antiraid-setup log_channel:[canal] join_threshold:[opcional, predeterminado 5] time_window_seconds:[opcional, predeterminado 10] action:[Kick/Ban, opcional] lockdown_minutes:[opcional, predeterminado 10]
```

Es una heurística, no una garantía: ajusta `join_threshold` y `time_window_seconds` al tráfico normal de tu servidor. Toda la lógica vive en `src/handlers/antiraid.js`.

### Roles de acceso por servidor

```
/access-setup moderation_roles:[opcional] save_code_roles:[opcional] code_roles:[opcional] clear_moderation_roles:[opcional] clear_save_code_roles:[opcional] clear_code_roles:[opcional]
```

Guardado por servidor en `data/access-config.json`.

### Almacenamiento de fragmentos de código

- `/save-code project:[nombre] name:[archivo] file:[opcional] content:[opcional]` — requiere Moderar Miembros/Administrador o un rol configurado. Los archivos adjuntos están limitados a 25 MB.
- `/code project:[nombre] name:[archivo]` — requiere el rol **"Scripter"** (o un rol configurado, o Admin/Mod).

Archivos guardados bajo `data/codigos/` (ya cubierto por `.gitignore`).

### Respuestas con GIF aleatorios

Si alguien responde directamente a un mensaje del bot, este responde automáticamente con un GIF aleatorio (tsundere, gatos, perros o focas), usando la API gratuita de GIPHY. Categorías editables en `src/handlers/gifReplies.js`.

## Notas

- El modelo utilizado es `openai/gpt-oss-20b` (gratuito en el plan para desarrolladores de Groq); se puede cambiar en `src/handlers/ask.js`.
- Discord limita los mensajes a 2000 caracteres; el bot divide automáticamente las respuestas largas.
- La conversión de GIF utiliza `ffmpeg-static`, que incluye el ejecutable de ffmpeg.
- `node scripts/check-commands.js` verifica que cada comando definido tenga un handler correspondiente.
