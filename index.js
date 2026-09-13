import { Client, GatewayIntentBits, AttachmentBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from "discord.js";
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

// Avisos por mensaje directo (DM) al usuario afectado, con formato de
// embed (tarjeta con color, título y campos). Cambia el título, color o
// emoji aquí si quieres otro estilo.
const DM_EMBED_CONFIG = {
  ban: { emoji: "🔨", title: "🔨 You were banned", channelAction: "was banned", color: 0xed4245 },
  kick: { emoji: "👢", title: "👢 You were kicked", channelAction: "was kicked", color: 0xfaa61a },
  softban: { emoji: "🧹", title: "🧹 You were softbanned", channelAction: "was softbanned", color: 0x9b59b6 },
  mute: { emoji: "🔇", title: "🔇 You were muted", channelAction: "was muted", color: 0xfee75c },
  unban: { emoji: "🔓", title: "🔓 You were unbanned", channelAction: "was unbanned", color: 0x57f287 },
};

// Etiqueta corta para el título del embed del canal (los títulos de Discord
// no renderizan @menciones, por eso el usuario afectado va en la descripción).
const COMMAND_LABELS = {
  ban: "Ban",
  kick: "Kick",
  softban: "Softban",
  mute: "Mute",
  unban: "Unban",
};

// Builder genérico usado tanto por el cartel de DM como por el del canal.
// title y description los decide cada función específica de más abajo.
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

// Cartel de DM: título genérico ("You were banned"), ícono del servidor.
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

// Cartel del canal donde se ejecutó el comando: título corto ("🧹 Softban")
// y la descripción menciona al usuario afectado (ej. "@usuario was banned"),
// con su avatar en vez del ícono del servidor.
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
    // El usuario puede tener los DMs cerrados o no compartir servidor;
    // no es un error crítico, simplemente no se le pudo avisar.
    console.log(`No se pudo enviar DM a ${targetUser.tag}: ${error.message}`);
  }
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

async function convertToGif(inputPath, outputPath, { duration, width, isStaticImage }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);

    // Las imágenes estáticas necesitan "-loop 1" para que ffmpeg las trate
    // como un video continuo; sin esto, la conversión falla o produce un
    // archivo vacío. Los videos y GIFs animados no lo necesitan.
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

    // GIFs animados y videos ya son "continuos", no necesitan -loop 1;
    // solo las imágenes estáticas (png, jpg, webp, etc.) sí lo necesitan.
    const isStaticImage =
      (attachment.contentType?.startsWith("image/") ?? false) &&
      attachment.contentType !== "image/gif";

    await convertToGif(inputPath, outputPath, { duration, width, isStaticImage });

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

  const moderationCommands = ["ban", "kick", "softban", "mute", "unmute", "unban"];
  if (!moderationCommands.includes(interaction.commandName)) return;

  const reason = interaction.options.getString("razon") ?? "Sin razón especificada";

  // /unban es distinto: no hay un usuario "en el servidor" que seleccionar,
  // así que se maneja aparte usando el ID que escribió quien ejecuta el comando.
  if (interaction.commandName === "unban") {
    const userId = interaction.options.getString("usuario_id", true);
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
      console.error("Error ejecutando /unban:", error);
      await interaction.reply({
        content: "No se pudo desbanear a ese usuario. Revisa que el ID sea correcto y que esté baneado.",
        ephemeral: true,
      });
    }
    return;
  }

  const targetUser = interaction.options.getUser("usuario", true);

  try {
    if (interaction.commandName === "ban") {
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 0;
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
      // El softban ya borra los mensajes recientes del usuario porque se banea
      // (con deleteMessageSeconds) y luego se desbanea de inmediato.
      const deleteDays = interaction.options.getInteger("dias_borrado") ?? 1;
      await notifyUserByDM("softban", targetUser, interaction.guild, reason, interaction.user);
      await interaction.guild.members.ban(targetUser.id, {
        deleteMessageSeconds: deleteDays * 86400,
        reason: `Softban: ${reason}`,
      });
      await interaction.guild.members.unban(targetUser.id, "Softban - desbaneo automático");
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
      const minutes = interaction.options.getInteger("minutos", true);
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

// --- Publicaciones en foro ---

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "foro") return;

  const canal = interaction.options.getChannel("canal", true);
  const titulo = interaction.options.getString("titulo", true);
  const contenido = interaction.options.getString("contenido", true);
  const imagenes = [
    interaction.options.getAttachment("imagen1"),
    interaction.options.getAttachment("imagen2"),
    interaction.options.getAttachment("imagen3"),
  ].filter(Boolean);

  await interaction.deferReply({ ephemeral: true });

  if (canal.type !== ChannelType.GuildForum) {
    await interaction.editReply("El canal seleccionado no es un canal de foro.");
    return;
  }

  try {
    const thread = await canal.threads.create({
      name: titulo,
      message: {
        content: contenido,
        files: imagenes.map((attachment) => attachment.url),
      },
    });

    await interaction.editReply(`✅ Publicación creada: ${thread.url}`);
  } catch (error) {
    console.error("Error creando publicación en el foro:", error);
    const message =
      error.code === 50013
        ? "No tengo permisos suficientes para publicar ahí (revisa que pueda crear hilos y enviar mensajes en ese foro)."
        : "Ocurrió un error al crear la publicación. Si el foro requiere etiquetas obligatorias, este comando aún no las soporta.";
    await interaction.editReply(message);
  }
});

// --- Respuesta con GIFs aleatorios ---

const GIF_CATEGORIES = ["tsundere", "cats", "dogs", "seals"];

async function getRandomGif() {
  const category = GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];

  const url = `https://api.giphy.com/v1/gifs/random?api_key=${process.env.GIPHY_API_KEY}&tag=${encodeURIComponent(
    category
  )}&rating=pg-13`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Giphy respondió con estado ${response.status}`);

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
    console.error("Error al responder con GIF:", error);
  }
});

client.login(process.env.DISCORD_TOKEN);
