// Registers the bot's slash commands only on YOUR test server (guild),
// using DISCORD_GUILD_ID from .env. Unlike the global version, this updates
// almost instantly — perfect for testing changes before/instead of waiting
// up to 1 hour for the global rollout.
import { REST, Routes } from "discord.js";
import { allCommands } from "../src/commands/definitions.js";
import "dotenv/config";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log(
    `Registering slash commands on test server ${process.env.DISCORD_GUILD_ID} (instant)...`
  );

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: allCommands }
  );

  console.log("Commands registered successfully on the test server!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
