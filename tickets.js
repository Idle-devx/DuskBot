// Ticket system: a persistent panel with a button lets users open a ticket
// through a category dropdown; each ticket becomes a private channel with a
// "Close Ticket" button that saves a transcript to a log channel and then
// deletes the channel. Tickets also get an inactivity alert after a
// configurable number of hours, and auto-close after a configurable number
// of hours with zero activity.
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "tickets-config.json");
const STATE_PATH = join(__dirname, "tickets-state.json");

// How often the background checker runs (milliseconds).
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// Defaults if a server hasn't customized them via /ticket-setup.
const DEFAULT_ALERT_HOURS = 3;
const DEFAULT_INACTIVITY_HOURS = 24;

// Categories shown in the dropdown when someone opens a ticket. Edit this
// list to add/remove/rename categories.
const TICKET_CATEGORIES = [
  { label: "General Support", value: "support", emoji: "🛠️", description: "Questions or help with something" },
  { label: "Report a User", value: "report", emoji: "🚨", description: "Report rule-breaking or abuse" },
  { label: "Purchase / Billing", value: "purchase", emoji: "💳", description: "Payment or order issues" },
  { label: "Other", value: "other", emoji: "❓", description: "Anything else" },
];

// --- Per-guild config (panel/category/log channel, support role, timers) ---
// Stored as simple JSON on disk, set via the /ticket-setup command.

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

async function getGuildConfig(guildId) {
  const config = await loadJSON(CONFIG_PATH);
  return config[guildId] ?? null;
}

async function setGuildConfig(guildId, partial) {
  const config = await loadJSON(CONFIG_PATH);
  config[guildId] = { ...(config[guildId] ?? {}), ...partial };
  await saveJSON(CONFIG_PATH, config);
  return config[guildId];
}

// --- Per-ticket state (open tickets being tracked for alerts/auto-close) ---

async function getState() {
  return loadJSON(STATE_PATH);
}

async function setTicketState(channelId, partial) {
  const state = await getState();
  state[channelId] = { ...(state[channelId] ?? {}), ...partial };
  await saveJSON(STATE_PATH, state);
}

async function removeTicketState(channelId) {
  const state = await getState();
  delete state[channelId];
  await saveJSON(STATE_PATH, state);
}

// Extracts every role ID mentioned in a string like "@Staff @Helper" (as
// Discord sends it: "<@&123> <@&456>"). Returns an array, possibly empty.
function parseRoleMentions(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/<@&(\d+)>/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

// Shared permission check for closing a ticket, used by both the button
// and the /close command.
function canCloseTicket(member, openerId, guildConfig) {
  return (
    member.id === openerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    (guildConfig?.supportRoleIds ?? []).some((id) => member.roles.cache.has(id))
  );
}

// --- UI builders ---

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 Need help?")
    .setDescription("Click the button below and choose a category to open a private ticket with the staff team.");
}

function buildPanelButton() {
  const button = new ButtonBuilder()
    .setCustomId("ticket_open_panel")
    .setLabel("Open Ticket")
    .setEmoji("🎫")
    .setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder().addComponents(button);
}

function buildCategorySelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket_category_select")
    .setPlaceholder("Choose a category...")
    .addOptions(
      TICKET_CATEGORIES.map((c) => ({
        label: c.label,
        value: c.value,
        emoji: c.emoji,
        description: c.description,
      }))
    );
  return new ActionRowBuilder().addComponents(select);
}

function buildTicketWelcomeEmbed(opener, categoryLabel) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 Ticket opened")
    .setDescription(`Hi <@${opener.id}>! A member of the staff team will be with you shortly.`)
    .addFields({ name: "Category", value: categoryLabel })
    .setTimestamp();
}

function buildCloseButton() {
  const button = new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("Close Ticket")
    .setEmoji("🔒")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(button);
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
}

// Builds a plain-text transcript from a channel's message history.
async function buildTranscript(channel) {
  let allMessages = [];
  let lastId;

  // Discord only returns up to 100 messages per request; page backwards
  // until there are no more, capped at 1000 so this can't run forever.
  while (allMessages.length < 1000) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    allMessages = allMessages.concat([...batch.values()]);
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.reverse();

  const lines = allMessages.map((msg) => {
    const timestamp = msg.createdAt.toISOString();
    const author = msg.author.tag;
    const content = msg.content || "(no text content)";
    const attachments = msg.attachments.map((a) => a.url).join(" ");
    return `[${timestamp}] ${author}: ${content}${attachments ? " " + attachments : ""}`;
  });

  return lines.join("\n") || "(no messages)";
}

