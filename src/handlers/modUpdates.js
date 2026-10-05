// Mod update announcements: an admin gives the bot a list of Nexus Mods
// pages to watch and a channel to post in. Every few minutes the bot asks
// Nexus for each mod's current version, and when one changes it posts an
// announcement with that version's changelog.
//
// Needs NEXUS_API_KEY in .env (a personal API key from
// https://www.nexusmods.com/users/myaccount?tab=api+access). Without it the
// commands explain what is missing and the background check stays off.
import { ChannelType, EmbedBuilder, Events, MessageFlags } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { getGuildValue, setGuildValue, updateJSON, readJSON } from "../lib/jsonStore.js";

const CONFIG_PATH = join(DATA_DIR, "modupdates-config.json");

const API_BASE = "https://api.nexusmods.com/v1";

// A personal Nexus key allows 2,500 requests a day and then 100 an hour.
// One request per watched mod per check keeps a dozen mods far below that.
const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 30 * 1000;
const MAX_MODS_PER_GUILD = 25;

const COMMANDS = [
  "modupdates-setup",
  "modupdates-add",
  "modupdates-remove",
  "modupdates-list",
  "modupdates-check",
];

// Accepts the address as copied from the browser, with or without a tab or
// query on the end:
//   https://www.nexusmods.com/tcgcardshopsimulator/mods/577
//   https://www.nexusmods.com/games/peak/mods/12?tab=files
// Returns null for anything that is not a Nexus mod page.
export function parseModUrl(text) {
  const match = String(text ?? "")
    .trim()
    .match(/nexusmods\.com\/(?:games\/)?([a-z0-9_-]+)\/mods\/(\d+)/i);
  if (!match) return null;
  const domain = match[1].toLowerCase();
  if (domain === "games") return null;
  return { domain, id: Number(match[2]), key: `${domain}/${match[2]}` };
}

export function modPageUrl(mod) {
  return `https://www.nexusmods.com/${mod.domain}/mods/${mod.id}`;
}

// Nexus hands back the changelog as { "1.1.0": ["line", "line"], ... }.
// The lines can carry HTML line breaks and entities from the page editor.
export function pickChangelog(changelogs, version) {
  const lines = changelogs?.[version];
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const text = lines
    .map((line) =>
      String(line)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .trim()
    )
    .filter(Boolean)
    .map((line) => (/^[-*•]/.test(line) ? line : `- ${line}`))
    .join("\n");
  if (!text) return null;
  // an embed description holds 4096 characters; leave room and cut on a line
  if (text.length <= 3500) return text;
  const cut = text.slice(0, 3500);
  return cut.slice(0, cut.lastIndexOf("\n")) + "\n…";
}

class NexusError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function nexusGet(path, apiKey) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { apikey: apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json())?.message ?? "";
    } catch {
      // not JSON; the status code is enough
    }
    throw new NexusError(response.status, detail || `Nexus answered ${response.status}`);
  }
  return response.json();
}

// The two calls the feature makes, in one place so the checker below can be
// run against stand-ins without touching the network.
export function createNexusClient(apiKey) {
  return {
    getMod: (mod) => nexusGet(`/games/${mod.domain}/mods/${mod.id}.json`, apiKey),
    getChangelogs: (mod) => nexusGet(`/games/${mod.domain}/mods/${mod.id}/changelogs.json`, apiKey),
  };
}

export function explainNexusError(error) {
  if (error?.status === 401) return "Nexus rejected the API key (NEXUS_API_KEY in .env is wrong or was revoked).";
  if (error?.status === 403) return "Nexus says that mod is hidden or not available.";
  if (error?.status === 404) return "Nexus has no mod at that address.";
  if (error?.status === 429) return "Nexus is rate-limiting the bot right now. Try again in a while.";
  return `Could not reach Nexus (${error?.message ?? "unknown error"}).`;
}

