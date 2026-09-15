// Borra TODOS los comandos registrados a nivel de servidor (guild) para
// el DISCORD_GUILD_ID en tu .env. No afecta los comandos globales.
// Útil para limpiar duplicados cuando un comando quedó registrado tanto
// global como localmente.
//
// Uso: node scripts/clear-guild-commands.js

import { REST, Routes } from "discord.js";
import "dotenv/config";

if (!process.env.DISCORD_GUILD_ID) {
  console.error("Falta DISCORD_GUILD_ID en tu .env.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`Borrando comandos de servidor para el guild ${process.env.DISCORD_GUILD_ID}...`);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: [] }
  );

  console.log("¡Listo! Los comandos de servidor fueron borrados. Los globales siguen intactos.");
} catch (error) {
  console.error("Error borrando comandos de servidor:", error);
  process.exitCode = 1;
}