// Shared close logic used by both the "Close Ticket" button and the
// auto-close-on-inactivity background check.
async function closeTicketChannel(channel, closedByText) {
  try {
    const guildConfig = await getGuildConfig(channel.guild.id);
    const transcriptText = await buildTranscript(channel);
    const tempDir = await mkdtemp(join(tmpdir(), "ticket-"));
    const transcriptPath = join(tempDir, `${channel.name}.txt`);
    await writeFile(transcriptPath, transcriptText, "utf-8");

    if (guildConfig?.logChannelId) {
      const logChannel = await channel.guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🔒 Ticket closed")
          .addFields(
            { name: "Channel", value: `#${channel.name}`, inline: true },
            { name: "Closed by", value: closedByText, inline: true }
          )
          .setTimestamp();
        await logChannel.send({
          embeds: [logEmbed],
          files: [{ attachment: transcriptPath, name: `${channel.name}.txt` }],
        });
      }
    }

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    console.error("Error generating transcript:", error);
  }

  await removeTicketState(channel.id);

  setTimeout(() => {
    channel.delete().catch((error) => console.error("Error deleting ticket channel:", error));
  }, 5000);
}

// Background job: checks every ticket being tracked and sends the inactivity
// alert or auto-closes it once the configured thresholds are reached.
function startBackgroundChecker(client) {
  setInterval(async () => {
    const state = await getState();
    const now = Date.now();

    for (const [channelId, ticket] of Object.entries(state)) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          // Channel no longer exists (deleted manually) — stop tracking it.
          await removeTicketState(channelId);
          continue;
        }

        const guildConfig = await getGuildConfig(ticket.guildId);
        const alertHours = guildConfig?.alertHours ?? DEFAULT_ALERT_HOURS;
        const inactivityHours = guildConfig?.inactivityHours ?? DEFAULT_INACTIVITY_HOURS;

        const hoursSinceOpen = (now - ticket.openedAt) / 3600000;
        const hoursSinceActivity = (now - ticket.lastActivityAt) / 3600000;

        // Auto-close first: if it's been inactive long enough, no need to
        // also send the alert.
        if (hoursSinceActivity >= inactivityHours) {
          await channel.send(
            `⏰ This ticket has had no activity for over ${inactivityHours} hour(s) and will be closed automatically.`
          );
          await closeTicketChannel(channel, "Auto-closed (inactivity)");
          continue;
        }

        if (!ticket.alertSent && hoursSinceOpen >= alertHours) {
          await channel.send(
            `<@${ticket.openerId}> ⏰ This ticket has been open for over ${alertHours} hour(s) without being closed. Please follow up if you still need help.`
          );
          await setTicketState(channelId, { alertSent: true });
        }
      } catch (error) {
        console.error(`Error checking ticket ${channelId}:`, error);
      }
    }
  }, CHECK_INTERVAL_MS);
}

