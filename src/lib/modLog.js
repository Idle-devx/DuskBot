// Shared mod-log sender: posts a styled embed to whatever channel a guild
// configured via /modlogs-setup. Used by both moderation.js (ban/kick/
// softban/mute/unmute/unban) and warnings.js (warn), so every one of these
// actions ends up in the same audit-log channel regardless of which handler
// file it's implemented in.
//
// This used to live inline in moderation.js. It moved here once warnings.js
// needed to send to the same log channel too — otherwise either warnings.js
// would duplicate this file-reading logic, or moderation.js would have to
// export it awkwardly to a module that isn't "about" moderation.js's own
// commands.
import { join } from "node:path";
import { DATA_DIR } from "./constants.js";
import { getGuildValue, setGuildValue } from "./jsonStore.js";
import { buildLogEmbed, LOG_ANNOUNCE } from "./embeds.js";

const MODLOG_CONFIG_PATH = join(DATA_DIR, "modlogs-config.json");

export async function getModLogConfig(guildId) {
  return getGuildValue(MODLOG_CONFIG_PATH, guildId, null);
}

export async function setModLogConfig(guildId, partial) {
  return setGuildValue(MODLOG_CONFIG_PATH, guildId, partial);
}

// Sends the log embed to the guild's configured mod-log channel, if any.
// Silently does nothing if /modlogs-setup hasn't been run for this guild.
export async function sendModLog(command, targetUser, guild, reason, executor, extra = {}) {
  const logConfig = await getModLogConfig(guild.id);
  if (!logConfig?.logChannelId) return;

  const logChannel = await guild.channels.fetch(logConfig.logChannelId).catch(() => null);
  if (!logChannel) return;

  await logChannel
    .send({
      content: LOG_ANNOUNCE[command],
      embeds: [buildLogEmbed(command, targetUser, reason, executor, extra)],
    })
    .catch((error) => console.error("Error sending mod log:", error));
}
