# Discord Bot with AI (Groq)

Discord bot that responds to the `/ask` command using Groq's free API (open-source models like Llama), plus moderation, GIF conversion, forum posting, tickets, member verification, anti-raid protection, and a small code snippet storage system.

## Project structure

```
discord-bot/
├── src/
│   ├── index.js              # Entry point: creates the client, wires up every handler
│   ├── commands/
│   │   └── definitions.js    # All slash command definitions (registered by scripts/deploy-*.js)
│   ├── handlers/             # One file per feature — each exports a register*Handler(s)(client) function
│   │   ├── ask.js            # /ask (Groq)
│   │   ├── gif.js            # /gif (video/image -> GIF conversion)
│   │   ├── gifReplies.js     # Automatic GIF replies (GIPHY)
│   │   ├── forum.js          # /forum
│   │   ├── moderation.js     # /ban /kick /softban /mute /unmute /unban, /modlogs-setup, /access-setup
│   │   ├── codeStorage.js    # /save-code /delete-code /code
│   │   ├── tickets.js        # /ticket-setup, /close, ticket panel + auto-close
│   │   ├── verify.js         # /verify-setup, auto-kick unverified members
│   │   └── antiraid.js       # /antiraid-setup, mass-join lockdown
│   └── lib/                  # Shared code used by more than one handler
│       ├── constants.js      # DATA_DIR, MAX_INPUT_SIZE
│       ├── jsonStore.js      # Locked read-modify-write helper for the JSON config/state files
│       ├── accessConfig.js   # Per-guild access-config.json (shared by moderation.js and codeStorage.js)
│       └── embeds.js         # DM/channel/log embed builders for moderation actions
├── scripts/                  # One-off scripts you run from the command line, not loaded by the bot itself
│   ├── deploy-commands.js
│   ├── deploy-commands-dev.js
│   ├── deploy-foro-local-test.js
│   ├── check-commands.js
│   └── clear-guild-commands.js
├── data/                     # Generated at runtime: per-guild config/state JSON files + saved code snippets.
│                              # Gitignored — see .gitignore. Nothing in here is source code.
├── .env.example
├── package.json
└── README.md
```

Every feature module under `src/handlers/` follows the same shape: it owns its own slice of `data/` (through `src/lib/jsonStore.js`) and exports one `register*Handler(s)(client)` function that `src/index.js` calls once at startup. Adding a new feature means adding one file to `src/handlers/`, one call in `src/index.js`, and (if it needs a slash command) one entry in `src/commands/definitions.js`.

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
   - `DISCORD_GUILD_ID`: your server's ID (right-click your server icon > Copy Server ID, requires Developer Mode enabled in Discord). Only used by `deploy:dev` and `clear-guild-commands`, not by the bot itself.
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

The bot will respond using an AI model. Each user keeps their own recent conversation history per channel (in memory, lost if the bot restarts) to keep responses contextual — one person's questions never leak into another person's answers, even in the same channel.

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

