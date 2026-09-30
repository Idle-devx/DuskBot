// Per-server access configuration (set via /access-setup).
//
// Lets each server layer an extra allowed role on top of the usual Discord
// permissions for moderation, save-code/delete-code, and code, instead of
// being stuck with a fixed permission or the hardcoded "Scripter" name.
//
// Shared between the moderation handler (moderationRoleIds) and the code
// storage handler (saveCodeRoleIds, codeRoleIds) — both read and write the
// same access-config.json, hence living here rather than in either one.
import { PermissionFlagsBits } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "./constants.js";
import { getGuildValue, setGuildValue } from "./jsonStore.js";

const ACCESS_CONFIG_PATH = join(DATA_DIR, "access-config.json");

export async function getAccessConfig(guildId) {
  return getGuildValue(ACCESS_CONFIG_PATH, guildId, {});
}

export async function setAccessConfig(guildId, partial) {
  return setGuildValue(ACCESS_CONFIG_PATH, guildId, partial);
}

// True if `member` is an Administrator, has `nativePermission` (when given),
// or holds one of this guild's configured moderationRoleIds (/access-setup).
// This is the one access rule shared by every "moderation-flavored" command
// — ban/kick/softban/mute/unmute/unban (moderation.js), warn/warnings/
// clearwarnings (warnings.js), and purge (moderation.js) — so it lives here
// once instead of being copy-pasted into each handler.
export async function hasModerationAccess(member, nativePermission) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (nativePermission && member.permissions.has(nativePermission)) return true;
  const config = await getAccessConfig(member.guild.id);
  return (config.moderationRoleIds ?? []).some((id) => member.roles.cache.has(id));
}

// Extracts every role ID mentioned in a string like "@Mod @Helper" (as
// Discord sends it: "<@&123> <@&456>"). Returns an array, possibly empty.
export function parseRoleMentions(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/<@&(\d+)>/g)];
  return [...new Set(matches.map((m) => m[1]))];
}
