// Join-to-create voice channels: an admin designates a "trigger" voice
// channel. Whenever someone joins it, the bot creates a new personal voice
// channel next to it, moves them in, and deletes it again automatically
// once everyone leaves.
import { ChannelType, EmbedBuilder } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { getGuildValue, setGuildValue, updateJSON, readJSON } from "../lib/jsonStore.js";

const CONFIG_PATH = join(DATA_DIR, "voicecreate-config.json");
const STATE_PATH = join(DATA_DIR, "voicecreate-state.json");

const DEFAULT_NAME_TEMPLATE = "🔊 {user}";

async function getConfig(guildId) {
  return getGuildValue(CONFIG_PATH, guildId, null);
}

async function setConfig(guildId, partial) {
  return setGuildValue(CONFIG_PATH, guildId, partial);
}

async function clearConfig(guildId) {
  return updateJSON(CONFIG_PATH, (data) => {
    delete data[guildId];
  });
}

// In-memory mirror of which channel IDs were created by this feature, kept
// in sync with voicecreate-state.json. voiceStateUpdate fires for every
// mute/deafen/camera toggle too, not just joins/leaves, so this lets most
// of those events bail out without ever touching the JSON store (same fix
// as the messageCreate/tickets-state.json issue elsewhere in this bot).
const trackedChannelIds = new Set();

async function loadTrackedChannelIds() {
  const state = await readJSON(STATE_PATH);
  for (const channelId of Object.keys(state)) {
    trackedChannelIds.add(channelId);
  }
}

async function trackChannel(channelId) {
  trackedChannelIds.add(channelId);
  return updateJSON(STATE_PATH, (state) => {
    state[channelId] = true;
  });
}

async function untrackChannel(channelId) {
  trackedChannelIds.delete(channelId);
  return updateJSON(STATE_PATH, (state) => {
    delete state[channelId];
  });
}

async function deleteTrackedChannel(channel) {
  await untrackChannel(channel.id);
  await channel.delete().catch(() => {});
}

async function sendLog(config, guild, description) {
  if (!config?.logChannelId) return;
  const logChannel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!logChannel) return;

  const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(description).setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch((error) => {
    console.error("Error sending voice-create log:", error);
  });
}

// Someone joined the configured trigger channel: create their personal
// channel and move them into it.
async function handleJoinTrigger(newState) {
  if (!newState.channelId || !newState.member || newState.member.user.bot) return;

  const config = await getConfig(newState.guild.id);
  if (!config?.triggerChannelId) return;
  if (newState.channelId !== config.triggerChannelId) return;

  const parent = config.categoryId ?? newState.channel.parentId ?? null;
  const channelName = (config.nameTemplate || DEFAULT_NAME_TEMPLATE)
    .replace("{user}", newState.member.displayName)
    .slice(0, 100);

  let newChannel;
  try {
    newChannel = await newState.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: config.userLimit ?? 0,
    });
  } catch (error) {
    console.error("Error creating join-to-create voice channel:", error);
    return;
  }

  await trackChannel(newChannel.id);

  try {
    await newState.member.voice.setChannel(newChannel);
  } catch (error) {
    // They likely left the trigger channel before we finished creating
    // theirs — don't leave an empty, untracked-looking channel behind.
    console.error("Error moving member into new voice channel:", error);
    await deleteTrackedChannel(newChannel);
    return;
  }

  await sendLog(config, newState.guild, `🔊 <@${newState.member.id}> created <#${newChannel.id}>.`);
}

// Someone left a channel we created: delete it once it's empty.
async function handleLeaveCleanup(oldState, newState) {
  if (!oldState.channelId || oldState.channelId === newState.channelId) return;
  if (!trackedChannelIds.has(oldState.channelId)) return;

  const channel = oldState.channel ?? (await oldState.guild.channels.fetch(oldState.channelId).catch(() => null));
  if (!channel) {
    await untrackChannel(oldState.channelId);
    return;
  }

  if (channel.members.size > 0) return;

  const config = await getConfig(oldState.guild.id);
  const name = channel.name;
  await deleteTrackedChannel(channel);
  await sendLog(config, oldState.guild, `🗑️ Deleted empty voice channel **${name}**.`);
}

// Startup sweep: a channel could still be tracked but already empty (or
// gone entirely) if the bot restarted while people were leaving it.
async function sweepTrackedChannels(client) {
  for (const channelId of [...trackedChannelIds]) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        await untrackChannel(channelId);
        continue;
      }
      if (channel.members.size === 0) {
        await deleteTrackedChannel(channel);
      }
    } catch (error) {
      console.error(`Error sweeping tracked voice channel ${channelId}:`, error);
    }
  }
}

export function registerVoiceCreateHandlers(client) {
  client.once("ready", async () => {
    await loadTrackedChannelIds();
    await sweepTrackedChannels(client);
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      await handleJoinTrigger(newState);
      await handleLeaveCleanup(oldState, newState);
    } catch (error) {
      console.error("Error in join-to-create voiceStateUpdate handler:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "voicecreate-setup") return;

    const disable = interaction.options.getBoolean("disable") ?? false;

    await interaction.deferReply({ ephemeral: true });

    if (disable) {
      await clearConfig(interaction.guild.id);
      await interaction.editReply("✅ Join-to-create voice channels disabled for this server.");
      return;
    }

    const triggerChannel = interaction.options.getChannel("trigger_channel");
    if (!triggerChannel) {
      await interaction.editReply(
        "`trigger_channel` is required to set this up (or pass `disable:true` to turn it off)."
      );
      return;
    }

    const category = interaction.options.getChannel("category");
    const nameTemplate = interaction.options.getString("name_template") ?? DEFAULT_NAME_TEMPLATE;
    const userLimit = interaction.options.getInteger("user_limit") ?? 0;
    const logChannel = interaction.options.getChannel("log_channel");

    if (!nameTemplate.includes("{user}")) {
      await interaction.editReply(
        "`name_template` must include `{user}` so each channel can be named after its creator."
      );
      return;
    }

    try {
      await setConfig(interaction.guild.id, {
        triggerChannelId: triggerChannel.id,
        categoryId: category?.id ?? null,
        nameTemplate,
        userLimit,
        logChannelId: logChannel?.id ?? null,
      });

      await interaction.editReply(
        `✅ Joining <#${triggerChannel.id}> now creates a personal voice channel` +
          (category ? ` under **${category.name}**` : "") +
          `, named like \`${nameTemplate.replace("{user}", "SomeUser")}\`` +
          (userLimit ? ` with a ${userLimit}-user limit` : "") +
          `. It's deleted automatically once everyone leaves.` +
          (logChannel ? ` Logs go to <#${logChannel.id}>.` : "")
      );
    } catch (error) {
      console.error("Error setting up join-to-create voice channels:", error);
      await interaction.editReply("An error occurred saving the configuration.");
    }
  });
}
