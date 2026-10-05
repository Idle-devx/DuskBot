# Bot de Discord con IA (Gemini)

Bot de Discord que responde al comando `/ask` utilizando la API de Gemini de Google (nivel gratuito), además de moderación (incluyendo advertencias y borrado masivo de mensajes), conversión a GIF, publicaciones en foro, sistema de tickets, verificación de miembros, protección anti-raid, roles por reacción, canales de voz automáticos, comandos de información de usuario/servidor, y un pequeño sistema de almacenamiento de fragmentos de código.

> Nota: este archivo estaba desactualizado en una versión anterior — mencionaba un comando `/pregunta` que ya no existe. El comando real, registrado en `src/commands/definitions.js`, es `/ask` (en inglés, como el resto de los comandos de barra del bot).

## Estructura del proyecto

Ver la sección "Project structure" en `README.md` para el detalle completo. En resumen: `src/index.js` es el punto de entrada, cada funcionalidad vive en su propio archivo bajo `src/handlers/`, lo compartido entre varias funcionalidades vive en `src/lib/`, los scripts de línea de comandos (deploy, limpieza, verificación) viven en `scripts/`, y todo el estado/configuración que se genera en tiempo de ejecución se guarda bajo `data/` (ignorado por git).

## Requisitos

- [Node.js](https://nodejs.org), versión 18 o superior.
- Una aplicación/bot creado en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).
- Una clave de API gratuita de Gemini de [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
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
   - `GEMINI_API_KEY`: tu clave de API gratuita de Gemini.
   - `GIPHY_API_KEY`: tu clave de API gratuita de GIPHY.
   - `NEXUS_API_KEY`: opcional. Tu clave personal de la API de Nexus Mods (al final de <https://www.nexusmods.com/users/myaccount?tab=api+access>). Solo hace falta para los avisos de actualización de mods.

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

También puedes adjuntar un archivo para que la IA lo analice, con la opción opcional `file`:

```text
/ask message: ¿Qué significa este error? file: [adjunta una captura]
```

Archivos admitidos: imágenes (PNG, JPEG, WebP, HEIC — no GIF), PDF, audio y video de hasta 10 MB, y archivos de texto o código de hasta 1 MB. El archivo solo se envía con esa pregunta; las preguntas siguientes se apoyan en lo que la IA ya dijo sobre él, así que vuelve a adjuntarlo si necesitas que lo revise de nuevo.

#### Personalidad

Por defecto la IA responde como DuskBot con personalidad tsundere (definida en `DEFAULT_PERSONALITY` en `src/handlers/ask.js`). Cada servidor puede reemplazarla por la suya:

```text
/ask-setup personality: Un pirata alegre al que le encantan los juegos de palabras
```

Solo para administradores. Ejecuta `/ask-setup` sin opciones para ver la personalidad actual, o `/ask-setup reset:true` para volver a la predeterminada. Sea cual sea la personalidad, el bot sigue sabiendo quién lo creó, qué modelo usa y desde cuándo opera, y lo dice cuando se le pregunta. Guardado por servidor en `data/ask-config.json`.

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
- `/warn user:[usuario] reason:[opcional]` — registra una advertencia; no aplica ninguna otra sanción por sí sola. Ver [Advertencias](#advertencias) más abajo.
- `/purge amount:[1-100] user:[opcional]` — borra en bloque mensajes recientes del canal actual. Ver [Borrado masivo de mensajes](#borrado-masivo-de-mensajes) más abajo.

Ban, kick, softban, unban y warn intentan enviar un mensaje directo al usuario afectado explicando qué ocurrió — **el DM se envía solo después de que la acción se realizó con éxito**, así que nunca vas a recibir un DM de "fuiste baneado" por un baneo que en realidad falló (por ejemplo, porque el rol del bot está por debajo del tuyo). Si el usuario tiene los mensajes directos cerrados, esto falla en silencio y la acción de moderación se realiza de todas formas. Puedes cambiar los textos y colores en `src/lib/embeds.js`.

Ninguno de estos comandos usa la restricción nativa de permisos de Discord — son visibles para todos en la lista de comandos, pero el acceso se controla en código (`hasModerationAccess` en `src/lib/accessConfig.js`) según el permiso nativo correspondiente, Administrador, o un rol configurado con [`/access-setup`](#roles-de-acceso-por-servidor). Para que el bot pueda moderar a alguien, su rol debe estar además **por encima** del rol de esa persona en la lista de roles del servidor.

### Canal de logs de moderación

```
/modlogs-setup log_channel:[canal]
```

Comando solo para administradores. Registra ban, kick, softban, mute, unmute, unban y warn en un canal dedicado. Guardado por servidor en `data/modlogs-config.json`. Esta lógica es compartida entre `src/handlers/moderation.js` y `src/handlers/warnings.js` mediante `src/lib/modLog.js`.

### Advertencias

- `/warn user:[usuario] reason:[opcional]` — registra una advertencia, envía un DM, publica una embed en el canal y la registra en el canal de logs (si hay uno configurado).
- `/warnings user:[usuario]` — lista el historial de advertencias de un usuario (respuesta efímera, solo para staff).
- `/clearwarnings user:[usuario]` — borra todo el historial de advertencias de un usuario (respuesta efímera, solo para staff). No se puede borrar una advertencia individual del medio de la lista.

Guardado por servidor y por usuario en `data/warnings.json`. Toda esta lógica vive en `src/handlers/warnings.js`.

### Borrado masivo de mensajes

```
/purge amount:[1-100] user:[opcional]
```

Borra la cantidad indicada de mensajes recientes del canal. Con `user`, solo borra mensajes de esa persona, buscando entre los últimos 100 mensajes del canal (límite de la API de Discord para el borrado masivo) — por lo que con ese filtro puede borrar menos de `amount` si la persona no escribió tantas veces recientemente. Los mensajes de más de 14 días se omiten automáticamente (otro límite de Discord). Requiere Gestionar Mensajes, Administrador, o un rol configurado en `moderation_roles`. Vive en `src/handlers/moderation.js`.

### Información de usuario y servidor

- `/userinfo user:[opcional, por defecto vos mismo]` — muestra tag, ID, avatar, fecha de creación de la cuenta, fecha de ingreso al servidor y roles.
- `/serverinfo` — muestra el dueño del servidor, cantidad de miembros/roles/canales, nivel de boost y fecha de creación.
- `/avatar user:[opcional, por defecto vos mismo]` — publica el avatar de un usuario en tamaño completo.

No requieren ningún permiso especial. Toda esta lógica vive en `src/handlers/info.js`.

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

### Auto-rol mediante reacciones

```
/reactionrole-setup channel:[canal] title:[opcional] description:[opcional] color:[opcional, hex ej. #5865F2]
```

Comando solo para administradores. Publica una embed en `channel` con el ícono del servidor como miniatura y un texto (`description`, con un valor por defecto) explicando que reaccionar otorga un rol. Empieza sin roles asignados — se agregan con:

```
/reactionrole-add message_id:[ID del mensaje del panel] role:[rol a otorgar] emoji:[emoji con el que reaccionar]
```

`message_id` es el ID del mensaje del panel (clic derecho sobre el mensaje con el Modo Desarrollador activado > Copiar ID). El bot reacciona al panel con ese emoji y edita la embed para mostrar `emoji — @Rol`; desde ese momento, reaccionar con ese emoji otorga el rol, y quitar la reacción lo retira de nuevo. Ejecuta `/reactionrole-add` otra vez con el mismo `message_id` y otro `role`/`emoji` para agregar otra combinación al mismo panel — un panel puede tener varias. El rol del bot debe estar por encima del rol a otorgar (igual que en moderación), no puede ser `@everyone` ni un rol gestionado por una integración/bot.

```
/reactionrole-remove message_id:[ID del mensaje del panel] emoji:[emoji a quitar]
```

Elimina esa combinación, actualiza la embed y quita la reacción propia del bot para ese emoji. Si el mensaje del panel se borra manualmente, su configuración se limpia automáticamente. Toda esta lógica vive en `src/handlers/reactionRoles.js`, guardada por servidor en `data/reactionroles-config.json`.

### Canales de voz automáticos (join-to-create)

```
/voicecreate-setup trigger_channel:[canal de voz] category:[opcional] name_template:[opcional, por defecto '🔊 {user}'] user_limit:[opcional, por defecto 0 = sin límite] log_channel:[opcional]
```

Comando solo para administradores. Cada vez que alguien se une a `trigger_channel`, el bot crea un canal de voz nuevo (con el nombre generado a partir de `name_template`, que debe incluir `{user}`) dentro de `category` (por defecto, la misma categoría del canal disparador) y mueve ahí al usuario automáticamente. El canal se elimina solo en cuanto queda vacío — no hay que limpiar nada manualmente, y una revisión al iniciar el bot elimina cualquier canal que haya quedado vacío mientras estaba apagado. Ejecuta `/voicecreate-setup disable:true` para desactivarlo — unirse al antiguo canal disparador ya no crea nada nuevo, aunque los canales personales que sigan abiertos en ese momento igual se borran solos al vaciarse. Guardado por servidor en `data/voicecreate-config.json`; qué canales creó el bot se rastrea en `data/voicecreate-state.json`. Toda esta lógica vive en `src/handlers/voiceCreate.js`.

### Avisos de actualización de mods de Nexus

```
/modupdates-setup channel:[canal de texto] role:[rol opcional a mencionar]
/modupdates-add url:[la página del mod en Nexus]
/modupdates-remove mod:[dirección de la página, o parte del nombre]
/modupdates-list
/modupdates-check
```

Comandos solo para administradores. Elige un canal con `/modupdates-setup` y agrega cada mod con `/modupdates-add` (pega la dirección de su página en Nexus). Cada 10 minutos el bot le pregunta a Nexus la versión actual de cada mod, y cuando cambia publica una tarjeta en el canal con el nombre del mod, la versión anterior y la nueva, el registro de cambios de esa versión tal como está en la página de Nexus (o el resumen del mod si no hay), y un enlace a los archivos. La versión que tiene un mod al agregarlo solo se guarda, no se anuncia. `/modupdates-check` revisa en el momento, y `/modupdates-list` muestra qué se está vigilando y el motivo de cualquier mod que no se pudo revisar. `/modupdates-setup disable:true` detiene los avisos sin perder la lista.

Requiere `NEXUS_API_KEY` en `.env`; sin ella los comandos lo indican y la revisión automática queda apagada. Límite de 25 mods por servidor. Se guarda por servidor en `data/modupdates-config.json`. Toda la lógica está en `src/handlers/modUpdates.js`; `npm run test:mod-updates` prueba el verificador sin conexión.

### Almacenamiento de fragmentos de código

- `/save-code project:[nombre] name:[archivo] file:[opcional] content:[opcional]` — requiere Moderar Miembros/Administrador o un rol configurado. Los archivos adjuntos están limitados a 25 MB.
- `/code project:[nombre] name:[archivo]` — requiere el rol **"Scripter"** (o un rol configurado, o Admin/Mod).

Archivos guardados bajo `data/codigos/` (ya cubierto por `.gitignore`).

### Respuestas con GIF aleatorios

Si alguien responde directamente a un mensaje del bot, este responde automáticamente con un GIF aleatorio (tsundere, gatos, perros o focas), usando la API gratuita de GIPHY. Categorías editables en `src/handlers/gifReplies.js`.

## Notas

- El modelo utilizado es `gemini-3.8-flash`, con `gemini-3.7-flash` como respaldo cuando Google indica que el primero está saturado o sin cuota (ambos en el nivel gratuito de Gemini); se pueden cambiar en la lista `MODELS` de `src/handlers/ask.js`. En el nivel gratuito, Google usa los mensajes y respuestas para mejorar sus productos.
- Discord limita los mensajes a 2000 caracteres; el bot divide automáticamente las respuestas largas.
- La conversión de GIF utiliza `ffmpeg-static`, que incluye el ejecutable de ffmpeg.
- `node scripts/check-commands.js` verifica que cada comando definido tenga un handler correspondiente.
