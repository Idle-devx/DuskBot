import { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from "discord.js";
import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { registerTicketHandlers } from "./tickets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

registerTicketHandlers(client);

// "Meme"-style phrases for public moderation announcements.
// Change them here if you want different text — {target} and {executor}
// get automatically replaced with the corresponding mentions.
const MOD_PHRASES = {
  ban: "{target} was sent to Ban Island by {executor} 🔨",
  kick: "{target} got kicked out by {executor} 👢",
  softban: "{target} was softbanned by {executor} 🧹",
  mute: "{target} was silenced by {executor} 🔇",
  unmute: "{target} got their voice back thanks to {executor} 🔊",
  unban: "{target} was freed from Ban Island by {executor} 🕊️",
};

function formatModPhrase(command, target, executor) {
  return MOD_PHRASES[command]
    .replace("{target}", `<@${target.id}>`)
    .replace("{executor}", `<@${executor.id}>`);
}

// Direct message (DM) notices to the affected user, styled as an embed
// (card with color, title, and fields). Change the title, color, or emoji
// here if you want a different style.
const DM_EMBED_CONFIG = {
  ban: { emoji: "🔨", title: "🔨 You were banned", channelAction: "was banned", color: 0xed4245 },
  kick: { emoji: "👢", title: "👢 You were kicked", channelAction: "was kicked", color: 0xfaa61a },
  softban: { emoji: "🧹", title: "🧹 You were softbanned", channelAction: "was softbanned", color: 0x9b59b6 },
  mute: { emoji: "🔇", title: "🔇 You were muted", channelAction: "was muted", color: 0xfee75c },
  unban: { emoji: "🔓", title: "🔓 You were unbanned", channelAction: "was unbanned", color: 0x57f287 },
};

// Short label for the channel embed's title (Discord titles don't render
// @mentions, so the affected user goes in the description instead).
const COMMAND_LABELS = {
  ban: "Ban",
  kick: "Kick",
  softban: "Softban",
  mute: "Mute",
  unban: "Unban",
};

// Generic builder used by both the DM card and the channel card.
// title and description are decided by each specific function below.
function buildEmbedBase(command, reason, executor, extra, title, description, thumbnailUrl) {
  const config = DM_EMBED_CONFIG[command];

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Reason", value: reason || "No reason specified" },
      { name: "Action taken by", value: `<@${executor.id}>`, inline: true }
    )
    .setTimestamp();

  if (extra.duration) {
    embed.addFields({ name: "Duration", value: `${extra.duration} minutes`, inline: true });
  }

  if (extra.note) {
    embed.addFields({ name: "Note", value: extra.note });
  }

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  return embed;
}

// DM card: generic title ("You were banned"), server icon.
function buildModEmbed(command, guild, reason, executor, extra = {}) {
  const config = DM_EMBED_CONFIG[command];
  return buildEmbedBase(
    command,
    reason,
    executor,
    extra,
    config.title,
    `In **${guild.name}**`,
    guild.iconURL()
  );
}

// Card for the channel where the command was run: short title ("🧹 Softban")
// and the description mentions the affected user (e.g. "@user was banned"),
// with their avatar instead of the server icon.
function buildChannelModEmbed(command, targetUser, guild, reason, executor, extra = {}) {
  const config = DM_EMBED_CONFIG[command];
  const title = `${config.emoji} ${COMMAND_LABELS[command]}`;
  const description = `<@${targetUser.id}> ${config.channelAction}`;
  return buildEmbedBase(
    command,
    reason,
    executor,
    extra,
    title,
    description,
    targetUser.displayAvatarURL({ size: 256 })
  );
}

async function notifyUserByDM(command, targetUser, guild, reason, executor, extra = {}) {
  const embed = buildModEmbed(command, guild, reason, executor, extra);

  try {
    await targetUser.send({ embeds: [embed] });
  } catch (error) {
    // The user may have DMs closed or not share a server; not a critical
    // error, they just couldn't be notified.
    console.log(`Could not DM ${targetUser.tag}: ${error.message}`);
  }
}

// --- Per-project code storage ---

