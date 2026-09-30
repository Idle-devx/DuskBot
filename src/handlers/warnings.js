// Warning system: /warn, /warnings, /clearwarnings.
//
// A warning doesn't take any Discord-level action on its own (no timeout,
// no kick) — it's just a paper trail staff can point to before escalating
// to /mute or /kick. Access follows the same rule as the rest of moderation
// (see hasModerationAccess in src/lib/accessConfig.js): Administrator,
// Moderate Members, or a configured moderation_role from /access-setup.
//
// Registered separately from moderation.js (its own file, its own
// data/warnings.json) rather than folded into it, following this bot's
// "one file per feature" convention — but it still reuses moderation.js's
// DM/channel embeds and the shared mod-log channel (src/lib/modLog.js) so a
// warning shows up next to bans/kicks/etc. in the same log channel.
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { updateJSON, readJSON } from "../lib/jsonStore.js";
import { hasModerationAccess } from "../lib/accessConfig.js";
import { notifyUserByDM, buildChannelModEmbed } from "../lib/embeds.js";
import { sendModLog } from "../lib/modLog.js";

const WARNINGS_PATH = join(DATA_DIR, "warnings.json");

// Shape: { [guildId]: { [userId]: [{ reason, moderatorId, timestamp }, ...] } }
// Returns the user's new total warning count.
async function addWarning(guildId, userId, warning) {
  return updateJSON(WARNINGS_PATH, (data) => {
    data[guildId] ??= {};
    data[guildId][userId] ??= [];
    data[guildId][userId].push(warning);
    return data[guildId][userId].length;
  });
}

async function getWarnings(guildId, userId) {
  const data = await readJSON(WARNINGS_PATH);
  return data[guildId]?.[userId] ?? [];
}

// Returns how many warnings were removed (0 if the user had none).
async function clearWarnings(guildId, userId) {
  return updateJSON(WARNINGS_PATH, (data) => {
    const count = data[guildId]?.[userId]?.length ?? 0;
    if (data[guildId]) delete data[guildId][userId];
    return count;
  });
}

// Shared by all three commands below: replies with a denial and returns
// false if the invoking member lacks moderation access, otherwise returns
// true without touching the interaction.
async function requireModerationAccess(interaction) {
  const allowed = await hasModerationAccess(interaction.member, PermissionFlagsBits.ModerateMembers);
  if (!allowed) {
    await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
  }
  return allowed;
}

export function registerWarningHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "warn") return;
    if (!(await requireModerationAccess(interaction))) return;

    const targetUser = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason specified";

    try {
      const count = await addWarning(interaction.guild.id, targetUser.id, {
        reason,
        moderatorId: interaction.user.id,
        timestamp: Date.now(),
      });

      await notifyUserByDM("warn", targetUser, interaction.guild, reason, interaction.user, { count });
      const channelEmbed = buildChannelModEmbed("warn", targetUser, interaction.guild, reason, interaction.user, {
        count,
      });
      await interaction.reply({ embeds: [channelEmbed] });
      await sendModLog("warn", targetUser, interaction.guild, reason, interaction.user, { count });
    } catch (error) {
      console.error("Error running /warn:", error);
      await interaction.reply({ content: "An error occurred saving the warning.", ephemeral: true });
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "warnings") return;
    if (!(await requireModerationAccess(interaction))) return;

    const targetUser = interaction.options.getUser("user", true);
    await interaction.deferReply({ ephemeral: true });

    const userWarnings = await getWarnings(interaction.guild.id, targetUser.id);
    if (!userWarnings.length) {
      await interaction.editReply(`${targetUser.tag} has no warnings.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
      .setDescription(
        userWarnings
          .map(
            (warning, index) =>
              `**#${index + 1}** — ${warning.reason}\n<t:${Math.floor(warning.timestamp / 1000)}:R> by <@${warning.moderatorId}>`
          )
          .join("\n\n")
          .slice(0, 4096)
      )
      .setFooter({ text: `${userWarnings.length} total warning${userWarnings.length === 1 ? "" : "s"}` });

    await interaction.editReply({ embeds: [embed] });
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "clearwarnings") return;
    if (!(await requireModerationAccess(interaction))) return;

    const targetUser = interaction.options.getUser("user", true);
    await interaction.deferReply({ ephemeral: true });

    const removed = await clearWarnings(interaction.guild.id, targetUser.id);
    await interaction.editReply(
      removed
        ? `✅ Cleared ${removed} warning${removed === 1 ? "" : "s"} for ${targetUser.tag}.`
        : `${targetUser.tag} had no warnings to clear.`
    );
  });
}
