// Moderation: /ban /kick /softban /mute /unmute /unban, plus their two
// setup commands (/modlogs-setup, /access-setup).
//
// These commands are registered without setDefaultMemberPermissions (see
// src/commands/definitions.js), so Discord shows them to everyone — access
// is fully enforced here instead, using each server's Discord permissions
// plus whatever extra moderation_role was set via /access-setup.
import { PermissionFlagsBits } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { getGuildValue, setGuildValue } from "../lib/jsonStore.js";
import { getAccessConfig, setAccessConfig, parseRoleMentions } from "../lib/accessConfig.js";
import {
  notifyUserByDM,
  buildChannelModEmbed,
  buildLogEmbed,
  LOG_ANNOUNCE,
} from "../lib/embeds.js";

const MODLOG_CONFIG_PATH = join(DATA_DIR, "modlogs-config.json");

async function getModLogConfig(guildId) {
  return getGuildValue(MODLOG_CONFIG_PATH, guildId, null);
}

async function setModLogConfig(guildId, partial) {
  return setGuildValue(MODLOG_CONFIG_PATH, guildId, partial);
}

// Sends the log embed to the guild's configured mod-log channel, if any.
// Silently does nothing if /modlogs-setup hasn't been run for this guild.
async function sendModLog(command, targetUser, guild, reason, executor, extra = {}) {
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

const REQUIRED_NATIVE_PERMISSION = {
  ban: PermissionFlagsBits.BanMembers,
  softban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  unmute: PermissionFlagsBits.ModerateMembers,
};

export function registerModerationHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "modlogs-setup") return;

    const logChannel = interaction.options.getChannel("log_channel", true);

    await interaction.deferReply({ ephemeral: true });

    try {
      await setModLogConfig(interaction.guild.id, { logChannelId: logChannel.id });
      await interaction.editReply(
        `✅ Moderation logs (ban/kick/softban/mute/unmute/unban) will now be sent to <#${logChannel.id}>.`
      );
    } catch (error) {
      console.error("Error setting up modlogs:", error);
      await interaction.editReply("An error occurred saving the log channel. Check my permissions there.");
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "access-setup") return;

    const moderationRoleIds = parseRoleMentions(interaction.options.getString("moderation_roles"));
    const saveCodeRoleIds = parseRoleMentions(interaction.options.getString("save_code_roles"));
    const codeRoleIds = parseRoleMentions(interaction.options.getString("code_roles"));
    const clearModerationRoles = interaction.options.getBoolean("clear_moderation_roles");
    const clearSaveCodeRoles = interaction.options.getBoolean("clear_save_code_roles");
    const clearCodeRoles = interaction.options.getBoolean("clear_code_roles");

    await interaction.deferReply({ ephemeral: true });

    try {
      const update = {};

      if (clearModerationRoles) update.moderationRoleIds = [];
      else if (moderationRoleIds.length) update.moderationRoleIds = moderationRoleIds;

      if (clearSaveCodeRoles) update.saveCodeRoleIds = [];
      else if (saveCodeRoleIds.length) update.saveCodeRoleIds = saveCodeRoleIds;

      if (clearCodeRoles) update.codeRoleIds = [];
      else if (codeRoleIds.length) update.codeRoleIds = codeRoleIds;

      const config = await setAccessConfig(interaction.guild.id, update);

      const listOrDefault = (ids, fallback) =>
        ids?.length ? ids.map((id) => `<@&${id}>`).join(", ") : fallback;

      const summary = [
        `**Moderation roles:** ${listOrDefault(config.moderationRoleIds, "none (Discord permissions only)")}`,
        `**save-code/delete-code roles:** ${listOrDefault(config.saveCodeRoleIds, "none (Mods/Admins only)")}`,
        `**code roles:** ${listOrDefault(
          config.codeRoleIds,
          `none configured (defaults to the "Scripter" role name)`
        )}`,
      ].join("\n");

      await interaction.editReply(`✅ Access configuration updated.\n${summary}`);
    } catch (error) {
      console.error("Error in /access-setup:", error);
      await interaction.editReply("An error occurred saving the access configuration.");
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const moderationCommands = ["ban", "kick", "softban", "mute", "unmute", "unban"];
    if (!moderationCommands.includes(interaction.commandName)) return;

    const accessConfig = await getAccessConfig(interaction.guild.id);
    const hasAccess =
      interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.permissions.has(REQUIRED_NATIVE_PERMISSION[interaction.commandName]) ||
      (accessConfig.moderationRoleIds ?? []).some((id) => interaction.member.roles.cache.has(id));

    if (!hasAccess) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const reason = interaction.options.getString("reason") ?? "No reason specified";

    // /unban is different: there's no "in-server" user to select, so it's
    // handled separately using the ID typed by whoever runs the command.
    if (interaction.commandName === "unban") {
      const userId = interaction.options.getString("user_id", true);
      try {
        const bannedUser = await interaction.client.users.fetch(userId);
        await interaction.guild.members.unban(userId, reason);
        // DM after the unban succeeds, not before.
        await notifyUserByDM("unban", bannedUser, interaction.guild, reason, interaction.user);
        const channelEmbed = buildChannelModEmbed(
          "unban",
          bannedUser,
          interaction.guild,
          reason,
          interaction.user
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("unban", bannedUser, interaction.guild, reason, interaction.user);
      } catch (error) {
        console.error("Error running /unban:", error);
        await interaction.reply({
          content: "Couldn't unban that user. Check that the ID is correct and that they're banned.",
          ephemeral: true,
        });
      }
      return;
    }

    const targetUser = interaction.options.getUser("user", true);

    try {
      if (interaction.commandName === "ban") {
        const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
        // Perform the ban FIRST, then notify. Sending the DM before the
        // action succeeds meant a user could get a "you were banned" DM
        // even when the ban itself later failed (e.g. the bot's role sits
        // below theirs) — a false notification with nothing behind it.
        await interaction.guild.members.ban(targetUser.id, {
          deleteMessageSeconds: deleteDays * 86400,
          reason,
        });
        await notifyUserByDM("ban", targetUser, interaction.guild, reason, interaction.user);
        const channelEmbed = buildChannelModEmbed(
          "ban",
          targetUser,
          interaction.guild,
          reason,
          interaction.user
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("ban", targetUser, interaction.guild, reason, interaction.user);
      }

      if (interaction.commandName === "kick") {
        const member = await interaction.guild.members.fetch(targetUser.id);
        await member.kick(reason);
        await notifyUserByDM("kick", targetUser, interaction.guild, reason, interaction.user);
        const channelEmbed = buildChannelModEmbed(
          "kick",
          targetUser,
          interaction.guild,
          reason,
          interaction.user
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("kick", targetUser, interaction.guild, reason, interaction.user);
      }

      if (interaction.commandName === "softban") {
        // Softban already wipes the user's recent messages since it bans them
        // (with deleteMessageSeconds) and immediately unbans them.
        const deleteDays = interaction.options.getInteger("delete_days") ?? 1;
        await interaction.guild.members.ban(targetUser.id, {
          deleteMessageSeconds: deleteDays * 86400,
          reason: `Softban: ${reason}`,
        });
        await interaction.guild.members.unban(targetUser.id, "Softban - automatic unban");
        await notifyUserByDM("softban", targetUser, interaction.guild, reason, interaction.user);
        const channelEmbed = buildChannelModEmbed(
          "softban",
          targetUser,
          interaction.guild,
          reason,
          interaction.user,
          { note: "Recent messages were wiped, they can rejoin." }
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("softban", targetUser, interaction.guild, reason, interaction.user, {
          note: "Recent messages were wiped, they can rejoin.",
        });
      }

      if (interaction.commandName === "mute") {
        const minutes = interaction.options.getInteger("minutes", true);
        const member = await interaction.guild.members.fetch(targetUser.id);
        await member.timeout(minutes * 60 * 1000, reason);
        await notifyUserByDM("mute", targetUser, interaction.guild, reason, interaction.user, {
          duration: minutes,
        });
        const channelEmbed = buildChannelModEmbed(
          "mute",
          targetUser,
          interaction.guild,
          reason,
          interaction.user,
          { duration: minutes }
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("mute", targetUser, interaction.guild, reason, interaction.user, { duration: minutes });
      }

      if (interaction.commandName === "unmute") {
        const member = await interaction.guild.members.fetch(targetUser.id);
        await member.timeout(null, reason);
        const channelEmbed = buildChannelModEmbed(
          "unmute",
          targetUser,
          interaction.guild,
          reason,
          interaction.user
        );
        await interaction.reply({ embeds: [channelEmbed] });
        await sendModLog("unmute", targetUser, interaction.guild, reason, interaction.user);
      }
    } catch (error) {
      console.error(`Error running /${interaction.commandName}:`, error);
      const message =
        error.code === 50013
          ? "I don't have enough permissions to do that (check that my role is above the target user)."
          : "An error occurred running the command.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  });
}
