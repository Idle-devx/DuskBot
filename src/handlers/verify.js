// Member verification system: posts a panel with a "Verify" button, grants a
// role on click, and auto-kicks members who never verify within a
// configurable window. Optionally greets each newly verified member in a
// public channel (/verify-welcome).
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { getGuildValue, setGuildValue, updateJSON, readJSON } from "../lib/jsonStore.js";

const CONFIG_PATH = join(DATA_DIR, "verify-config.json");
const STATE_PATH = join(DATA_DIR, "verify-state.json");

const VERIFY_BUTTON_ID = "verify_button";
const DEFAULT_KICK_HOURS = 24;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, same cadence as tickets.js

async function getConfig(guildId) {
  return getGuildValue(CONFIG_PATH, guildId, null);
}

async function setConfig(guildId, partial) {
  return setGuildValue(CONFIG_PATH, guildId, partial);
}

// State: which members are still pending verification, and when they joined.
// { [guildId]: { [userId]: joinedAtISOString } }
async function addPending(guildId, userId, joinedAt) {
  return updateJSON(STATE_PATH, (all) => {
    all[guildId] = { ...(all[guildId] ?? {}), [userId]: joinedAt };
  });
}

async function removePending(guildId, userId) {
  return updateJSON(STATE_PATH, (all) => {
    if (!all[guildId] || !(userId in all[guildId])) return;
    delete all[guildId][userId];
  });
}

// --- Welcome message for newly verified members -------------------------

// Placeholders an admin can use in a custom message.
const USER_TOKEN = "{user}";
const HELPER_TOKEN = "{helper}";
export const WELCOME_MAX_LENGTH = 1500;

export const DEFAULT_WELCOME =
  `Welcome ${USER_TOKEN}, feel free to tag ${HELPER_TOKEN} if you have any issue or error, ` +
  "or if you want a cheat menu for any offline game or slop game.";
// Used when no helper was chosen, so the sentence doesn't end up with a hole in it.
export const DEFAULT_WELCOME_NO_HELPER =
  `Welcome ${USER_TOKEN}, feel free to ask here if you have any issue or error, ` +
  "or if you want a cheat menu for any offline game or slop game.";

// "<@id>" for a member, "<@&id>" for a role. `mentionable` is whatever
// discord.js hands back for a mentionable option: a Role has no `user`
// and no `username`, a GuildMember has `user`, a bare User has `username`.
export function mentionFor(mentionable) {
  if (!mentionable?.id) return null;
  const isUser = Boolean(mentionable.user) || typeof mentionable.username === "string";
  return isUser ? `<@${mentionable.id}>` : `<@&${mentionable.id}>`;
}

// Fills the placeholders. A custom message that leaves out {user} still
// greets the right person: the mention is put in front of it.
export function buildWelcomeText({ template, userId, helperMention }) {
  const user = `<@${userId}>`;
  let text = (template ?? "").trim();
  if (!text) text = helperMention ? DEFAULT_WELCOME : DEFAULT_WELCOME_NO_HELPER;
  if (!text.includes(USER_TOKEN)) text = `${USER_TOKEN} ${text}`;
  return text
    .split(USER_TOKEN).join(user)
    .split(HELPER_TOKEN).join(helperMention ?? "the staff");
}

// Only the new member is pinged. The helper's mention is shown as a
// clickable tag but does not notify them: otherwise they'd get a ping for
// every single person who verifies.
export function buildWelcomeMessage({ template, userId, helperMention }) {
  return {
    content: buildWelcomeText({ template, userId, helperMention }),
    allowedMentions: { users: [userId], roles: [], parse: [] },
  };
}

// Never throws: a welcome that can't be posted must not undo or fail a
// verification that already went through.
async function sendWelcome(guild, config, userId) {
  if (!config?.welcomeChannelId) return false;
  try {
    const channel = await guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return false;
    await channel.send(
      buildWelcomeMessage({
        template: config.welcomeMessage,
        userId,
        helperMention: config.welcomeHelper ?? null,
      })
    );
    return true;
  } catch (error) {
    console.error("Error sending verification welcome message:", error);
    return false;
  }
}

async function sendVerifyLog(guild, config, description) {
  if (!config?.logChannelId) return;
  const logChannel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(description)
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch((error) => {
    console.error("Error sending verify log:", error);
  });
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("✅ Member Verification")
    .setDescription("Click the button below to verify and get access to the server.");
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
  );
}

