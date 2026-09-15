// Embed builders shared by the moderation handler: the DM sent to the
// affected user, the confirmation card posted in the channel, and the
// audit-log card sent to the configured mod-log channel.
import { EmbedBuilder } from "discord.js";

// Direct message (DM) notices to the affected user, styled as an embed
// (card with color, title, and fields). Change the title, color, or emoji
// here if you want a different style.
export const DM_EMBED_CONFIG = {
  ban: { emoji: "🔨", title: "🔨 You were banned", channelAction: "was banned", color: 0xed4245 },
  kick: { emoji: "👢", title: "👢 You were kicked", channelAction: "was kicked", color: 0xfaa61a },
  softban: { emoji: "🧹", title: "🧹 You were softbanned", channelAction: "was softbanned", color: 0x9b59b6 },
  mute: { emoji: "🔇", title: "🔇 You were muted", channelAction: "was muted", color: 0xfee75c },
  unmute: { emoji: "🔊", title: "🔊 Your timeout was removed", channelAction: "was unmuted", color: 0x57f287 },
  unban: { emoji: "🔓", title: "🔓 You were unbanned", channelAction: "was unbanned", color: 0x57f287 },
};

// Short label for the channel embed's title (Discord titles don't render
// @mentions, so the affected user goes in the description instead).
export const COMMAND_LABELS = {
  ban: "Ban",
  kick: "Kick",
  softban: "Softban",
  mute: "Mute",
  unmute: "Unmute",
  unban: "Unban",
};

// Full sentence shown as the log message's plain-text content, above the embed.
export const LOG_ANNOUNCE = {
  ban: "A user has been banned.",
  kick: "A user has been kicked.",
  softban: "A user has been softbanned.",
  mute: "A user has been muted.",
  unmute: "A user has had their timeout removed.",
  unban: "A user has been unbanned.",
};

// Title used in the log embed, e.g. "User Banned", "User Unbanned".
export const LOG_TITLES = {
  ban: "User Banned",
  kick: "User Kicked",
  softban: "User Softbanned",
  mute: "User Muted",
  unmute: "User Unmuted",
  unban: "User Unbanned",
};

// Log-channel embed: plain fields (User / User ID / Staff / Reason), no
// avatar thumbnail, matching a simple audit-log style.
export function buildLogEmbed(command, targetUser, reason, executor, extra = {}) {
  const config = DM_EMBED_CONFIG[command];

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(LOG_TITLES[command])
    .addFields(
      { name: "User", value: `<@${targetUser.id}> (${targetUser.tag})` },
      { name: "User ID", value: targetUser.id },
      { name: "Staff", value: `<@${executor.id}>` },
      { name: "Reason", value: reason || "No reason specified" }
    )
    .setTimestamp();

  if (extra.duration) {
    embed.addFields({ name: "Duration", value: `${extra.duration} minutes` });
  }

  return embed;
}

// Generic builder used by both the DM card and the channel card.
// title and description are decided by each specific function below.
function buildEmbedBase(command, reason, executor, extra, title, description, thumbnailUrl) {
  const config = DM_EMBED_CONFIG[command];

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Reason", value: reason || "No reason specified" },
      { name: "Action taken by", value: `<@${executor.id}>`, inline: true }
    )
    .setTimestamp();

  if (extra.duration) {
    embed.addFields({ name: "Duration", value: `${extra.duration} minutes`, inline: true });
  }

  if (extra.note) {
    embed.addFields({ name: "Note", value: extra.note });
  }

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  return embed;
}

// DM card: generic title ("You were banned"), server icon.
export function buildModEmbed(command, guild, reason, executor, extra = {}) {
  const config = DM_EMBED_CONFIG[command];
  return buildEmbedBase(
    command,
    reason,
    executor,
    extra,
    config.title,
    `In **${guild.name}**`,
    guild.iconURL()
  );
}

// Card for the channel where the command was run: short title ("🧹 Softban")
// and the description mentions the affected user (e.g. "@user was banned"),
// with their avatar instead of the server icon.
export function buildChannelModEmbed(command, targetUser, guild, reason, executor, extra = {}) {
  const config = DM_EMBED_CONFIG[command];
  const title = `${config.emoji} ${COMMAND_LABELS[command]}`;
  const description = `<@${targetUser.id}> ${config.channelAction}`;
  return buildEmbedBase(
    command,
    reason,
    executor,
    extra,
    title,
    description,
    targetUser.displayAvatarURL({ size: 256 })
  );
}

// Sends the "you were affected by a mod action" DM. Silently does nothing
// if the user has DMs closed or doesn't share a server with the bot — that
// is not a critical error, they just don't get notified.
//
// IMPORTANT: call this AFTER the moderation action has actually succeeded,
// not before. An earlier version of this bot sent the DM first, which meant
// a user could get a "you were banned" DM even when the ban itself later
// failed (e.g. the bot's role sits below theirs) — a false notification
// with nothing to back it up.
export async function notifyUserByDM(command, targetUser, guild, reason, executor, extra = {}) {
  const embed = buildModEmbed(command, guild, reason, executor, extra);

  try {
    await targetUser.send({ embeds: [embed] });
  } catch (error) {
    console.log(`Could not DM ${targetUser.tag}: ${error.message}`);
  }
}
