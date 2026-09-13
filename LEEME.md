# Bot de Discord con IA (Groq)

Bot de Discord que responde al comando `/pregunta` utilizando la API gratuita de Groq (con modelos de código abierto como Llama).

## Requisitos

- [Node.js](https://nodejs.org), versión 18 o superior.
- Una aplicación/bot creado en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).
- Una clave de API gratuita de [console.groq.com](https://console.groq.com).

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
   - `DISCORD_GUILD_ID`: ID de tu servidor (haz clic derecho en el icono de tu servidor > Copiar ID del servidor; requiere tener activado el Modo desarrollador en Discord). Ya no se utiliza para registrar comandos, ya que ahora son globales, pero se conserva por si lo necesitas más adelante.
   - `GROQ_API_KEY`: tu clave de API gratuita de Groq.

3. Registra los comandos de barra (`/`) globalmente para que funcionen en cualquier servidor al que se una el bot (solo es necesario hacerlo una vez o cuando cambies algún comando. La primera vez puede tardar hasta 1 hora en propagarse):

   ```bash
   npm run deploy
   ```

4. Inicia el bot:

   ```bash
   npm start
   ```

## Uso

En cualquier canal donde esté presente el bot, escribe:

```text
/pregunta mensaje: ¿Cuál es la capital de Francia?
```

El bot responderá utilizando un modelo de IA. Cada canal mantiene su propio historial reciente de conversación (en memoria, por lo que se pierde si el bot se reinicia) para mantener las respuestas contextualizadas.

### Convertir un video o una imagen a GIF

```text
/gif archivo: [adjunta tu video o imagen] duracion: 5 ancho: 320
```

- `archivo` (obligatorio): el video o imagen que quieres convertir.
- `duracion` (opcional, predeterminado 5): segundos que se tomarán desde el inicio del video (máximo 15).
- `ancho` (opcional, predeterminado 320): ancho en píxeles del GIF resultante; la altura se ajusta automáticamente.

El bot descarga el archivo, lo convierte utilizando ffmpeg y responde con el GIF. No se aceptan archivos de más de 25 MB.

### Moderación

- `/ban usuario:[usuario] razon:[opcional] dias_borrado:[0-7, opcional]` — banea permanentemente.
- `/kick usuario:[usuario] razon:[opcional]` — expulsa al usuario del servidor (puede volver a entrar mediante una invitación).
- `/softban usuario:[usuario] razon:[opcional] dias_borrado:[opcional, predeterminado 1]` — banea y desbloquea inmediatamente. **Esto ya elimina los mensajes recientes del usuario** (según los días establecidos en `dias_borrado`), ya que técnicamente se le banea durante un instante antes de desbloquearlo; el usuario puede volver a entrar con una nueva invitación.
- `/mute usuario:[usuario] minutos:[1-40320] razon:[opcional]` — silencia al usuario (mediante el tiempo de espera nativo de Discord) durante el tiempo indicado.
- `/unmute usuario:[usuario]` — elimina el silencio antes de que expire.
- `/unban usuario_id:[ID de usuario] razon:[opcional]` — quita el baneo utilizando el ID del usuario (ya que un usuario baneado no puede seleccionarse desde la lista de miembros).

Los comandos de ban, kick, softban, mute y unban también intentan enviar un mensaje directo al usuario afectado (con el estilo de una tarjeta embed de Discord, con una barra lateral de color, título y campos) explicando qué ocurrió, el motivo y quién realizó la acción. Si el usuario tiene los mensajes directos cerrados o no comparte un servidor con el bot, el envío falla silenciosamente y la acción de moderación se realiza normalmente. Puedes cambiar los títulos, colores o textos editando el objeto `DM_EMBED_CONFIG` y la función `buildModEmbed` al principio de `index.js`.

Estos comandos requieren que tu rol y el rol del bot tengan los permisos de moderación correspondientes (Discord los oculta automáticamente a los miembros que no tienen el permiso adecuado). Para que el bot pueda moderar a alguien, su rol debe estar **por encima** del rol de esa persona en la lista de roles del servidor.

Cada acción publica un mensaje visible para todos en el canal, mencionando al usuario afectado y a quien ejecutó el comando (por ejemplo, "@usuario fue enviado a Ban Island por @moderador 🔨"). Puedes cambiar el texto de estas frases editando el objeto `MOD_PHRASES` al principio de `index.js`.

### Respuestas con GIF aleatorios

Si alguien responde directamente a un mensaje del bot, este responde automáticamente con un GIF aleatorio de una de estas categorías (elegida al azar): tsundere, gatos, perros o focas. Utiliza la API gratuita de GIPHY (100 solicitudes por hora con una clave beta, suficiente para uso personal). No es necesario utilizar ningún comando, ya que es automático. Puedes cambiar las categorías editando el arreglo `GIF_CATEGORIES` al principio de `index.js`.

## Notas

- El modelo utilizado es `openai/gpt-oss-20b` (gratuito en el plan para desarrolladores de Groq). Si quieres respuestas de mayor calidad a cambio de un poco más de latencia, puedes cambiarlo en `index.js` a `openai/gpt-oss-120b`. Groq actualiza periódicamente los modelos disponibles de forma gratuita, así que si en el futuro aparece un error `model_not_found`, consulta la lista actual en [console.groq.com/docs/models](https://console.groq.com/docs/models).
- Discord limita los mensajes a 2000 caracteres; el bot divide automáticamente las respuestas largas en varios mensajes.
- La conversión de GIF utiliza `ffmpeg-static`, que incluye el ejecutable de ffmpeg, por lo que no necesitas instalar nada adicional en el sistema.
- Para invitar el bot a otro servidor, genera un nuevo enlace en el portal de Discord (OAuth2 > Generador de URL) con los permisos `bot` y `applications.commands`.
