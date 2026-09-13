import { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits } from "discord.js";
import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "dotenv/config";

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Frases estilo "meme" para los anuncios públicos de moderación.
// Cámbialas aquí si quieres otro texto — {target} y {executor} se
// reemplazan automáticamente por las menciones correspondientes.
const MOD_PHRASES = {
  ban: "{target} was sent to Ban Island by {executor} 🔨",
  kick: "{target} got kicked out by {executor} 👢",
  softban: "{target} was token logged by {executor} 🧹",
  mute: "{target} was silenced by {executor} 🔇",
  unmute: "{target} got their voice back thanks to {executor} 🔊",
};

function formatModPhrase(command, target, executor) {
  return MOD_PHRASES[command]
    .replace("{target}", `<@${target.id}>`)
    .replace("{executor}", `<@${executor.id}>`);
}

// Memoria simple por canal: guarda los últimos turnos para dar continuidad
// a la conversación. Se pierde si el bot se reinicia (no es persistente).
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
  // Mantenemos solo los últimos N turnos para no crecer sin límite
  while (history.length > MAX_TURNS_PER_CHANNEL * 2) {
    history.shift();
  }
}

// Discord limita los mensajes a 2000 caracteres, así que si Claude responde
// algo más largo, lo partimos en varios mensajes.
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
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "pregunta") return;

  const userMessage = interaction.options.getString("mensaje");
  const channelId = interaction.channelId;

  // Avisamos a Discord que estamos procesando (Claude puede tardar unos segundos)
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
    console.error("Error llamando a la API de Groq:", error);
    await interaction.editReply(
      "Ocurrió un error al hablar con el modelo. Revisa la consola del bot para más detalles."
    );
  }
});

// Tamaño máximo de archivo de entrada que aceptamos descargar (25 MB)
const MAX_INPUT_SIZE = 25 * 1024 * 1024;

async function convertToGif(inputPath, outputPath, { duration, width }) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(0)
      .duration(duration)
      .outputOptions([
        `-vf scale=${width}:-1:flags=lanczos,fps=12`,
      ])
      .toFormat("gif")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "gif") return;

  const attachment = interaction.options.getAttachment("archivo", true);
  const duration = interaction.options.getNumber("duracion") ?? 5;
  const width = interaction.options.getInteger("ancho") ?? 320;

  if (attachment.size > MAX_INPUT_SIZE) {
    await interaction.reply({
      content: "El archivo es demasiado grande (máximo 25 MB).",
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

    await convertToGif(inputPath, outputPath, { duration, width });

    const gifAttachment = new AttachmentBuilder(outputPath, { name: "resultado.gif" });
    await interaction.editReply({ files: [gifAttachment] });
  } catch (error) {
    console.error("Error convirtiendo a GIF:", error);
    await interaction.editReply(
      "Ocurrió un error al convertir el archivo. Asegúrate de que sea un video o imagen válida."
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// --- Moderación ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const moderationCommands = ["ban", "kick", "softban", "mute", "unmute"];
  if (!moderationCommands.includes(interaction.commandName)) return;

  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon") ?? "Sin razón especificada";

  try {
    if (interaction.commandName === "ban") {
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 0;
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason,
      });
      await interaction.reply(
        `${formatModPhrase("ban", targetUser, interaction.user)}\nReason: ${reason}`
      );
    }

    if (interaction.commandName === "kick") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.kick(reason);
      await interaction.reply(
        `${formatModPhrase("kick", targetUser, interaction.user)}\nReason: ${reason}`
      );
    }

    if (interaction.commandName === "softban") {
      // El softban ya borra los mensajes recientes del usuario porque se banea
      // (con deleteMessageSeconds) y luego se desbanea de inmediato.
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 1;
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason: `Softban: ${reason}`,
      });
      await interaction.guild.members.unban(targetUser.id, "Softban - desbaneo automático");
      await interaction.reply(
        `${formatModPhrase("softban", targetUser, interaction.user)}\n(Recent messages were wiped, they can rejoin). Reason: ${reason}`
      );
    }

    if (interaction.commandName === "mute") {
      const minutes = interaction.options.getInteger("minutos", true);
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(minutes * 60 * 1000, reason);
      await interaction.reply(
        `${formatModPhrase("mute", targetUser, interaction.user)}\nDuration: ${minutes} minutes. Reason: ${reason}`
      );
    }

    if (interaction.commandName === "unmute") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(null, reason);
      await interaction.reply(formatModPhrase("unmute", targetUser, interaction.user));
    }
  } catch (error) {
    console.error(`Error ejecutando /${interaction.commandName}:`, error);
    const message =
      error.code === 50013
        ? "No tengo permisos suficientes para hacer eso (revisa que mi rol esté por encima del usuario objetivo)."
        : "Ocurrió un error al ejecutar el comando.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

// --- Respuesta con GIFs aleatorios ---

const GIF_CATEGORIES = ["tsundere", "cats", "dogs", "seals"];

async function getRandomGif() {
  const category = GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];

  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
    category
  )}&key=${process.env.TENOR_API_KEY}&limit=50&media_filter=gif&contentfilter=medium`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tenor respondió con estado ${response.status}`);

  const data = await response.json();
  if (!data.results || data.results.length === 0) return null;

  const randomResult = data.results[Math.floor(Math.random() * data.results.length)];
  return randomResult.media_formats.gif.url;
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
    console.error("Error al responder con GIF:", error);
  }
});

