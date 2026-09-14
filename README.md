# Discord Bot with AI (Groq)

Discord bot that responds to the `/ask` command using Groq's free API (open-source models like Llama), plus moderation, GIF conversion, forum posting, and a small code snippet storage system.

## Requirements

- [Node.js](https://nodejs.org) version 18 or higher.
- An application/bot created in the [Discord Developer Portal](https://discord.com/developers/applications).
- A free API key from [console.groq.com](https://console.groq.com).
- A free API key from [developers.giphy.com](https://developers.giphy.com) (for random GIF replies).

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
   - `GIPHY_API_KEY`: your free GIPHY API key.

3. Register the slash commands globally, so they work on any server the bot joins (only needed once, or whenever you change a command — can take up to 1 hour to propagate the first time):

   ```bash
   npm run deploy
   ```

   For instant testing on a single server instead of waiting for the global rollout, use your test server's ID (`DISCORD_GUILD_ID` in `.env`) with:

   ```bash
   npm run deploy:dev
   ```

   This updates commands almost immediately, but only on that one server. Useful while developing — switch back to `npm run deploy` when you're ready to publish a change everywhere.

4. Start the bot:

   ```bash
   npm start
   ```

## Usage

In any channel where the bot is present, type:

```
/ask message: What is the capital of France?
```

The bot will respond using an AI model. Each channel keeps its own recent conversation history (in memory, lost if the bot restarts) to keep responses contextual.

### Convert video or image to GIF

```
/gif file: [attach your video or image] duration: 5 width: 320
```

- `file` (required): the video or image you want to convert.
- `duration` (optional, default 5): seconds to take from the start of the video (max 15).
- `width` (optional, default 320): width in pixels of the resulting GIF; height adjusts automatically.

The bot downloads the file, converts it with ffmpeg, and replies with the GIF. Files over 25 MB are not accepted.

### Moderation

- `/ban user:[user] reason:[optional] delete_days:[0-7, optional]` — permanently bans.
- `/kick user:[user] reason:[optional]` — kicks from the server (they can rejoin with an invite).
- `/softban user:[user] reason:[optional] delete_days:[optional, default 1]` — bans and immediately unbans. **This already wipes the user's recent messages** (based on the days set in `delete_days`) since it technically bans them for an instant before unbanning; the user can rejoin with a new invite.
- `/mute user:[user] minutes:[1-40320] reason:[optional]` — mutes (Discord's native timeout) for the given time.
- `/unmute user:[user]` — removes the mute before it expires.
- `/unban user_id:[user ID] reason:[optional]` — unbans using the user's ID (since a banned user can't be selected from the member list).

Ban, kick, softban, mute, and unban also try to send the affected user a direct message (styled as a Discord embed card, with a colored side bar, title, and fields) explaining what happened, the reason, and who took the action. If the user has DMs closed or doesn't share a server with the bot, this silently fails and the moderation action still goes through normally. You can change the titles, colors, or wording by editing the `DM_EMBED_CONFIG` object and the `buildModEmbed` function at the top of `index.js`.

These commands require your role and the Bot's role to have the corresponding moderation permissions (Discord automatically hides them from members without the right permission). For the Bot to be able to moderate someone, its role must be **above** that person's role in the server's role list.

Each action also posts an embed card visible to everyone in the channel, mentioning the affected user and whoever ran the command. You can change the wording by editing the `MOD_PHRASES` and `DM_EMBED_CONFIG` objects at the top of `index.js`.

### Forum posts

```
/forum channel: [pick a forum channel] title: My post content: Post text here image1: [optional]
```

- `channel` (required): must be a forum-type channel (the picker only shows forum channels).
- `title` (required, max 100 characters).
- `content` (required, max 2000 characters).
- `image1`, `image2`, `image3` (optional): up to 3 images attached to the post.

Note: this command doesn't support forums that require mandatory tags yet.

### Code snippet storage

- `/save-code project:[name] name:[filename] file:[optional attachment] content:[optional plain text]` — saves a file or plain text snippet into a project folder on the server's disk. Requires Moderate Members or Administrator permission. You need either `file` or `content` (or both).
- `/code project:[name] name:[filename]` — retrieves a previously saved snippet. Open to everyone at the Discord level, but internally requires either the **"Scripter"** role or Admin/Mod permissions (change the role name by editing `SCRIPTER_ROLE_NAME` at the top of `index.js`).

Both commands have autocomplete for `project` (and `name` on `/code`) based on what's already saved. Files are stored under a `codigos/` folder next to `index.js` — this folder is **not** meant to be committed to git (make sure it's in your `.gitignore`).

### Random GIF replies

If someone replies directly to a message from the Bot, it automatically responds with a random GIF from one of these categories (chosen at random): tsundere, cats, dogs, or seals. It uses GIPHY's free API (100 requests/hour on a beta key, plenty for personal use). No command needed, it's automatic. You can change the categories by editing the `GIF_CATEGORIES` array at the top of `index.js`.

## Notes

- The model used is `openai/gpt-oss-20b` (free on Groq's developer plan). If you want higher-quality responses at the cost of a bit more latency, you can change it in `index.js` to `openai/gpt-oss-120b`. Groq periodically updates which models are available for free, so if you get a "model_not_found" error in the future, check the current list at [console.groq.com/docs/models](https://console.groq.com/docs/models).
- Discord limits messages to 2000 characters; the bot automatically splits long responses into multiple messages.
- GIF conversion uses `ffmpeg-static`, which bundles the ffmpeg executable itself — you don't need to install anything separately on the system.
- To invite the bot to another server, generate a new link in the Discord portal (OAuth2 > URL Generator) with the `bot` and `applications.commands` scopes.