// Looks at every watched mod of one guild and returns what changed.
//
//   mods      the guild's saved list: { "<domain>/<id>": { domain, id, name, version } }
//   nexus     { getMod, getChangelogs }
//   cache     shared between guilds during one round, so a mod watched by
//             several servers is only asked for once
//
// Returns { updates, patches, stop }:
//   updates   announcements to post: { mod, previous, info, changelog }
//   patches   what to write back per mod key (new version, name, last error)
//   stop      true when Nexus said to slow down, so the caller ends the round
export async function findUpdates(mods, nexus, cache = new Map()) {
  const updates = [];
  const patches = {};
  let stop = false;

  for (const [key, mod] of Object.entries(mods ?? {})) {
    let info;
    try {
      if (!cache.has(key)) cache.set(key, await nexus.getMod(mod));
      info = cache.get(key);
    } catch (error) {
      patches[key] = { lastError: explainNexusError(error) };
      if (error?.status === 429 || error?.status === 401) {
        stop = true;
        break;
      }
      continue;
    }

    const version = String(info?.version ?? "").trim();
    const patch = { name: info?.name ?? mod.name, lastError: null };

    if (!version) {
      patches[key] = patch;
      continue;
    }

    // First sight of this mod: remember where it stands, announce nothing.
    if (!mod.version) {
      patches[key] = { ...patch, version };
      continue;
    }

    if (version !== mod.version) {
      let changelog = null;
      try {
        changelog = pickChangelog(await nexus.getChangelogs(mod), version);
      } catch (error) {
        // the announcement still goes out, just without the list of changes
        if (error?.status === 429) stop = true;
      }
      updates.push({ mod: { ...mod, name: patch.name }, previous: mod.version, info, changelog });
      patches[key] = { ...patch, version };
      if (stop) break;
      continue;
    }

    patches[key] = patch;
  }

  return { updates, patches, stop };
}

export function buildUpdateEmbed({ mod, previous, info, changelog }) {
  const summary = String(info?.summary ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

  const embed = new EmbedBuilder()
    .setColor(0xd98f40)
    .setTitle(`${mod.name ?? "Mod"} ${info.version}`.slice(0, 256))
    .setURL(modPageUrl(mod))
    .setDescription(changelog ?? (summary ? summary.slice(0, 3500) : "A new version is up."))
    .addFields({ name: "Version", value: `${previous} → **${info.version}**`, inline: true })
    .setTimestamp();

  if (changelog) embed.setAuthor({ name: "What's new" });
  if (info?.picture_url) embed.setThumbnail(info.picture_url);
  if (Number.isFinite(info?.mod_downloads)) {
    embed.addFields({ name: "Downloads", value: info.mod_downloads.toLocaleString("en-US"), inline: true });
  }
  embed.addFields({ name: "Get it", value: `[Nexus Mods page](${modPageUrl(mod)}?tab=files)`, inline: true });
  return embed;
}

async function savePatches(guildId, patches) {
  if (Object.keys(patches).length === 0) return;
  await updateJSON(CONFIG_PATH, (data) => {
    const mods = data[guildId]?.mods;
    if (!mods) return;
    for (const [key, patch] of Object.entries(patches)) {
      // the mod may have been removed while the check was running
      if (mods[key]) mods[key] = { ...mods[key], ...patch };
    }
  });
}

async function announce(client, guildId, config, update) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(config.channelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return false;

  const mention = config.roleId ? `<@&${config.roleId}> ` : "";
  await channel.send({
    content: `${mention}**${update.mod.name}** was updated to **${update.info.version}**.`,
    embeds: [buildUpdateEmbed(update)],
    allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] },
  });
  return true;
}

// One round for one guild. Returns how many announcements went out.
async function checkGuild(client, guildId, config, nexus, cache) {
  if (!config?.channelId || !config.mods || Object.keys(config.mods).length === 0) return { posted: 0, stop: false };

  const { updates, patches, stop } = await findUpdates(config.mods, nexus, cache);

  let posted = 0;
  for (const update of updates) {
    let sent = false;
    try {
      sent = await announce(client, guildId, config, update);
    } catch (error) {
      console.error("Error posting a mod update announcement:", error);
    }
    if (sent) {
      posted++;
    } else {
      // Channel gone, or the bot may not post there: keep the old version
      // on file so the announcement goes out once that is fixed.
      delete patches[`${update.mod.domain}/${update.mod.id}`];
    }
  }

  await savePatches(guildId, patches);
  return { posted, stop };
}

