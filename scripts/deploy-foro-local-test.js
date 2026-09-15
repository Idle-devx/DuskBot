// Script TEMPORAL de prueba: registra solo /foro en un servidor específico
// (guild command), que se propaga al instante, a diferencia de los comandos
// globales que pueden tardar hasta 1 hora. Úsalo para confirmar que /foro
// funciona correctamente antes de esperar la propagación global.
//
// Requiere que DISCORD_GUILD_ID esté en tu .env con el ID de tu servidor.
//
// Uso: node scripts/deploy-foro-local-test.js
// Una vez confirmado que funciona, corre scripts/clear-guild-commands.js
// para borrar este registro local (el comando ya vive globalmente vía
// scripts/deploy-commands.js una vez que hagas push).

import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import "dotenv/config";

if (!process.env.DISCORD_GUILD_ID) {
  console.error(
    "Falta DISCORD_GUILD_ID en tu .env. Agrégalo con el ID de tu servidor (clic derecho en el ícono del servidor > Copiar ID, requiere Modo Desarrollador activado)."
  );
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("foro")
    .setDescription("Crea una publicación en un canal de foro")
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de foro donde se creará la publicación")
        .addChannelTypes(ChannelType.GuildForum)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("titulo")
        .setDescription("Título de la publicación")
        .setMaxLength(100)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("contenido")
        .setDescription("Texto de la publicación (máximo 2000 caracteres)")
        .setMaxLength(2000)
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("imagen1").setDescription("Imagen opcional para la publicación")
    )
    .addAttachmentOption((option) =>
      option.setName("imagen2").setDescription("Otra imagen opcional")
    )
    .addAttachmentOption((option) =>
      option.setName("imagen3").setDescription("Otra imagen opcional")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log(
    `Registrando /foro SOLO en el servidor ${process.env.DISCORD_GUILD_ID} (propagación instantánea)...`
  );

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  console.log("¡/foro registrado con éxito en el servidor! Ya debería aparecer de inmediato.");
} catch (error) {
  console.error("Error registrando el comando localmente:", error);
  process.exitCode = 1;
}
