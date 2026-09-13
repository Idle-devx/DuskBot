// Este script registra el comando /pregunta en tu servidor de Discord.
// Solo necesitas correrlo una vez (o cada vez que cambies la definición del comando).
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import "dotenv/config";

const commands = [
  new SlashCommandBuilder()
    .setName("pregunta")
    .setDescription("Hazle una pregunta a Claude")
    .addStringOption((option) =>
      option
        .setName("mensaje")
        .setDescription("Lo que quieres preguntarle a Claude")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("gif")
    .setDescription("Convierte un video o imagen adjunta a GIF")
    .addAttachmentOption((option) =>
      option
        .setName("archivo")
        .setDescription("El video o imagen que quieres convertir")
        .setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("duracion")
        .setDescription("Segundos a convertir desde el inicio (default: 5, máximo: 15)")
        .setMinValue(1)
        .setMaxValue(15)
    )
    .addIntegerOption((option) =>
      option
        .setName("ancho")
        .setDescription("Ancho en píxeles del GIF (default: 320)")
        .setMinValue(64)
        .setMaxValue(720)
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registrando comandos slash...");

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  console.log("¡Comandos registrados con éxito!");
} catch (error) {
  console.error(error);
}
