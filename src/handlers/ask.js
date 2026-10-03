// /ask: sends the user's message to Gemini and replies with the model's
// answer, splitting it into multiple messages if it's over Discord's 2000
// character limit. /ask-setup lets each server replace the bot's default
// personality with its own.
import { MessageFlags } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { getGuildValue, setGuildValue } from "../lib/jsonStore.js";

const CONFIG_PATH = join(DATA_DIR, "ask-config.json");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Tried in order: Google's free tier regularly answers 503 ("high demand")
// or 429 (quota) for one model while another is fine.
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"];
const RETRY_DELAY_MS = 1500;

const isBusyError = (error) => error?.status === 503 || error?.status === 429;

// Used on every server that hasn't set its own with /ask-setup.
const DEFAULT_PERSONALITY = `Your personality is tsundere. You act a little put out at being asked and
insist you're not helping because you care or anything, yet you always end up giving a
complete, correct and genuinely useful answer, and now and then your warmer side slips out
before you cover it up. Keep it playful and light: tease, never insult or belittle the person,
and don't let the act get in the way of the actual answer. If the topic is serious or the
person seems upset, drop the act and just be kind and clear.`;

// These facts hold on every server, whatever personality it configured, so
// they live apart from the personality text. The model name is filled in per
// request because the fallback model may be the one that answers.
function buildSystemInstruction(model, personality) {
  return `You are DuskBot, a Discord bot developed by Duskidle. You are running on Google's
${model} model and you started operating in September 2026.

When someone asks who created you, what you are, which model you use, or since when you've
been around, answer with those facts, in character and with a bit of humor, along the lines
of: "I'm a bot developed by Duskidle, I use the ${model} model, and I started operating in
September 2026". Don't bring these facts up when nobody asked.

${personality}

Reply in the same language the person writes in. You're talking in a Discord chat, so keep
answers reasonably short unless the question needs detail.`;
}

// Gemini's thinking tokens count against this budget too, so it's set
// higher than the visible answer length we actually want.
const MAX_OUTPUT_TOKENS = 2048;

// Attachments are sent inline (base64) in the request, which Gemini caps at
// 20 MB total; base64 adds ~33%, so 10 MB of raw file leaves headroom.
const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

// Text files are pasted into the prompt, so they're bounded by the model's
// token limits rather than the request size.
const MAX_TEXT_SIZE = 1024 * 1024;

// GIF and other image formats aren't accepted by Gemini, so images are an
// explicit list instead of "anything image/*".
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

const TEXT_APPLICATION_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-yaml",
  "application/x-sh",
  "application/sql",
  "application/toml",
]);

// Discord often reports no content type (or a generic one) for source code,
// so the extension is the fallback for deciding a file is plain text.
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "tsv", "log", "json", "xml", "yaml", "yml", "toml", "ini", "env", "html", "css",
  "js", "mjs", "cjs", "ts", "jsx", "tsx", "py", "lua", "luau", "java", "kt", "c", "h", "cpp", "hpp",
  "cs", "go", "rs", "rb", "php", "sh", "ps1", "bat", "sql",
]);

// Returns "media" (sent as inline binary), "text" (pasted into the prompt),
// or null if Gemini can't read this kind of file.
function classifyAttachment(attachment) {
  const mimeType = (attachment.contentType ?? "").split(";")[0].trim().toLowerCase();
  const extension = attachment.name.includes(".") ? attachment.name.split(".").pop().toLowerCase() : "";

  if (IMAGE_TYPES.has(mimeType) || mimeType === "application/pdf") return { kind: "media", mimeType };
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return { kind: "media", mimeType };
  if (mimeType.startsWith("text/") || TEXT_APPLICATION_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(extension)) {
    return { kind: "text" };
  }
  return null;
}

async function buildFilePart(attachment, kind, mimeType) {
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Failed to download attachment: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  if (kind === "media") {
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  }
  return { text: `Contents of the attached file "${attachment.name}":\n\n${buffer.toString("utf-8")}` };
}