export function registerVerifyHandlers(client) {
  // --- /verify-setup ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "verify-setup") return;

    const panelChannel = interaction.options.getChannel("panel_channel", true);
    const verifiedRole = interaction.options.getRole("verified_role", true);
    const kickHours = interaction.options.getInteger("kick_hours") ?? DEFAULT_KICK_HOURS;
    const logChannel = interaction.options.getChannel("log_channel");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const panelMessage = await panelChannel.send({
        embeds: [buildPanelEmbed()],
        components: [buildPanelRow()],
      });

      await setConfig(interaction.guild.id, {
        panelChannelId: panelChannel.id,
        panelMessageId: panelMessage.id,
        verifiedRoleId: verifiedRole.id,
        kickHours,
        logChannelId: logChannel?.id ?? null,
      });

      await interaction.editReply(
        `✅ Verification panel posted in <#${panelChannel.id}>. New members will get <@&${verifiedRole.id}> when they verify, ` +
          `and will be auto-kicked after ${kickHours}h if they don't.`
      );
    } catch (error) {
      console.error("Error setting up verification:", error);
      await interaction.editReply(
        "An error occurred setting up verification. Check that I can send messages there and manage the role (my role must be above it)."
      );
    }
  });

  // --- /verify-welcome ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "verify-welcome") return;

    const channel = interaction.options.getChannel("channel");
    const helper = interaction.options.getMentionable("helper");
    const message = interaction.options.getString("message");
    const disable = interaction.options.getBoolean("disable") ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const current = await getConfig(interaction.guild.id);
      if (!current) {
        await interaction.editReply("Set up verification first with `/verify-setup`. The welcome is sent when someone presses its Verify button.");
        return;
      }

      if (disable) {
        await setConfig(interaction.guild.id, { welcomeChannelId: null });
        await interaction.editReply("Welcome messages are off. Your message and helper are kept; run `/verify-welcome channel:` to turn them back on.");
        return;
      }

      const partial = {};
      if (channel) partial.welcomeChannelId = channel.id;
      if (helper) partial.welcomeHelper = mentionFor(helper);
      // "default" (or "reset") goes back to the built-in text
      if (message !== null) partial.welcomeMessage = /^(default|reset)$/i.test(message.trim()) ? null : message.trim();

      const next = { ...current, ...partial };
      if (!next.welcomeChannelId) {
        await interaction.editReply("Pick a `channel` for the welcome messages.");
        return;
      }

      await setConfig(interaction.guild.id, partial);

      const preview = buildWelcomeText({
        template: next.welcomeMessage,
        userId: interaction.user.id,
        helperMention: next.welcomeHelper ?? null,
      });
      await interaction.editReply({
        content:
          `✅ Newly verified members will be welcomed in <#${next.welcomeChannelId}>. Preview, with you as the new member:\n\n${preview}\n\n` +
          "Only the new member is pinged; the helper is shown as a tag but not notified.",
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("Error setting up the verification welcome:", error);
      await interaction.editReply("An error occurred saving the welcome message.");
    }
  });

  // --- New member joins: start tracking them as pending ---
  client.on("guildMemberAdd", async (member) => {
    // Bots are added deliberately via OAuth by someone with Manage Server
    // permission — they can't click the verify button, so don't track them
    // (otherwise they'd get auto-kicked after kick_hours for no reason).
    if (member.user.bot) return;

    try {
      const config = await getConfig(member.guild.id);
      if (!config) return; // verification not set up on this server

      await addPending(member.guild.id, member.id, new Date().toISOString());
      await sendVerifyLog(member.guild, config, `👋 <@${member.id}> joined and is pending verification.`);
    } catch (error) {
      console.error("Error tracking new member for verification:", error);
    }
  });

  // --- Member leaves before verifying: stop tracking them ---
  client.on("guildMemberRemove", async (member) => {
    try {
      await removePending(member.guild.id, member.id);
    } catch (error) {
      console.error("Error clearing pending verification on member leave:", error);
    }
  });

  // --- Verify button click ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== VERIFY_BUTTON_ID) return;

    const config = await getConfig(interaction.guild.id);
    if (!config) {
      await interaction.reply({ content: "Verification isn't set up on this server.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      if (interaction.member.roles.cache.has(config.verifiedRoleId)) {
        await interaction.reply({ content: "You're already verified!", flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.member.roles.add(config.verifiedRoleId);
      await removePending(interaction.guild.id, interaction.member.id);
      await interaction.reply({ content: "✅ You're verified! Welcome.", flags: MessageFlags.Ephemeral });
      await sendVerifyLog(interaction.guild, config, `✅ <@${interaction.member.id}> verified.`);
      await sendWelcome(interaction.guild, config, interaction.member.id);
    } catch (error) {
      console.error("Error verifying member:", error);
      await interaction.reply({
        content: "I couldn't give you the role. Ask a staff member to check my permissions (my role must be above the verified role).",
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  // --- Background check: auto-kick members who never verified ---
  setInterval(async () => {
    try {
      const allConfigs = await readJSON(CONFIG_PATH);
      const allPending = await readJSON(STATE_PATH);

      for (const [guildId, pendingMap] of Object.entries(allPending)) {
        const config = allConfigs[guildId];
        if (!config) continue;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) continue;

        const kickHours = config.kickHours ?? DEFAULT_KICK_HOURS;
        const now = Date.now();

        for (const [userId, joinedAtISO] of Object.entries(pendingMap)) {
          const joinedAt = new Date(joinedAtISO).getTime();
          const hoursWaiting = (now - joinedAt) / (1000 * 60 * 60);
          if (hoursWaiting < kickHours) continue;

          try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
              // They already left on their own.
              await removePending(guildId, userId);
              continue;
            }

            if (member.roles.cache.has(config.verifiedRoleId)) {
              // Got verified some other way; just stop tracking them.
              await removePending(guildId, userId);
              continue;
            }

            await member.kick("Did not verify within the configured time window.");
            await removePending(guildId, userId);
            await sendVerifyLog(
              guild,
              config,
              `⏱️ <@${userId}> was kicked for not verifying within ${kickHours}h.`
            );
          } catch (error) {
            console.error(`Error auto-kicking unverified member ${userId} in guild ${guildId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Error running verification auto-kick check:", error);
    }
  }, CHECK_INTERVAL_MS);
}
