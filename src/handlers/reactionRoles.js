// Reaction roles: an admin posts a configurable panel embed (server icon as
// thumbnail, plus a description of what each reaction grants), then maps
// individual emoji to roles with /reactionrole-add. Reacting with a mapped
// emoji grants the role; removing the reaction removes it again.
import { EmbedBuilder } from "discord.js";
import { join } from "node:path";
import { DATA_DIR } from "../lib/constants.js";
import { readJSON, updateJSON } from "../lib/jsonStore.js";

const CONFIG_PATH = join(DATA_DIR, "reactionroles-config.json");

const DEFAULT_TITLE = "🎭 Reaction Roles";
const DEFAULT_DESCRIPTION =
  "React with an emoji below to receive the matching role. Remove your reaction to remove it again.";
const DEFAULT_COLOR = 0x5865f2;

// Config shape: { [guildId]: { [messageId]: { channelId, title, description,
// color, roles: [{ key, display, roleId }] } } }
// `key` is what an incoming reaction is matched against (a custom emoji's
// ID, or the unicode emoji itself); `display` is what's rendered in the
// embed (the emoji's toString(), e.g. "<:blob:123...>" or "🎨").

async function getPanel(guildId, messageId) {
  const data = await readJSON(CONFIG_PATH);
  return data[guildId]?.[messageId] ?? null;
}

async function createPanel(guildId, messageId, panel) {
  return updateJSON(CONFIG_PATH, (data) => {
    data[guildId] = data[guildId] ?? {};
    data[guildId][messageId] = panel;
  });
}

async function updatePanelRoles(guildId, messageId, roles) {
  return updateJSON(CONFIG_PATH, (data) => {
    if (!data[guildId]?.[messageId]) return;
    data[guildId][messageId].roles = roles;
  });
}

async function deletePanel(guildId, messageId) {
  return updateJSON(CONFIG_PATH, (data) => {
    if (!data[guildId]) return;
    delete data[guildId][messageId];
    if (Object.keys(data[guildId]).length === 0) delete data[guildId];
  });
}

// A custom emoji typed/pasted into a STRING option arrives as "<:name:id>"
// (or "<a:name:id>" if animated); anything else is treated as a plain
// unicode emoji. Only used by /reactionrole-remove — /reactionrole-add
// instead derives the canonical key from the bot's own successful reaction
// (see below), which is more reliable since it's what Discord itself
// resolved the input to.
function parseEmojiKey(raw) {
  const custom = raw.trim().match(/^<a?:\w+:(\d+)>$/);
  return custom ? custom[1] : raw.trim();
}

function buildPanelEmbed(guild, panel) {
  const embed = new EmbedBuilder().setColor(panel.color ?? DEFAULT_COLOR).setTitle(panel.title || DEFAULT_TITLE);

  const iconURL = guild.iconURL({ size: 256 });
  if (iconURL) embed.setThumbnail(iconURL);

  const roleLines = panel.roles.length
    ? panel.roles.map((r) => `${r.display} — <@&${r.roleId}>`).join("\n")
    : "_No roles configured yet._";

  embed.setDescription(`${panel.description || DEFAULT_DESCRIPTION}\n\n${roleLines}`);
  embed.setTimestamp();

  return embed;
}

