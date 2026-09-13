import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
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
  intents: [GatewayIntentBits.Guilds],
});

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

client.login(process.env.DISCORD_TOKEN);
