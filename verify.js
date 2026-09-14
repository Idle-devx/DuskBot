// Member verification system: posts a panel with a "Verify" button, grants a
// role on click, and auto-kicks members who never verify within a
// configurable window. Kept separate from index.js, same pattern as
// tickets.js.
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = join(__dirname, "verify-config.json");
const STATE_PATH = join(__dirname, "verify-state.json");

const VERIFY_BUTTON_ID = "verify_button";
const DEFAULT_KICK_HOURS = 24;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, same cadence as tickets.js

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

// State: which members are still pending verification, and when they joined.
// { [guildId]: { [userId]: joinedAtISOString } }
async function getPending(guildId) {
  const all = await loadJSON(STATE_PATH);
  return all[guildId] ?? {};
}

async function addPending(guildId, userId, joinedAt) {
  const all = await loadJSON(STATE_PATH);
  all[guildId] = { ...(all[guildId] ?? {}), [userId]: joinedAt };
  await saveJSON(STATE_PATH, all);
}

async function removePending(guildId, userId) {
  const all = await loadJSON(STATE_PATH);
  if (!all[guildId] || !(userId in all[guildId])) return;
  delete all[guildId][userId];
  await saveJSON(STATE_PATH, all);
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

    await interaction.deferReply({ ephemeral: true });

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
      await interaction.reply({ content: "Verification isn't set up on this server.", ephemeral: true });
      return;
    }

    try {
      if (interaction.member.roles.cache.has(config.verifiedRoleId)) {
        await interaction.reply({ content: "You're already verified!", ephemeral: true });
        return;
      }

      await interaction.member.roles.add(config.verifiedRoleId);
      await removePending(interaction.guild.id, interaction.member.id);
      await interaction.reply({ content: "✅ You're verified! Welcome.", ephemeral: true });
      await sendVerifyLog(interaction.guild, config, `✅ <@${interaction.member.id}> verified.`);
    } catch (error) {
      console.error("Error verifying member:", error);
      await interaction.reply({
        content: "I couldn't give you the role. Ask a staff member to check my permissions (my role must be above the verified role).",
        ephemeral: true,
      });
    }
  });

  // --- Background check: auto-kick members who never verified ---
  setInterval(async () => {
    try {
      const allConfigs = await loadJSON(CONFIG_PATH);
      const allPending = await loadJSON(STATE_PATH);

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
