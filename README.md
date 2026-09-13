# Discord Bot with AI (Groq)

Discord bot that responds to the `/pregunta` command using Groq's free API (open-source models like Llama).

## Requirements

- [Node.js](https://nodejs.org) version 18 or higher.
- An application/bot created in the [Discord Developer Portal](https://discord.com/developers/applications).
- A free API key from [console.groq.com](https://console.groq.com).

## Installation

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

   - `DISCORD_TOKEN`: your bot's token (Discord portal > your app > Bot > Reset Token).
   - `DISCORD_CLIENT_ID`: Application ID (Discord portal > your app > General Information).
   - `DISCORD_GUILD_ID`: your server's ID (right-click your server icon > Copy Server ID, requires Developer Mode enabled in Discord). No longer used for command registration (commands are now global), kept in case you need it later.
   - `GROQ_API_KEY`: your free Groq API key.

3. Register the slash commands globally, so they work on any server the bot joins (only needed once, or whenever you change a command — can take up to 1 hour to propagate the first time):

   ```bash
   npm run deploy
   ```

4. Start the bot:

   ```bash
   npm start
   ```

## Usage

In any channel where the bot is present, type:

```
/pregunta mensaje: What is the capital of France?
```

The bot will respond using an AI model. Each channel keeps its own recent conversation history (in memory, lost if the bot restarts) to keep responses contextual.

### Convert video or image to GIF

```
/gif archivo: [attach your video or image] duracion: 5 ancho: 320
```

- `archivo` (required): the video or image you want to convert.
- `duracion` (optional, default 5): seconds to take from the start of the video (max 15).
- `ancho` (optional, default 320): width in pixels of the resulting GIF; height adjusts automatically.

The bot downloads the file, converts it with ffmpeg, and replies with the GIF. Files over 25 MB are not accepted.

### Moderation

- `/ban usuario:[user] razon:[optional] dias_borrado:[0-7, optional]` — permanently bans.
- `/kick usuario:[user] razon:[optional]` — kicks from the server (they can rejoin with an invite).
- `/softban usuario:[user] razon:[optional] dias_borrado:[optional, default 1]` — bans and immediately unbans. **This already wipes the user's recent messages** (based on the days set in `dias_borrado`) since it technically bans them for an instant before unbanning; the user can rejoin with a new invite.
- `/mute usuario:[user] minutos:[1-40320] razon:[optional]` — mutes (Discord's native timeout) for the given time.
- `/unmute usuario:[user]` — removes the mute before it expires.
- `/unban usuario_id:[user ID] razon:[optional]` — unbans using the user's ID (since a banned user can't be selected from the member list).

Ban, kick, softban, mute, and unban also try to send the affected user a direct message (styled as a Discord embed card, with a colored side bar, title, and fields) explaining what happened, the reason, and who took the action. If the user has DMs closed or doesn't share a server with the bot, this silently fails and the moderation action still goes through normally. You can change the titles, colors, or wording by editing the `DM_EMBED_CONFIG` object and the `buildModEmbed` function at the top of `index.js`.

These commands require your role and the Bot's role to have the corresponding moderation permissions (Discord automatically hides them from members without the right permission). For the Bot to be able to moderate someone, its role must be **above** that person's role in the server's role list.

Each action posts a message visible to everyone in the channel, mentioning the affected user and whoever ran the command (e.g., "@user was sent to Ban Island by @moderator 🔨"). You can change the wording of these phrases by editing the `MOD_PHRASES` object at the top of `index.js`.

### Random GIF replies

If someone replies directly to a message from the Bot, it automatically responds with a random GIF from one of these categories (chosen at random): tsundere, cats, dogs, or seals. It uses GIPHY's free API (100 requests/hour on a beta key, plenty for personal use). No command needed, it's automatic. You can change the categories by editing the `GIF_CATEGORIES` array at the top of `index.js`.

## Notes

- The model used is `openai/gpt-oss-20b` (free on Groq's developer plan). If you want higher-quality responses at the cost of a bit more latency, you can change it in `index.js` to `openai/gpt-oss-120b`. Groq periodically updates which models are available for free, so if you get a "model_not_found" error in the future, check the current list at [console.groq.com/docs/models](https://console.groq.com/docs/models).
- Discord limits messages to 2000 characters; the bot automatically splits long responses into multiple messages.
- GIF conversion uses `ffmpeg-static`, which bundles the ffmpeg executable itself — you don't need to install anything separately on the system.
- To invite the bot to another server, generate a new link in the Discord portal (OAuth2 > URL Generator) with the `bot` and `applications.commands` scopes.
