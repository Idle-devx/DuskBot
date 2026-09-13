<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Discord Bot (Groq) - Documentation</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-color: #6366f1;
            --accent-hover: #818cf8;
            --code-bg: #090d16;
            --border-color: #334155;
            --inline-code-bg: #334155;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            line-height: 1.7;
            margin: 0;
            padding: 40px 20px;
        }

        .container {
            max-width: 850px;
            margin: 0 auto;
            background-color: var(--card-bg);
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            border: 1px solid var(--border-color);
        }

        h1 {
            font-size: 2.25rem;
            color: var(--text-primary);
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 12px;
            margin-top: 0;
        }

        h2 {
            font-size: 1.5rem;
            color: var(--accent-hover);
            margin-top: 32px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
        }

        h3 {
            font-size: 1.2rem;
            color: #cbd5e1;
            margin-top: 24px;
        }

        p {
            color: var(--text-secondary);
            margin-bottom: 16px;
        }

        a {
            color: var(--accent-hover);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        ul {
            color: var(--text-secondary);
            padding-left: 24px;
            margin-bottom: 20px;
        }

        li {
            margin-bottom: 8px;
        }

        code {
            font-family: "Fira Code", Consolas, Monaco, "Andale Mono", monospace;
            background-color: var(--inline-code-bg);
            color: #f1f5f9;
            padding: 3px 6px;
            border-radius: 4px;
            font-size: 0.9em;
        }

        pre {
            background-color: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            margin: 16px 0;
        }

        pre code {
            background-color: transparent;
            padding: 0;
            color: #e2e8f0;
            font-size: 0.95em;
        }

        strong {
            color: var(--text-primary);
        }
    </style>
</head>
<body>

<div class="container">

    <h1>AI Discord Bot (Groq)</h1>

    <p>Discord bot that responds to the <code>/pregunta</code> command using Groq's free API (open-source models such as Llama).</p>

    <h2>Requirements</h2>

    <ul>
        <li><a href="https://nodejs.org" target="_blank">Node.js</a> version 18 or higher.</li>
        <li>An application/bot created in the <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a>.</li>
        <li>A free API key from <a href="https://console.groq.com" target="_blank">console.groq.com</a>.</li>
    </ul>

    <h2>Installation</h2>

    <p>1. Install dependencies:</p>
    <pre><code>npm install</code></pre>

    <p>2. Copy <code>.env.example</code> to <code>.env</code> and fill in the values:</p>
    <pre><code>cp .env.example .env</code></pre>

    <ul>
        <li><code>DISCORD_TOKEN</code>: bot token (Discord portal &gt; your app &gt; Bot &gt; Reset Token).</li>
        <li><code>DISCORD_CLIENT_ID</code>: Application ID (Discord portal &gt; your app &gt; General Information).</li>
        <li><code>DISCORD_GUILD_ID</code>: your server ID (right-click server icon &gt; Copy ID, requires Developer Mode enabled in Discord).</li>
        <li><code>GROQ_API_KEY</code>: your free Groq API key.</li>
    </ul>

    <p>3. Register the slash command on your server (only required once, or whenever you change the command):</p>
    <pre><code>npm run deploy</code></pre>

    <p>4. Start the bot:</p>
    <pre><code>npm start</code></pre>

    <h2>Usage</h2>

    <p>In any channel where the bot is present, type:</p>
    <pre><code>/pregunta mensaje: What is the capital of France?</code></pre>

    <p>The bot will respond using Claude. Each channel maintains its own recent conversation history (in memory, lost if the bot restarts) to provide continuity in responses.</p>

    <h3>Convert video or image to GIF</h3>
    <pre><code>/gif archivo: [attach your video or image] duracion: 5 ancho: 320</code></pre>

    <ul>
        <li><code>archivo</code> (required): the video or image you want to convert.</li>
        <li><code>duracion</code> (optional, default 5): seconds to capture from the start of the video (maximum 15).</li>
        <li><code>ancho</code> (optional, default 320): pixel width of the resulting GIF; height adjusts automatically.</li>
    </ul>

    <p>The bot downloads the file, converts it using ffmpeg, and replies with the GIF. Files over 25 MB are not accepted.</p>

    <h3>Moderation</h3>

    <ul>
        <li><code>/ban usuario:[user] razon:[optional] dias_borrado:[0-7, optional]</code> — permanently bans a user.</li>
        <li><code>/kick usuario:[user] razon:[optional]</code> — kicks a user from the server (they can rejoin with an invite).</li>
        <li><code>/softban usuario:[user] razon:[optional] dias_borrado:[optional, default 1]</code> — bans and immediately unbans. <strong>This deletes the user's recent messages</strong> (based on the days specified in <code>dias_borrado</code>) because it technically bans them for an instant before unbanning; the user can rejoin using a new invite.</li>
        <li><code>/mute usuario:[user] minutos:[1-40320] razon:[optional]</code> — mutes (native Discord timeout) for the specified duration.</li>
        <li><code>/unmute usuario:[user]</code> — removes the mute before it expires.</li>
    </ul>

    <p>These commands require both your role and the Bot's role to have moderation permissions (Discord automatically hides them from members without appropriate permissions). For the Bot to moderate a user, the Bot's role must be <strong>above</strong> that person's role in the server's role list.</p>

    <p>Each action posts a publicly visible message in the channel mentioning the target user and the moderator who executed the command (for example: "@user was sent to Ban Island by @moderator 🔨"). You can change these messages by editing the <code>MOD_PHRASES</code> object at the top of <code>index.js</code>.</p>

    <h3>Random GIF Replies</h3>

    <p>If someone directly replies to a message sent by the Bot, the bot automatically responds with a random GIF from one of these categories (chosen at random): tsundere, cats, dogs, or seals. It uses Tenor's free API. No command is required; it triggers automatically. You can modify the categories by editing the <code>GIF_CATEGORIES</code> array at the top of <code>index.js</code>.</p>

    <h2>Notes</h2>

    <ul>
        <li>The default model used is <code>openai/gpt-oss-20b</code> (free on Groq's developer plan). If you want higher-quality responses at the cost of slightly higher latency, you can change it in <code>index.js</code> to <code>openai/gpt-oss-120b</code>. Groq updates its list of free models over time, so if you encounter a "model_not_found" error in the future, check the current list at <a href="https://console.groq.com/docs/models" target="_blank">console.groq.com/docs/models</a>.</li>
        <li>Discord limits messages to 2000 characters; the bot automatically splits long responses into multiple messages.</li>
        <li>GIF conversion uses <code>ffmpeg-static</code>, which bundled its own ffmpeg binary — no additional system installations are required.</li>
        <li>To invite the bot to another server, generate a new link in the Discord portal (OAuth2 &gt; URL Generator) selecting the <code>bot</code> and <code>applications.commands</code> scopes.</li>
    </ul>

</div>

</body>
</html>