Ban, kick, softban, and unban try to send the affected user a direct message (styled as a Discord embed card) explaining what happened, the reason, and who took the action — **sent only after the action itself has succeeded**, so you never get a "you were banned" DM for a ban that actually failed (e.g. because the bot's role sits below yours). If the user has DMs closed or doesn't share a server with the bot, this silently fails and the moderation action still goes through normally. You can change the titles, colors, or wording in `src/lib/embeds.js`.

These commands require your role and the Bot's role to have the corresponding moderation permissions (Discord automatically hides them from members without the right permission). For the Bot to be able to moderate someone, its role must be **above** that person's role in the server's role list.

Each action also posts an embed card visible to everyone in the channel, mentioning the affected user and whoever ran the command.

### Moderation logs channel

```
/modlogs-setup log_channel:[channel]
```

Admin-only command that sets a dedicated channel where every ban, kick, softban, mute, unmute, and unban gets logged as its own styled embed (title like "User Banned", with User, User ID, Staff, and Reason fields — plus Duration for mutes). This is separate from the in-channel confirmation message and from the DM sent to the affected user; it's meant as a permanent audit log for staff. Saved per-server in `data/modlogs-config.json`. Run the command again anytime to change the channel.

### Forum posts

```
/forum channel: [pick a forum channel] title: My post content: Post text here image1: [optional]
```

- `channel` (required): must be a forum-type channel (the picker only shows forum channels).
- `title` (required, max 100 characters).
- `content` (required, max 2000 characters).
- `image1`, `image2`, `image3` (optional): up to 3 images attached to the post.

Note: this command doesn't support forums that require mandatory tags yet.

### Ticket system

```
/ticket-setup panel_channel:[channel] category:[optional] log_channel:[optional] support_roles:[optional, mention roles e.g. @Staff @Helper] alert_hours:[optional, default 3] inactivity_hours:[optional, default 24]
```

Admin-only command that posts a persistent embed with an "Open Ticket" button in `panel_channel`. Run it again anytime to move the panel or change any setting — it's saved per-server in `data/tickets-config.json`. `support_roles` accepts multiple roles — just @mention all of them in that one option (e.g. `@Staff @Helper`).

How it works for users:
1. They click **"Open Ticket"** on the panel.
2. They pick a category from a dropdown (edit the `TICKET_CATEGORIES` array at the top of `src/handlers/tickets.js` to customize these).
3. A private text channel is created (visible only to them, any configured support roles, and Admins/Manage Channels), with a welcome message and a **"Close Ticket"** button.
4. Anyone with permission clicks **"Close Ticket"**, or runs **`/close`** inside the ticket channel (does the same thing, no need to scroll to find the button) — the bot generates a plain-text transcript of the whole conversation, sends it to the log channel (if configured), and deletes the ticket channel a few seconds later.

Only the ticket opener, any of the configured support roles, and members with Administrator/Manage Channels can close a ticket (via button or `/close`).

**Inactivity alert and auto-close:** a background check runs every 5 minutes. If a ticket has been open longer than `alert_hours` (default 3) without being closed, the bot posts a one-time reminder in the channel (pinging the support role, if set). If a ticket goes `inactivity_hours` (default 24) with **zero messages** from anyone, it closes automatically the same way the button does (transcript + log + delete) — the inactivity timer resets on every new message in the channel. Open-ticket tracking is stored in `data/tickets-state.json`, and it's only cleared once the channel has actually been deleted — so a bot restart mid-close never leaves an orphaned, untracked ticket channel behind.

All of this logic lives in `src/handlers/tickets.js`.

### Anti-raid lockdown

```
/antiraid-setup log_channel:[channel] join_threshold:[optional, default 5] time_window_seconds:[optional, default 10] action:[Kick/Ban, optional, default Kick] lockdown_minutes:[optional, default 10]
```

Admin-only command. If **`join_threshold`+ members join within `time_window_seconds`**, the bot treats it as a raid and automatically:

1. Raises the server's verification level to **High** (blocks unverified/very new accounts from participating).
2. Revokes **every active invite link** so no one new can get in through them.
3. **Kicks or bans** (your choice) everyone who joined during that burst.
4. Logs a full report to your configured channel.
5. After `lockdown_minutes`, automatically reverts the verification level back to what it was before (revoked invites stay revoked — create new ones manually if needed).

This is a heuristic, not a guarantee: a slow, spread-out raid that stays under your threshold won't trigger it, and a genuine viral growth spurt could false-positive into a lockdown. Tune `join_threshold` and `time_window_seconds` to what's normal for your server. Bots added via OAuth don't count toward the join burst (only regular accounts do). All of this logic lives in `src/handlers/antiraid.js`.

### Per-server access roles

```
/access-setup moderation_roles:[optional, mention roles] save_code_roles:[optional, mention roles] code_roles:[optional, mention roles] clear_moderation_roles:[optional] clear_save_code_roles:[optional] clear_code_roles:[optional]
```

Admin-only command. Moderation commands, `/save-code`/`/delete-code`, and `/code` are registered without Discord's native permission restrictions — access is fully controlled in `src/handlers/moderation.js` and `src/handlers/codeStorage.js` instead, so each server can layer its own extra role(s) on top of the usual Discord permissions:

- `moderation_roles`: can use ban/kick/softban/mute/unmute/unban, in addition to whoever already has the matching native Discord permission (Ban Members, Kick Members, Moderate Members) or Administrator.
- `save_code_roles`: can use `/save-code` and `/delete-code`, in addition to Mods/Admins.
- `code_roles`: required to use `/code` — if you don't set this, it falls back to anyone with a role literally named **"Scripter"** (change `SCRIPTER_ROLE_NAME` at the top of `src/handlers/codeStorage.js` if you want a different default name).

Each of these accepts **multiple roles** — just @mention all of them in the same option (e.g. `@Mod @Trusted`). Use the matching `clear_*` boolean to remove a configured set of roles and fall back to the defaults above. Saved per-server in `data/access-config.json`.

**Every configuration in this bot — tickets, verification, moderation logs, anti-raid, access roles, and code storage — is stored per-server (keyed by the server's ID), under `data/`.** Running the bot on multiple servers never mixes their settings or data together.

### Code snippet storage

- `/save-code project:[name] name:[filename] file:[optional attachment] content:[optional plain text]` — saves a file or plain text snippet into a project folder. Requires Moderate Members or Administrator permission (or a configured `save_code_roles`). You need either `file` or `content` (or both). Attached files are capped at 25 MB, same as `/gif`.
- `/code project:[name] name:[filename]` — retrieves a previously saved snippet. Open to everyone at the Discord level, but internally requires either the **"Scripter"** role or Admin/Mod permissions (change the role name by editing `SCRIPTER_ROLE_NAME` at the top of `src/handlers/codeStorage.js`).

Both commands have autocomplete for `project` (and `name` on `/code`) based on what's already saved. Files are stored under `data/codigos/` — already covered by `.gitignore`.

### Random GIF replies

If someone replies directly to a message from the Bot, it automatically responds with a random GIF from one of these categories (chosen at random): tsundere, cats, dogs, or seals. It uses GIPHY's free API (100 requests/hour on a beta key, plenty for personal use). No command needed, it's automatic. You can change the categories by editing the `GIF_CATEGORIES` array at the top of `src/handlers/gifReplies.js`.

## Notes

- The model used is `openai/gpt-oss-20b` (free on Groq's developer plan). If you want higher-quality responses at the cost of a bit more latency, you can change it in `src/handlers/ask.js` to `openai/gpt-oss-120b`. Groq periodically updates which models are available for free, so if you get a "model_not_found" error in the future, check the current list at [console.groq.com/docs/models](https://console.groq.com/docs/models).
- Discord limits messages to 2000 characters; the bot automatically splits long responses into multiple messages.
- GIF conversion uses `ffmpeg-static`, which bundles the ffmpeg executable itself — you don't need to install anything separately on the system. Note that `fluent-ffmpeg` itself is no longer maintained upstream; it still works fine today, but it's worth keeping an eye on for a future replacement.
- To invite the bot to another server, generate a new link in the Discord portal (OAuth2 > URL Generator) with the `bot` and `applications.commands` scopes.
- `node scripts/check-commands.js` does a quick static check that every command in `src/commands/definitions.js` has a matching handler under `src/handlers/` — useful after adding or renaming a command.
