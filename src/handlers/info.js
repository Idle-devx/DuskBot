// Utility info commands: /userinfo, /serverinfo, /avatar. No permission
// checks — these only ever show public info, same as right-clicking a user
// or the server name in the Discord client itself.
import { EmbedBuilder } from "discord.js";

export function registerInfoHandlers(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "userinfo") {
      const targetUser = interaction.options.getUser("user") ?? interaction.user;
      // Falls back gracefully (no roles/join date fields) if the user left
      // the server between being mentioned and this fetch.
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(member && member.displayHexColor !== "#000000" ? member.displayHexColor : 0x5865f2)
        .setTitle(targetUser.tag)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "User ID", value: targetUser.id, inline: true },
          { name: "Account created", value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }
        );

      if (member) {
        const roles = member.roles.cache.filter((role) => role.id !== interaction.guild.id);
        embed.addFields(
          { name: "Joined server", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          {
            name: `Roles (${roles.size})`,
            value: roles.size ? roles.map((role) => `<@&${role.id}>`).join(", ") : "None",
          }
        );
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "serverinfo") {
      const guild = interaction.guild;
      const owner = await guild.fetchOwner().catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: "Owner", value: owner ? `<@${owner.id}>` : "Unknown", inline: true },
          { name: "Members", value: `${guild.memberCount}`, inline: true },
          { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
          { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
          {
            name: "Boost level",
            value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`,
            inline: true,
          },
          { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: `Server ID: ${guild.id}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === "avatar") {
      const targetUser = interaction.options.getUser("user") ?? interaction.user;
      const avatarUrl = targetUser.displayAvatarURL({ size: 1024 });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${targetUser.tag}'s avatar`)
        .setURL(avatarUrl)
        .setImage(avatarUrl);

      await interaction.reply({ embeds: [embed] });
    }
  });
}
