// Static consistency check — no Discord connection and no npm packages
// needed (doesn't import discord.js at all, just reads the .js files as
// plain text). Confirms every top-level command defined in commands.js has
// a matching handler somewhere in index.js / verify.js / tickets.js.
// Run with: node check-commands.js
import { readFileSync, existsSync } from "node:fs";

const commandsSource = readFileSync("./commands.js", "utf-8");

// Only grabs .setName("x") calls that immediately follow
// "new SlashCommandBuilder()", so option names (which also use .setName)
// aren't picked up.
const commandNames = [];
for (const block of commandsSource.split("new SlashCommandBuilder()").slice(1)) {
  const match = block.match(/\.setName\("([^"]+)"\)/);
  if (match) commandNames.push(match[1]);
}

console.log(`commands.js defines ${commandNames.length} top-level command(s):\n`);
commandNames.forEach((name) => console.log(`  /${name}`));

const filesToScan = ["index.js", "verify.js", "tickets.js"].filter(existsSync);
const combinedSource = filesToScan.map((f) => readFileSync(f, "utf-8")).join("\n");

console.log(`\nScanning for handlers in: ${filesToScan.join(", ")}\n`);

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

if (!filesToScan.includes("tickets.js")) {
  console.log(
    "\nNote: tickets.js wasn't found next to this script, so /ticket-setup couldn't be checked here — verify it separately."
  );
}

console.log(
  allGood
    ? "\n✅ Every command in commands.js has a matching handler."
    : "\n❌ Some commands have no handler — they'll show up in Discord but fail when used."
);