export function registerTicketHandlers(client) {
  client.once("ready", () => startBackgroundChecker(client));

  // Tracks activity (any message) in open ticket channels so the
  // inactivity timer resets.
  client.on("messageCreate", async (message) => {
    if (!message.guild) return;
    const state = await getState();
    if (!state[message.channel.id]) return;
    await setTicketState(message.channel.id, { lastActivityAt: Date.now() });
  });

  client.on("interactionCreate", async (interaction) => {
    // --- Admin command: set up (or update) the ticket panel ---
    if (interaction.isChatInputCommand() && interaction.commandName === "ticket-setup") {
      const panelChannel = interaction.options.getChannel("panel_channel", true);
      const category = interaction.options.getChannel("category");
      const logChannel = interaction.options.getChannel("log_channel");
      const supportRoleIds = parseRoleMentions(interaction.options.getString("support_roles"));
      const alertHours = interaction.options.getInteger("alert_hours");
      const inactivityHours = interaction.options.getInteger("inactivity_hours");

      await interaction.deferReply({ ephemeral: true });

      try {
        await panelChannel.send({
          embeds: [buildPanelEmbed()],
          components: [buildPanelButton()],
        });

        await setGuildConfig(interaction.guild.id, {
          categoryId: category?.id ?? null,
          logChannelId: logChannel?.id ?? null,
          supportRoleIds,
          alertHours: alertHours ?? DEFAULT_ALERT_HOURS,
          inactivityHours: inactivityHours ?? DEFAULT_INACTIVITY_HOURS,
        });

        await interaction.editReply(
          `✅ Ticket panel posted in <#${panelChannel.id}>.` +
            (category ? ` New tickets will be created under **${category.name}**.` : "") +
            (logChannel ? ` Logs will go to <#${logChannel.id}>.` : " No log channel set.") +
            (supportRoleIds.length
              ? ` Staff roles: ${supportRoleIds.map((id) => `<@&${id}>`).join(", ")}.`
              : " No staff roles set (only Admins/Manage Channels can manage tickets).") +
            ` Inactivity alert after **${alertHours ?? DEFAULT_ALERT_HOURS}h**, auto-close after **${
              inactivityHours ?? DEFAULT_INACTIVITY_HOURS
            }h** of no activity.`
        );
      } catch (error) {
        console.error("Error setting up ticket panel:", error);
        await interaction.editReply(
          "An error occurred setting up the ticket panel. Check my permissions in that channel."
        );
      }
      return;
    }

    // --- Button: open panel clicked -> show category dropdown ---
    if (interaction.isButton() && interaction.customId === "ticket_open_panel") {
      await interaction.reply({
        content: "Choose a category for your ticket:",
        components: [buildCategorySelect()],
        ephemeral: true,
      });
      return;
    }

    // --- Select menu: category chosen -> create the ticket channel ---
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category_select") {
      const categoryValue = interaction.values[0];
      const categoryInfo = TICKET_CATEGORIES.find((c) => c.value === categoryValue);
      const guildConfig = await getGuildConfig(interaction.guild.id);

      await interaction.deferUpdate();

      // Prevent duplicate open tickets from the same user.
      const existing = interaction.guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          ch.topic &&
          ch.topic.includes(`opener:${interaction.user.id}`)
      );
      if (existing) {
        await interaction.followUp({
          content: `You already have an open ticket: <#${existing.id}>`,
          ephemeral: true,
        });
        return;
      }

      try {
        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          },
        ];

        if (guildConfig?.supportRoleIds?.length) {
          for (const roleId of guildConfig.supportRoleIds) {
            overwrites.push({
              id: roleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageMessages,
              ],
            });
          }
        }

        const channelName = `ticket-${sanitizeChannelName(interaction.user.username)}`;

        const ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: guildConfig?.categoryId ?? undefined,
          topic: `opener:${interaction.user.id} | category:${categoryValue}`,
          permissionOverwrites: overwrites,
        });

        const supportMentions = (guildConfig?.supportRoleIds ?? []).map((id) => `<@&${id}>`).join(" ");
        await ticketChannel.send({
          content: supportMentions
            ? `<@${interaction.user.id}> ${supportMentions}`
            : `<@${interaction.user.id}>`,
          embeds: [buildTicketWelcomeEmbed(interaction.user, categoryInfo?.label ?? categoryValue)],
          components: [buildCloseButton()],
        });

        const now = Date.now();
        await setTicketState(ticketChannel.id, {
          guildId: interaction.guild.id,
          openerId: interaction.user.id,
          openedAt: now,
          lastActivityAt: now,
          alertSent: false,
        });

        await interaction.followUp({
          content: `✅ Your ticket was created: <#${ticketChannel.id}>`,
          ephemeral: true,
        });

        if (guildConfig?.logChannelId) {
          const logChannel = await interaction.guild.channels
            .fetch(guildConfig.logChannelId)
            .catch(() => null);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("🎫 Ticket opened")
              .addFields(
                { name: "User", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Category", value: categoryInfo?.label ?? categoryValue, inline: true },
                { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        }
      } catch (error) {
        console.error("Error creating ticket channel:", error);
        await interaction.followUp({
          content: "An error occurred creating your ticket. Check that I have permission to create channels here.",
          ephemeral: true,
        });
      }
      return;
    }

    // --- Button: close ticket ---
    if (interaction.isButton() && interaction.customId === "ticket_close") {
      const channel = interaction.channel;
      const topic = channel.topic ?? "";
      const openerMatch = topic.match(/opener:(\d+)/);
      const openerId = openerMatch?.[1];
      const guildConfig = await getGuildConfig(interaction.guild.id);

      if (!canCloseTicket(interaction.member, openerId, guildConfig)) {
        await interaction.reply({
          content: "You don't have permission to close this ticket.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply("🔒 Closing this ticket in 5 seconds, generating transcript...");
      await closeTicketChannel(channel, `<@${interaction.user.id}>`);
      return;
    }

    // --- Command: /close (same effect as the button, usable from anywhere
    // in the ticket channel without scrolling to find the button) ---
    if (interaction.isChatInputCommand() && interaction.commandName === "close") {
      const channel = interaction.channel;
      const topic = channel.topic ?? "";
      const openerMatch = topic.match(/opener:(\d+)/);

      if (!openerMatch) {
        await interaction.reply({
          content: "This command can only be used inside a ticket channel.",
          ephemeral: true,
        });
        return;
      }

      const openerId = openerMatch[1];
      const guildConfig = await getGuildConfig(interaction.guild.id);

      if (!canCloseTicket(interaction.member, openerId, guildConfig)) {
        await interaction.reply({
          content: "You don't have permission to close this ticket.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply("🔒 Closing this ticket in 5 seconds, generating transcript...");
      await closeTicketChannel(channel, `<@${interaction.user.id}>`);
      return;
    }
  });
}