let roundRunning = false;

async function checkEveryGuild(client) {
  const apiKey = process.env.NEXUS_API_KEY;
  if (!apiKey || roundRunning) return;
  roundRunning = true;
  try {
    const all = await readJSON(CONFIG_PATH);
    const nexus = createNexusClient(apiKey);
    const cache = new Map();
    for (const [guildId, config] of Object.entries(all)) {
      const { stop } = await checkGuild(client, guildId, config, nexus, cache);
      if (stop) break;
    }
  } catch (error) {
    console.error("Error checking for mod updates:", error);
  } finally {
    roundRunning = false;
  }
}

function describeMod(mod) {
  const name = mod.name ?? `${mod.domain} #${mod.id}`;
  const version = mod.version ? ` — ${mod.version}` : "";
  const problem = mod.lastError ? `\n  ⚠️ ${mod.lastError}` : "";
  return `• [${name}](${modPageUrl(mod)})${version}${problem}`;
}

export function registerModUpdateHandlers(client) {
  client.once(Events.ClientReady, () => {
    if (!process.env.NEXUS_API_KEY) {
      console.log("Mod update announcements are off: NEXUS_API_KEY is not set.");
      return;
    }
    setTimeout(() => checkEveryGuild(client), FIRST_CHECK_AFTER_MS);
    setInterval(() => checkEveryGuild(client), CHECK_EVERY_MS);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!COMMANDS.includes(interaction.commandName)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    const apiKey = process.env.NEXUS_API_KEY;
    const noKey =
      "This needs a Nexus Mods API key. Whoever hosts the bot has to put `NEXUS_API_KEY=...` in its `.env` file and restart it. " +
      "The key is at the bottom of <https://www.nexusmods.com/users/myaccount?tab=api+access>.";

    try {
      if (interaction.commandName === "modupdates-setup") {
        if (interaction.options.getBoolean("disable")) {
          await setGuildValue(CONFIG_PATH, guildId, { channelId: null, roleId: null });
          await interaction.editReply("✅ Mod update announcements are off. The list of mods is kept; set a channel again to turn them back on.");
          return;
        }
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
          await interaction.editReply("`channel` is required to set this up (or pass `disable:true` to turn it off).");
          return;
        }
        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
          await interaction.editReply("Pick a text or announcement channel.");
          return;
        }
        const role = interaction.options.getRole("role");
        await setGuildValue(CONFIG_PATH, guildId, { channelId: channel.id, roleId: role?.id ?? null });
        await interaction.editReply(
          `✅ Mod updates will be posted in <#${channel.id}>` +
            (role ? `, pinging <@&${role.id}>` : "") +
            `. Add the mods to watch with \`/modupdates-add\`.` +
            (apiKey ? "" : `\n\n⚠️ ${noKey}`)
        );
        return;
      }

      if (interaction.commandName === "modupdates-add") {
        const parsed = parseModUrl(interaction.options.getString("url", true));
        if (!parsed) {
          await interaction.editReply("That doesn't look like a Nexus mod page. It should look like `https://www.nexusmods.com/<game>/mods/<number>`.");
          return;
        }
        if (!apiKey) {
          await interaction.editReply(noKey);
          return;
        }
        const config = await getGuildValue(CONFIG_PATH, guildId, {});
        if (config.mods?.[parsed.key]) {
          await interaction.editReply(`Already watching ${describeMod(config.mods[parsed.key]).slice(2)}.`);
          return;
        }
        if (Object.keys(config.mods ?? {}).length >= MAX_MODS_PER_GUILD) {
          await interaction.editReply(`This server already watches ${MAX_MODS_PER_GUILD} mods, which is the limit. Remove one first.`);
          return;
        }

        let info;
        try {
          info = await createNexusClient(apiKey).getMod(parsed);
        } catch (error) {
          await interaction.editReply(explainNexusError(error));
          return;
        }

        const mod = {
          domain: parsed.domain,
          id: parsed.id,
          name: info.name ?? `${parsed.domain} #${parsed.id}`,
          version: String(info.version ?? "").trim() || null,
          lastError: null,
        };
        await updateJSON(CONFIG_PATH, (data) => {
          data[guildId] = { ...(data[guildId] ?? {}) };
          data[guildId].mods = { ...(data[guildId].mods ?? {}), [parsed.key]: mod };
        });
        await interaction.editReply(
          `✅ Watching **${mod.name}** (currently ${mod.version ?? "no version listed"}). The next version that goes up will be announced` +
            (config.channelId ? ` in <#${config.channelId}>.` : ` once you pick a channel with \`/modupdates-setup\`.`)
        );
        return;
      }

      if (interaction.commandName === "modupdates-remove") {
        const wanted = interaction.options.getString("mod", true).trim();
        const parsed = parseModUrl(wanted);
        const removed = await updateJSON(CONFIG_PATH, (data) => {
          const mods = data[guildId]?.mods ?? {};
          const key = parsed
            ? parsed.key
            : Object.keys(mods).find((k) => (mods[k].name ?? "").toLowerCase().includes(wanted.toLowerCase()));
          if (!key || !mods[key]) return null;
          const gone = mods[key];
          delete mods[key];
          return gone;
        });
        await interaction.editReply(
          removed
            ? `✅ No longer watching **${removed.name}**.`
            : "No watched mod matches that. Use `/modupdates-list` to see the names, or paste the mod's address."
        );
        return;
      }

      if (interaction.commandName === "modupdates-list") {
        const config = await getGuildValue(CONFIG_PATH, guildId, {});
        const mods = Object.values(config.mods ?? {});
        const where = config.channelId
          ? `Announcements go to <#${config.channelId}>` + (config.roleId ? `, pinging <@&${config.roleId}>.` : ".")
          : "No channel is set yet — use `/modupdates-setup`.";
        const list = mods.length ? mods.map(describeMod).join("\n") : "No mods are being watched. Add one with `/modupdates-add`.";
        const warning = apiKey ? "" : `⚠️ ${noKey}\n\n`;
        await interaction.editReply({
          // Discord stops a message at 2000 characters
          content: `${warning}${where}\n\n${list}`.slice(0, 2000),
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (interaction.commandName === "modupdates-check") {
        if (!apiKey) {
          await interaction.editReply(noKey);
          return;
        }
        const config = await getGuildValue(CONFIG_PATH, guildId, {});
        if (!config.channelId) {
          await interaction.editReply("Pick a channel first with `/modupdates-setup`.");
          return;
        }
        if (Object.keys(config.mods ?? {}).length === 0) {
          await interaction.editReply("No mods are being watched. Add one with `/modupdates-add`.");
          return;
        }
        const { posted, stop } = await checkGuild(client, guildId, config, createNexusClient(apiKey), new Map());
        const after = await getGuildValue(CONFIG_PATH, guildId, {});
        const problems = Object.values(after.mods ?? {}).filter((m) => m.lastError);
        await interaction.editReply(
          (posted ? `✅ Posted ${posted} update${posted === 1 ? "" : "s"} in <#${config.channelId}>.` : "✅ Checked: nothing new.") +
            (stop ? "\n⚠️ Nexus asked the bot to slow down, so not every mod was checked." : "") +
            (problems.length ? `\n⚠️ ${problems.length} mod${problems.length === 1 ? "" : "s"} could not be checked — see \`/modupdates-list\`.` : "")
        );
        return;
      }
    } catch (error) {
      console.error(`Error handling /${interaction.commandName}:`, error);
      await interaction.editReply("Something went wrong. Check the bot's console for the details.").catch(() => {});
    }
  });
}
