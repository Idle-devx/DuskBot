// /ask: sends the user's message to Gemini and replies with the model's
// answer, splitting it into multiple messages if it's over Discord's 2000
// character limit.
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = "gemini-3.8-flash";

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
          ephemeral: true,
        });
        return;
      }

      const maxSize = fileType.kind === "media" ? MAX_MEDIA_SIZE : MAX_TEXT_SIZE;
      if (attachment.size > maxSize) {
        await interaction.reply({
          content: `That file is too large (max ${maxSize / (1024 * 1024)} MB for this kind of file).`,
          ephemeral: true,
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

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [...history, { role: "user", parts: userParts }],
        config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      });

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
        "An error occurred while talking to the model. Check the bot's console for more details."
      );
    }
  });
}
