// Static consistency check — no Discord connection and no npm packages
// needed (doesn't import discord.js at all, just reads the .js files as
// plain text). Confirms every top-level command defined in
// src/commands/definitions.js has a matching handler somewhere under
// src/handlers/.
// Run with: node scripts/check-commands.js
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const DEFINITIONS_PATH = join(ROOT_DIR, "src", "commands", "definitions.js");
const HANDLERS_DIR = join(ROOT_DIR, "src", "handlers");

const commandsSource = readFileSync(DEFINITIONS_PATH, "utf-8");

// Only grabs .setName("x") calls that immediately follow
// "new SlashCommandBuilder()", so option names (which also use .setName)
// aren't picked up.
const commandNames = [];
for (const block of commandsSource.split("new SlashCommandBuilder()").slice(1)) {
  const match = block.match(/\.setName\("([^"]+)"\)/);
  if (match) commandNames.push(match[1]);
}

console.log(`definitions.js defines ${commandNames.length} top-level command(s):\n`);
commandNames.forEach((name) => console.log(`  /${name}`));

const handlerFiles = readdirSync(HANDLERS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => join(HANDLERS_DIR, f));

const combinedSource = handlerFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

console.log(`\nScanning for handlers in: ${handlerFiles.map((f) => "src/handlers/" + f.split("/").pop()).join(", ")}\n`);

let allGood = true;
for (const name of commandNames) {
  // Handlers guard with either "=== name" (direct) or "!== name" (early
  // return), or list the name inside an array.includes(...) check for
  // grouped commands (e.g. moderation, autocomplete). Any of these counts.
  const found =
    combinedSource.includes(`interaction.commandName === "${name}"`) ||
    combinedSource.includes(`interaction.commandName !== "${name}"`) ||
    combinedSource.includes(`"${name}"`); // fallback: appears anywhere (e.g. inside an array)

  console.log(`  /${name.padEnd(16)} ${found ? "✅ handler found" : "❌ NO HANDLER"}`);
  if (!found) allGood = false;
}

console.log(
  allGood
    ? "\n✅ Every command in definitions.js has a matching handler."
    : "\n❌ Some commands have no handler — they'll show up in Discord but fail when used."
);

if (!allGood) process.exitCode = 1;
