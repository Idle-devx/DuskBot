// Per-server access configuration (set via /access-setup).
//
// Lets each server layer an extra allowed role on top of the usual Discord
// permissions for moderation, save-code/delete-code, and code, instead of
// being stuck with a fixed permission or the hardcoded "Scripter" name.
//
// Shared between the moderation handler (moderationRoleIds) and the code
// storage handler (saveCodeRoleIds, codeRoleIds) — both read and write the
// same access-config.json, hence living here rather than in either one.
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

// Extracts every role ID mentioned in a string like "@Mod @Helper" (as
// Discord sends it: "<@&123> <@&456>"). Returns an array, possibly empty.
export function parseRoleMentions(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/<@&(\d+)>/g)];
  return [...new Set(matches.map((m) => m[1]))];
}
