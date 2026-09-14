// Anti-raid lockdown: watches for a burst of joins within a short window.
// If the threshold is hit, it locks the server down (raises verification
// level + revokes all active invites), punishes whoever joined in that
// burst, logs everything, and automatically reverts the verification level
// after a configurable cooldown.
//
// Caveats worth knowing: this is a heuristic, not a guarantee. A "slow
// drip" raid that stays under your threshold won't trigger it, and a
// genuine viral growth spurt (e.g. your server gets shared somewhere) could
// false-positive into a lockdown. Tune join_threshold/time_window_seconds
// to your server's normal traffic.
import { EmbedBuilder, GuildVerificationLevel } from "discord.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "antiraid-config.json");

const DEFAULT_JOIN_THRESHOLD = 5;
const DEFAULT_TIME_WINDOW_SECONDS = 10;
const DEFAULT_ACTION = "kick";
const DEFAULT_LOCKDOWN_MINUTES = 10;

async function loadJSON(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

async function saveJSON(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

async function getConfig(guildId) {
  const all = await loadJSON(CONFIG_PATH);
  return all[guildId] ?? null;
}

async function setConfig(guildId, partial) {
  const all = await loadJSON(CONFIG_PATH);
  all[guildId] = { ...(all[guildId] ?? {}), ...partial };
  await saveJSON(CONFIG_PATH, all);
  return all[guildId];
}

// In-memory only (not persisted): recent join timestamps per guild, and
// whether a guild is currently locked down. Doesn't need to survive a
// restart — worst case, a raid mid-restart just isn't caught, same as if
// the bot were offline for any other reason.
const recentJoins = new Map(); // guildId -> [{ id, tag, ts }, ...]
const lockdownState = new Map(); // guildId -> { previousVerificationLevel, revertTimeout }

async function sendLog(guild, config, embed) {
  if (!config?.logChannelId) return;
  const logChannel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!logChannel) return;
  await logChannel.send({ embeds: [embed] }).catch((error) => {
    console.error("Error sending anti-raid log:", error);
  });
}

async function triggerLockdown(guild, config, raiders) {
  lockdownState.set(guild.id, { previousVerificationLevel: guild.verificationLevel });

  const lockdownMinutes = config.lockdownMinutes ?? DEFAULT_LOCKDOWN_MINUTES;
  const action = config.action ?? DEFAULT_ACTION;

  // Raise verification level (requires phone-verified/older accounts to
  // even send messages) and revoke every active invite so no one new can
  // get in while the server is locked down.
  try {
    await guild.setVerificationLevel(
      GuildVerificationLevel.High,
      "Anti-raid: automatic lockdown triggered"
    );
  } catch (error) {
    console.error("Error raising verification level:", error);
  }

  try {
    const invites = await guild.invites.fetch();
    await Promise.all(invites.map((invite) => invite.delete("Anti-raid: automatic lockdown").catch(() => {})));
  } catch (error) {
    console.error("Error revoking invites:", error);
  }

  // Punish everyone who joined during the burst that triggered this.
  const results = [];
  for (const raider of raiders) {
    try {
      const member = await guild.members.fetch(raider.id).catch(() => null);
      if (!member) continue;
      if (action === "ban") {
        await member.ban({ reason: "Anti-raid: mass-join detected" });
      } else {
        await member.kick("Anti-raid: mass-join detected");
      }
      results.push(`✅ ${raider.tag}`);
    } catch (error) {
      results.push(`⚠️ ${raider.tag} (couldn't ${action})`);
    }
  }

  const alertEmbed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🚨 Raid detected — lockdown engaged")
    .addFields(
      { name: "Joins detected", value: `${raiders.length}`, inline: true },
      { name: "Action taken", value: action === "ban" ? "Banned" : "Kicked", inline: true },
      { name: "Lockdown duration", value: `${lockdownMinutes} minute(s)`, inline: true },
      { name: "Members actioned", value: results.join("\n").slice(0, 1024) || "None" }
    )
    .setDescription(
      "Verification level raised to **High** and all active invites were revoked. This reverts automatically."
    )
    .setTimestamp();

  await sendLog(guild, config, alertEmbed);

  const revertTimeout = setTimeout(async () => {
    try {
      await guild.setVerificationLevel(
        lockdownState.get(guild.id)?.previousVerificationLevel ?? GuildVerificationLevel.Low,
        "Anti-raid: lockdown expired"
      );
    } catch (error) {
      console.error("Error reverting verification level:", error);
    }

    lockdownState.delete(guild.id);
    recentJoins.delete(guild.id);

    const revertEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🔓 Lockdown lifted")
      .setDescription(
        "Verification level was reverted. Note: revoked invite links are gone for good — create new ones if needed."
      )
      .setTimestamp();

    await sendLog(guild, config, revertEmbed);
  }, lockdownMinutes * 60 * 1000);

  lockdownState.set(guild.id, {
    previousVerificationLevel: lockdownState.get(guild.id)?.previousVerificationLevel,
    revertTimeout,
  });
}

export function registerAntiRaidHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "antiraid-setup") return;

    const logChannel = interaction.options.getChannel("log_channel", true);
    const joinThreshold = interaction.options.getInteger("join_threshold") ?? DEFAULT_JOIN_THRESHOLD;
    const timeWindowSeconds =
      interaction.options.getInteger("time_window_seconds") ?? DEFAULT_TIME_WINDOW_SECONDS;
    const action = interaction.options.getString("action") ?? DEFAULT_ACTION;
    const lockdownMinutes =
      interaction.options.getInteger("lockdown_minutes") ?? DEFAULT_LOCKDOWN_MINUTES;

    await interaction.deferReply({ ephemeral: true });

    try {
      await setConfig(interaction.guild.id, {
        logChannelId: logChannel.id,
        joinThreshold,
        timeWindowSeconds,
        action,
        lockdownMinutes,
      });

      await interaction.editReply(
        `✅ Anti-raid armed. If **${joinThreshold}+ members join within ${timeWindowSeconds}s**, I'll ${
          action === "ban" ? "ban" : "kick"
        } them, raise verification to High, revoke all invites for **${lockdownMinutes} minute(s)**, and log it to <#${logChannel.id}>.`
      );
    } catch (error) {
      console.error("Error setting up anti-raid:", error);
      await interaction.editReply("An error occurred saving the anti-raid configuration.");
    }
  });

  client.on("guildMemberAdd", async (member) => {
    // Bots are added deliberately by someone with Manage Server permission
    // (via OAuth), not by a raid script — don't count them toward the burst.
    if (member.user.bot) return;

    try {
      const config = await getConfig(member.guild.id);
      if (!config) return; // anti-raid not set up on this server
      if (lockdownState.has(member.guild.id)) return; // already locked down, don't re-trigger

      const now = Date.now();
      const windowMs = (config.timeWindowSeconds ?? DEFAULT_TIME_WINDOW_SECONDS) * 1000;

      const joins = recentJoins.get(member.guild.id) ?? [];
      joins.push({ id: member.id, tag: member.user.tag, ts: now });
      const withinWindow = joins.filter((j) => now - j.ts <= windowMs);
      recentJoins.set(member.guild.id, withinWindow);

      const threshold = config.joinThreshold ?? DEFAULT_JOIN_THRESHOLD;
      if (withinWindow.length >= threshold) {
        await triggerLockdown(member.guild, config, withinWindow);
      }
    } catch (error) {
      console.error("Error in anti-raid join check:", error);
    }
  });
}
