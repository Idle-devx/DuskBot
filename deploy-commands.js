// Registers the bot's slash commands GLOBALLY (works on every server the
// bot is on, but can take up to 1 hour to propagate for new/renamed commands).
// For instant testing on a single server, use deploy-commands-dev.js instead.
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import "dotenv/config";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("Registering slash commands (global, can take up to 1 hour to propagate)...");

  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands }
  );

  console.log("Commands registered successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
