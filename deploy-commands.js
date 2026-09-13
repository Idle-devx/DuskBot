// Este script registra el comando /pregunta en tu servidor de Discord.
// Solo necesitas correrlo una vez (o cada vez que cambies la definición del comando).
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
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
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banea a un usuario del servidor")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario a banear").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón del baneo")
    )
    .addIntegerOption((option) =>
      option
        .setName("dias_borrado")
        .setDescription("Días de mensajes a borrar (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa a un usuario del servidor")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario a expulsar").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón de la expulsión")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Banea y desbanea de inmediato para borrar sus mensajes recientes")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario a softbanear").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón del softban")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Silencia (timeout) a un usuario por un tiempo determinado")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario a silenciar").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutos")
        .setDescription("Duración del silencio en minutos (máximo 40320 = 28 días)")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón del silencio")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Quita el silencio (timeout) a un usuario")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Usuario a des-silenciar").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Desbanea a un usuario usando su ID")
    .addStringOption((option) =>
      option
        .setName("usuario_id")
        .setDescription("ID numérico del usuario a desbanear")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón del desbaneo")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Desbanea a un usuario usando su ID")
    .addStringOption((option) =>
      option
        .setName("usuario_id")
        .setDescription("ID del usuario a desbanear")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("razon").setDescription("Razón del desbaneo")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registrando comandos slash (globales, pueden tardar hasta 1 hora en propagarse)...");

  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands }
  );

  console.log("¡Comandos registrados con éxito!");
} catch (error) {
  console.error(error);
}
