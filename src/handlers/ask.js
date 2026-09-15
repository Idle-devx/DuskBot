// /ask: sends the user's message to Groq and replies with the model's
// answer, splitting it into multiple messages if it's over Discord's 2000
// character limit.
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
const conversations = new Map(); // "channelId:userId" -> [{role, content}, ...]

function conversationKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

function getHistory(key) {
  if (!conversations.has(key)) {
    conversations.set(key, []);
  }
  return conversations.get(key);
}

function pushToHistory(key, role, content) {
  const history = getHistory(key);
  history.push({ role, content });
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
    const key = conversationKey(interaction.channelId, interaction.user.id);

    // Let Discord know we're processing (the model can take a few seconds)
    await interaction.deferReply();

    try {
      const history = getHistory(key);

      const response = await groq.chat.completions.create({
        model: "openai/gpt-oss-20b",
        max_tokens: 1024,
        messages: [...history, { role: "user", content: userMessage }],
      });

      const replyText = response.choices[0].message.content.trim();

      pushToHistory(key, "user", userMessage);
      pushToHistory(key, "assistant", replyText);

      const chunks = splitMessage(replyText);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    } catch (error) {
      console.error("Error calling the Groq API:", error);
      await interaction.editReply(
        "An error occurred while talking to the model. Check the bot's console for more details."
      );
    }
  });
}