// Name of the role allowed to use /code. Adjust it if it's named differently on your server.
const SCRIPTER_ROLE_NAME = "Scripter";

const CODE_DIR = join(__dirname, "codigos");
if (!existsSync(CODE_DIR)) {
  await mkdir(CODE_DIR, { recursive: true });
}

// Only Admins/Mods can save (already enforced by Discord via
// setDefaultMemberPermissions in deploy-commands.js, but re-validated here
// in case a server admin grants the permission to someone else later).
function canSaveCode(member) {
  return (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

// Anyone with the Scripter role, or who can already save (Admins/Mods), can retrieve code.
function canRetrieveCode(member) {
  return (
    member.roles.cache.some((role) => role.name === SCRIPTER_ROLE_NAME) ||
    canSaveCode(member)
  );
}

// Returns the list of subfolders (projects) that exist in CODE_DIR.
async function listProjects() {
  const entries = await readdir(CODE_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// Returns the list of files (without extension) inside a project.
async function listFiles(project) {
  const projectDir = join(CODE_DIR, project);
  if (!existsSync(projectDir)) return [];
  const entries = await readdir(projectDir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name.replace(/\.txt$/, ""));
}

// Sanitizes project/file names so they can't be used to escape CODE_DIR
// (e.g. "../../etc") or include odd path characters.
function sanitizeName(name) {
  return name.replace(/[\\/]/g, "-").replace(/\.\./g, "-").trim();
}

// Simple per-channel memory: keeps the last few turns to give responses
// continuity. Lost if the bot restarts (not persistent).
const MAX_TURNS_PER_CHANNEL = 10;
const conversations = new Map(); // channelId -> [{role, content}, ...]

function getHistory(channelId) {
  if (!conversations.has(channelId)) {
    conversations.set(channelId, []);
  }
  return conversations.get(channelId);
}

function pushToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  // Keep only the last N turns so it doesn't grow indefinitely
  while (history.length > MAX_TURNS_PER_CHANNEL * 2) {
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

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "ask") return;

  const userMessage = interaction.options.getString("message");
  const channelId = interaction.channelId;

  // Let Discord know we're processing (the model can take a few seconds)
  await interaction.deferReply();

  try {
    const history = getHistory(channelId);

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      max_tokens: 1024,
      messages: [...history, { role: "user", content: userMessage }],
    });

    const replyText = response.choices[0].message.content.trim();

    pushToHistory(channelId, "user", userMessage);
    pushToHistory(channelId, "assistant", replyText);

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

// Maximum input file size we accept downloading (25 MB)
const MAX_INPUT_SIZE = 25 * 1024 * 1024;

async function convertToGif(inputPath, outputPath, { duration, width, isStaticImage }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);

    // Static images need "-loop 1" so ffmpeg treats them as a continuous
    // video; without this, the conversion fails or produces an empty file.
    // Videos and animated GIFs don't need it.
    if (isStaticImage) {
      command.inputOptions(["-loop 1"]);
    }

    command
      .setStartTime(0)
      .duration(duration)
      .outputOptions([`-vf scale=${width}:-1:flags=lanczos,fps=12`])
      .toFormat("gif")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "gif") return;

  const attachment = interaction.options.getAttachment("file", true);
  const duration = interaction.options.getNumber("duration") ?? 5;
  const width = interaction.options.getInteger("width") ?? 320;

  if (attachment.size > MAX_INPUT_SIZE) {
    await interaction.reply({
      content: "The file is too large (25 MB max).",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let tempDir;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "gifbot-"));
    const extension = attachment.name.split(".").pop() || "input";
    const inputPath = join(tempDir, `input.${extension}`);
    const outputPath = join(tempDir, "output.gif");

    const response = await fetch(attachment.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Animated GIFs and videos are already "continuous", they don't need
    // -loop 1; only static images (png, jpg, webp, etc.) need it.
    const isStaticImage =
      (attachment.contentType?.startsWith("image/") ?? false) &&
      attachment.contentType !== "image/gif";

    await convertToGif(inputPath, outputPath, { duration, width, isStaticImage });

    const gifAttachment = new AttachmentBuilder(outputPath, { name: "result.gif" });
    await interaction.editReply({ files: [gifAttachment] });
  } catch (error) {
    console.error("Error converting to GIF:", error);
    await interaction.editReply(
      "An error occurred converting the file. Make sure it's a valid video or image."
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// --- Moderation ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const moderationCommands = ["ban", "kick", "softban", "mute", "unmute", "unban"];
  if (!moderationCommands.includes(interaction.commandName)) return;

  const reason = interaction.options.getString("reason") ?? "No reason specified";

  // /unban is different: there's no "in-server" user to select, so it's
  // handled separately using the ID typed by whoever runs the command.
  if (interaction.commandName === "unban") {
    const userId = interaction.options.getString("user_id", true);
    try {
      const bannedUser = await interaction.client.users.fetch(userId);
      await interaction.guild.members.unban(userId, reason);
      await notifyUserByDM("unban", bannedUser, interaction.guild, reason, interaction.user);
      const channelEmbed = buildChannelModEmbed(
        "unban",
        bannedUser,
        interaction.guild,
        reason,
        interaction.user
      );
      await interaction.reply({ embeds: [channelEmbed] });
    } catch (error) {
      console.error("Error running /unban:", error);
      await interaction.reply({
        content: "Couldn't unban that user. Check that the ID is correct and that they're banned.",
        ephemeral: true,
      });
    }
    return;
  }

  const targetUser = interaction.options.getUser("user", true);

  try {
    if (interaction.commandName === "ban") {
      const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
      await notifyUserByDM("ban", targetUser, interaction.guild, reason, interaction.user);
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason,
      });
      const channelEmbed = buildChannelModEmbed(
        "ban",
        targetUser,
        interaction.guild,
        reason,
        interaction.user
      );
      await interaction.reply({ embeds: [channelEmbed] });
    }

    if (interaction.commandName === "kick") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await notifyUserByDM("kick", targetUser, interaction.guild, reason, interaction.user);
      await member.kick(reason);
      const channelEmbed = buildChannelModEmbed(
        "kick",
        targetUser,
        interaction.guild,
        reason,
        interaction.user
      );
      await interaction.reply({ embeds: [channelEmbed] });
    }

    if (interaction.commandName === "softban") {
      // Softban already wipes the user's recent messages since it bans them
      // (with deleteMessageSeconds) and immediately unbans them.
      const deleteDays = interaction.options.getInteger("delete_days") ?? 1;
      await notifyUserByDM("softban", targetUser, interaction.guild, reason, interaction.user);
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason: `Softban: ${reason}`,
      });
      await interaction.guild.members.unban(targetUser.id, "Softban - automatic unban");
      const channelEmbed = buildChannelModEmbed(
        "softban",
        targetUser,
        interaction.guild,
        reason,
        interaction.user,
        { note: "Recent messages were wiped, they can rejoin." }
      );
      await interaction.reply({ embeds: [channelEmbed] });
    }

    if (interaction.commandName === "mute") {
      const minutes = interaction.options.getInteger("minutes", true);
      const member = await interaction.guild.members.fetch(targetUser.id);
      await notifyUserByDM("mute", targetUser, interaction.guild, reason, interaction.user, {
        duration: minutes,
      });
      await member.timeout(minutes * 60 * 1000, reason);
      const channelEmbed = buildChannelModEmbed(
        "mute",
        targetUser,
        interaction.guild,
        reason,
        interaction.user,
        { duration: minutes }
      );
      await interaction.reply({ embeds: [channelEmbed] });
    }

    if (interaction.commandName === "unmute") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(null, reason);
      await interaction.reply(formatModPhrase("unmute", targetUser, interaction.user));
    }
  } catch (error) {
    console.error(`Error running /${interaction.commandName}:`, error);
    const message =
      error.code === 50013
        ? "I don't have enough permissions to do that (check that my role is above the target user)."
        : "An error occurred running the command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

// --- Forum posts ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "forum") return;

  const channel = interaction.options.getChannel("channel", true);
  const title = interaction.options.getString("title", true);
  const content = interaction.options.getString("content", true);
  const images = [
    interaction.options.getAttachment("image1"),
    interaction.options.getAttachment("image2"),
    interaction.options.getAttachment("image3"),
  ].filter(Boolean);

  await interaction.deferReply({ ephemeral: true });

  if (channel.type !== ChannelType.GuildForum) {
    await interaction.editReply("The selected channel isn't a forum channel.");
    return;
  }

  try {
    const thread = await channel.threads.create({
      name: title,
      message: {
        content: content,
        files: images.map((attachment) => attachment.url),
      },
    });

    await interaction.editReply(`✅ Post created: ${thread.url}`);
  } catch (error) {
    console.error("Error creating forum post:", error);
    const message =
      error.code === 50013
        ? "I don't have enough permissions to post there (check that I can create threads and send messages in that forum)."
        : "An error occurred creating the post. If the forum requires mandatory tags, this command doesn't support those yet.";
    await interaction.editReply(message);
  }
});