async function generate(contents, personality) {
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            systemInstruction: buildSystemInstruction(model, personality),
          },
        });
      } catch (error) {
        if (!isBusyError(error)) throw error;
        lastError = error;
        console.warn(`Gemini ${model} unavailable (HTTP ${error.status}), attempt ${attempt + 1}`);
        // A quota error won't clear in a second; go straight to the next model.
        if (error.status === 429) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

// Keeps the last few turns per conversation to give responses continuity.
// Lost if the bot restarts (not persistent) — that's fine, it's just a
// short-term memory aid, not something that needs to survive a restart.
//
// IMPORTANT: keyed by "channelId:userId", not just channelId. An earlier
// version keyed this by channel alone, which meant every user talking to
// the bot in the same channel shared one conversation — one person's
// prompt (or an injected instruction) could leak into or steer another
// person's answer. Keying per user keeps the "continuity within a channel"
// behavior while keeping each person's context to themselves.
const MAX_TURNS_PER_CONVERSATION = 10;
const conversations = new Map(); // "channelId:userId" -> [{role, parts: [{text}]}, ...]

function conversationKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

function getHistory(key) {
  if (!conversations.has(key)) {
    conversations.set(key, []);
  }
  return conversations.get(key);
}

// `role` is "user" or "model" (Gemini's name for the assistant turn).
function pushToHistory(key, role, text) {
  const history = getHistory(key);
  history.push({ role, parts: [{ text }] });
  // Keep only the last N turns so it doesn't grow indefinitely
  while (history.length > MAX_TURNS_PER_CONVERSATION * 2) {
    history.shift();
  }
}

// Discord limits messages to 2000 characters, so if the model's response is
// longer, we split it into multiple messages.
function splitMessage(text, maxLength = 1900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cutAt = remaining.lastIndexOf("\n", maxLength);
    if (cutAt === -1) cutAt = maxLength;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  chunks.push(remaining);
  return chunks;
}

export function registerAskHandler(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "ask") return;

    const userMessage = interaction.options.getString("message");
    const attachment = interaction.options.getAttachment("file");
    const key = conversationKey(interaction.channelId, interaction.user.id);

    let fileType = null;
    if (attachment) {
      fileType = classifyAttachment(attachment);
      if (!fileType) {
        await interaction.reply({
          content:
            "I can't read that kind of file. Supported: images (PNG, JPEG, WebP, HEIC), PDF, audio, video, and text/code files.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const maxSize = fileType.kind === "media" ? MAX_MEDIA_SIZE : MAX_TEXT_SIZE;
      if (attachment.size > maxSize) {
        await interaction.reply({
          content: `That file is too large (max ${maxSize / (1024 * 1024)} MB for this kind of file).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Let Discord know we're processing (the model can take a few seconds)
    await interaction.deferReply();

    try {
      const history = getHistory(key);

      const userParts = [{ text: userMessage }];
      if (attachment) {
        userParts.unshift(await buildFilePart(attachment, fileType.kind, fileType.mimeType));
      }

      // Outside a server (e.g. DMs) there's no per-guild config to look up.
      const config = interaction.guildId ? await getGuildValue(CONFIG_PATH, interaction.guildId, null) : null;
      const personality = config?.personality || DEFAULT_PERSONALITY;

      const response = await generate([...history, { role: "user", parts: userParts }], personality);

      // Empty when the safety filters block the answer or the token budget
      // ran out before any visible text was produced.
      const replyText = response.text?.trim();
      if (!replyText) {
        await interaction.editReply("The model didn't return an answer for that. Try rephrasing it.");
        return;
      }

      // The file itself isn't kept in history (it would be re-uploaded on
      // every later turn); follow-ups rely on the model's answer about it.
      pushToHistory(key, "user", attachment ? `[Attached file: ${attachment.name}] ${userMessage}` : userMessage);
      pushToHistory(key, "model", replyText);

      const chunks = splitMessage(replyText);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    } catch (error) {
      console.error("Error calling the Gemini API:", error);
      await interaction.editReply(
        isBusyError(error)
          ? "The AI is overloaded right now. Try again in a minute."
          : "An error occurred while talking to the model. Check the bot's console for more details."
      );
    }
  });

  // --- /ask-setup ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "ask-setup") return;

    const personality = interaction.options.getString("personality")?.trim();
    const reset = interaction.options.getBoolean("reset") ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (reset) {
        await setGuildValue(CONFIG_PATH, interaction.guild.id, { personality: null });
        await interaction.editReply("✅ Personality reset. /ask is back to the default one on this server.");
        return;
      }

      if (personality) {
        await setGuildValue(CONFIG_PATH, interaction.guild.id, { personality });
        await interaction.editReply(`✅ /ask will now use this personality on this server:\n>>> ${personality}`);
        return;
      }

      const config = await getGuildValue(CONFIG_PATH, interaction.guild.id, null);
      await interaction.editReply(
        config?.personality
          ? `This server's custom personality for /ask:\n>>> ${config.personality}`
          : "This server uses the default personality. Set your own with the `personality` option."
      );
    } catch (error) {
      console.error("Error in /ask-setup:", error);
      await interaction.editReply("An error occurred saving the configuration.");
    }
  });
}