export function registerReactionRoleHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // --- /reactionrole-setup ---
    if (interaction.commandName === "reactionrole-setup") {
      const channel = interaction.options.getChannel("channel", true);
      const title = interaction.options.getString("title") ?? DEFAULT_TITLE;
      const description = interaction.options.getString("description") ?? DEFAULT_DESCRIPTION;
      const colorInput = interaction.options.getString("color");

      let color = DEFAULT_COLOR;
      if (colorInput) {
        const hexMatch = colorInput.trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (!hexMatch) {
          await interaction.reply({ content: "`color` must be a hex code like `#5865F2`.", ephemeral: true });
          return;
        }
        color = parseInt(hexMatch[1], 16);
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const panel = { channelId: channel.id, title, description, color, roles: [] };
        const message = await channel.send({ embeds: [buildPanelEmbed(interaction.guild, panel)] });
        await createPanel(interaction.guild.id, message.id, panel);

        await interaction.editReply(
          `✅ Reaction-role panel posted in <#${channel.id}>.\n` +
            `Message ID: \`${message.id}\`\n` +
            `Now add roles with \`/reactionrole-add message_id:${message.id} role:@SomeRole emoji:🎨\`.`
        );
      } catch (error) {
        console.error("Error posting reaction-role panel:", error);
        await interaction.editReply(
          "An error occurred posting the panel. Check that I can send messages and embed links in that channel."
        );
      }
      return;
    }

    // --- /reactionrole-add ---
    if (interaction.commandName === "reactionrole-add") {
      const messageId = interaction.options.getString("message_id", true).trim();
      const role = interaction.options.getRole("role", true);
      const emojiInput = interaction.options.getString("emoji", true).trim();

      const panel = await getPanel(interaction.guild.id, messageId);
      if (!panel) {
        await interaction.reply({
          content: "No reaction-role panel with that message ID exists in this server. Run `/reactionrole-setup` first.",
          ephemeral: true,
        });
        return;
      }

      if (role.id === interaction.guild.id) {
        await interaction.reply({ content: "You can't use @everyone as a reaction role.", ephemeral: true });
        return;
      }
      if (role.managed) {
        await interaction.reply({
          content: "That role belongs to a bot/integration and can't be assigned manually.",
          ephemeral: true,
        });
        return;
      }
      const botMember = interaction.guild.members.me;
      if (botMember.roles.highest.position <= role.position) {
        await interaction.reply({
          content: `My role must be above ${role} in the role list for me to grant it.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
        const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
        if (!message) {
          await deletePanel(interaction.guild.id, messageId);
          await interaction.editReply(
            "Couldn't find the panel message anymore (it may have been deleted) — I've stopped tracking it. Run `/reactionrole-setup` to create a new one."
          );
          return;
        }

        // React first so Discord validates/resolves the emoji for us, then
        // read back its canonical identity — more reliable than trying to
        // parse arbitrary user input into an emoji ID/name ourselves.
        const reaction = await message.react(emojiInput);
        const key = reaction.emoji.id ?? reaction.emoji.name;
        const display = reaction.emoji.toString();

        const roles = panel.roles.filter((r) => r.key !== key);
        roles.push({ key, display, roleId: role.id });

        await updatePanelRoles(interaction.guild.id, messageId, roles);
        await message.edit({ embeds: [buildPanelEmbed(interaction.guild, { ...panel, roles })] });

        await interaction.editReply(`✅ Reacting with ${display} on that panel now grants ${role}.`);
      } catch (error) {
        console.error("Error adding reaction role:", error);
        await interaction.editReply(
          "An error occurred — check that the emoji is valid (or from a server I'm in) and that I can add reactions/manage messages there."
        );
      }
      return;
    }

    // --- /reactionrole-remove ---
    if (interaction.commandName === "reactionrole-remove") {
      const messageId = interaction.options.getString("message_id", true).trim();
      const key = parseEmojiKey(interaction.options.getString("emoji", true));

      const panel = await getPanel(interaction.guild.id, messageId);
      if (!panel) {
        await interaction.reply({
          content: "No reaction-role panel with that message ID exists in this server.",
          ephemeral: true,
        });
        return;
      }

      const match = panel.roles.find((r) => r.key === key);
      if (!match) {
        await interaction.reply({
          content: "That panel doesn't have a role mapped to that emoji.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const roles = panel.roles.filter((r) => r.key !== key);
        await updatePanelRoles(interaction.guild.id, messageId, roles);

        const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
        const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
        if (message) {
          await message.edit({ embeds: [buildPanelEmbed(interaction.guild, { ...panel, roles })] });
          const existingReaction = message.reactions.resolve(match.key);
          if (existingReaction) await existingReaction.remove().catch(() => {});
        }

        await interaction.editReply(`✅ Removed the ${match.display} → <@&${match.roleId}> mapping.`);
      } catch (error) {
        console.error("Error removing reaction role:", error);
        await interaction.editReply("An error occurred removing that mapping.");
      }
      return;
    }
  });

  // --- Panel message deleted manually: stop tracking it ---
  client.on("messageDelete", async (message) => {
    if (!message.guildId) return;
    try {
      const panel = await getPanel(message.guildId, message.id);
      if (panel) await deletePanel(message.guildId, message.id);
    } catch (error) {
      console.error("Error cleaning up deleted reaction-role panel:", error);
    }
  });

  // --- Reaction added/removed: grant/revoke the mapped role ---
  async function handleReactionChange(reaction, user, granting) {
    if (user.bot) return;
    const guildId = reaction.message.guildId;
    if (!guildId) return;

    try {
      const panel = await getPanel(guildId, reaction.message.id);
      if (!panel) return;

      const key = reaction.emoji.id ?? reaction.emoji.name;
      const match = panel.roles.find((r) => r.key === key);
      if (!match) return;

      const guild = reaction.message.guild ?? (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) return;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      if (granting) {
        await member.roles.add(match.roleId);
      } else {
        await member.roles.remove(match.roleId);
      }
    } catch (error) {
      console.error("Error updating reaction role:", error);
    }
  }

  client.on("messageReactionAdd", (reaction, user) => handleReactionChange(reaction, user, true));
  client.on("messageReactionRemove", (reaction, user) => handleReactionChange(reaction, user, false));
}