client.login(process.env.DISCORD_TOKEN);import { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits } from "discord.js";
import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "dotenv/config";

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Frases estilo "meme" para los anuncios públicos de moderación.
// Cámbialas aquí si quieres otro texto — {target} y {executor} se
// reemplazan automáticamente por las menciones correspondientes.
const MOD_PHRASES = {
  ban: "{target} was sent to Ban Island by {executor} 🔨",
  kick: "{target} got kicked out by {executor} 👢",
  softban: "{target} was token logged by {executor} 🧹",
  mute: "{target} was silenced by {executor} 🔇",
  unmute: "{target} got their voice back thanks to {executor} 🔊",
};

function formatModPhrase(command, target, executor) {
  return MOD_PHRASES[command]
    .replace("{target}", `<@${target.id}>`)
    .replace("{executor}", `<@${executor.id}>`);
}

// Memoria simple por canal: guarda los últimos turnos para dar continuidad
// a la conversación. Se pierde si el bot se reinicia (no es persistente).
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
  // Mantenemos solo los últimos N turnos para no crecer sin límite
  while (history.length > MAX_TURNS_PER_CHANNEL * 2) {
    history.shift();
  }
}

// Discord limita los mensajes a 2000 caracteres, así que si Claude responde
// algo más largo, lo partimos en varios mensajes.
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
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "pregunta") return;

  const userMessage = interaction.options.getString("mensaje");
  const channelId = interaction.channelId;

  // Avisamos a Discord que estamos procesando (Claude puede tardar unos segundos)
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
    console.error("Error llamando a la API de Groq:", error);
    await interaction.editReply(
      "Ocurrió un error al hablar con el modelo. Revisa la consola del bot para más detalles."
    );
  }
});

// Tamaño máximo de archivo de entrada que aceptamos descargar (25 MB)
const MAX_INPUT_SIZE = 25 * 1024 * 1024;

async function convertToGif(inputPath, outputPath, { duration, width }) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(0)
      .duration(duration)
      .outputOptions([
        `-vf scale=${width}:-1:flags=lanczos,fps=12`,
      ])
      .toFormat("gif")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "gif") return;

  const attachment = interaction.options.getAttachment("archivo", true);
  const duration = interaction.options.getNumber("duracion") ?? 5;
  const width = interaction.options.getInteger("ancho") ?? 320;

  if (attachment.size > MAX_INPUT_SIZE) {
    await interaction.reply({
      content: "El archivo es demasiado grande (máximo 25 MB).",
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

    await convertToGif(inputPath, outputPath, { duration, width });

    const gifAttachment = new AttachmentBuilder(outputPath, { name: "resultado.gif" });
    await interaction.editReply({ files: [gifAttachment] });
  } catch (error) {
    console.error("Error convirtiendo a GIF:", error);
    await interaction.editReply(
      "Ocurrió un error al convertir el archivo. Asegúrate de que sea un video o imagen válida."
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// --- Moderación ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const moderationCommands = ["ban", "kick", "softban", "mute", "unmute"];
  if (!moderationCommands.includes(interaction.commandName)) return;

  const targetUser = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("razon") ?? "Sin razón especificada";

  try {
    if (interaction.commandName === "ban") {
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 0;
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason,
      });
      await interaction.reply(
        `${formatModPhrase("ban", targetUser, interaction.user)}\nReason: ${reason}`
      );
    }

    if (interaction.commandName === "kick") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.kick(reason);
      await interaction.reply(
        `${formatModPhrase("kick", targetUser, interaction.user)}\nReason: ${reason}`
      );
    }

    if (interaction.commandName === "softban") {
      // El softban ya borra los mensajes recientes del usuario porque se banea
      // (con deleteMessageSeconds) y luego se desbanea de inmediato.
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 1;
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason: `Softban: ${reason}`,
      });
      await interaction.guild.members.unban(targetUser.id, "Softban - desbaneo automático");
      await interaction.reply(
        `${formatModPhrase("softban", targetUser, interaction.user)}\n(Recent messages were wiped, they can rejoin). Reason: ${reason}`
      );
    }

    if (interaction.commandName === "mute") {
      const minutes = interaction.options.getInteger("minutos", true);
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(minutes * 60 * 1000, reason);
      await interaction.reply(
        `${formatModPhrase("mute", targetUser, interaction.user)}\nDuration: ${minutes} minutes. Reason: ${reason}`
      );
    }

    if (interaction.commandName === "unmute") {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(null, reason);
      await interaction.reply(formatModPhrase("unmute", targetUser, interaction.user));
    }
  } catch (error) {
    console.error(`Error ejecutando /${interaction.commandName}:`, error);
    const message =
      error.code === 50013
        ? "No tengo permisos suficientes para hacer eso (revisa que mi rol esté por encima del usuario objetivo)."
        : "Ocurrió un error al ejecutar el comando.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

// --- Respuesta con GIFs aleatorios ---

const GIF_CATEGORIES = ["tsundere", "cats", "dogs", "seals"];

async function getRandomGif() {
  const category = GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];

  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
    category
  )}&key=${process.env.TENOR_API_KEY}&limit=50&media_filter=gif&contentfilter=medium`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tenor respondió con estado ${response.status}`);

  const data = await response.json();
  if (!data.results || data.results.length === 0) return null;

  const randomResult = data.results[Math.floor(Math.random() * data.results.length)];
  return randomResult.media_formats.gif.url;
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
    console.error("Error al responder con GIF:", error);
  }
});

client.login(process.env.DISCORD_TOKEN);