// --- Autocomplete for /save-code and /code ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isAutocomplete()) return;
  if (!["save-code", "code"].includes(interaction.commandName)) return;

  const focused = interaction.options.getFocused(true);

  try {
    let options = [];

    if (focused.name === "project") {
      const projects = await listProjects();
      options = projects.filter((p) => p.startsWith(focused.value)).slice(0, 25);
    }

    if (focused.name === "name" && interaction.commandName === "code") {
      const project = interaction.options.getString("project") ?? "";
      const files = await listFiles(project);
      options = files.filter((a) => a.startsWith(focused.value)).slice(0, 25);
    }

    await interaction.respond(options.map((value) => ({ name: value, value })));
  } catch (error) {
    console.error("Error in code autocomplete:", error);
    await interaction.respond([]);
  }
});

// --- Save and retrieve code ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "save-code") return;

  if (!canSaveCode(interaction.member)) {
    await interaction.reply({ content: "You don't have permission to save code.", ephemeral: true });
    return;
  }

  const project = sanitizeName(interaction.options.getString("project", true));
  const name = sanitizeName(interaction.options.getString("name", true));
  const file = interaction.options.getAttachment("file");
  const content = interaction.options.getString("content");

  if (!file && !content) {
    await interaction.reply({
      content: "You must attach a file or write content in the `content` option.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const projectDir = join(CODE_DIR, project);
    await mkdir(projectDir, { recursive: true });

    const filePath = join(projectDir, `${name}.txt`);

    if (file) {
      const response = await fetch(file.url);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
    } else {
      await writeFile(filePath, content, "utf-8");
    }

    await interaction.editReply(`✅ Saved as \`${project}/${name}\`.`);
  } catch (error) {
    console.error("Error saving code:", error);
    await interaction.editReply("An error occurred saving the file.");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "code") return;

  if (!canRetrieveCode(interaction.member)) {
    await interaction.reply({
      content: `You don't have permission to use this command (requires the "${SCRIPTER_ROLE_NAME}" role).`,
      ephemeral: true,
    });
    return;
  }

  const project = sanitizeName(interaction.options.getString("project", true));
  const name = sanitizeName(interaction.options.getString("name", true));
  const filePath = join(CODE_DIR, project, `${name}.txt`);

  if (!existsSync(filePath)) {
    await interaction.reply({
      content: `Couldn't find anything saved as \`${project}/${name}\`.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ files: [new AttachmentBuilder(filePath, { name: `${name}.txt` })] });
});

// --- Random GIF replies ---

const GIF_CATEGORIES = ["tsundere", "cats", "dogs", "seals"];

async function getRandomGif() {
  const category = GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];

  const url = `https://api.giphy.com/v1/gifs/random?api_key=${process.env.GIPHY_API_KEY}&tag=${encodeURIComponent(
    category
  )}&rating=pg-13`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Giphy responded with status ${response.status}`);

  const data = await response.json();
  return data.data?.images?.original?.url ?? null;
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.reference) return;

  try {
    const referenced = await message.fetchReference();
    if (referenced.author.id !== client.user.id) return;

    const gifUrl = await getRandomGif();
    if (gifUrl) {
      await message.reply(gifUrl);
    }
  } catch (error) {
    console.error("Error replying with GIF:", error);
  }
});

client.login(process.env.DISCORD_TOKEN);
