// /forum: creates a post in a forum channel, with up to 3 optional images.
import { ChannelType } from "discord.js";

export function registerForumHandler(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "forum") return;

    const channel = interaction.options.getChannel("channel", true);
    const title = interaction.options.getString("title", true);
    const content = interaction.options.getString("content", true);
    const images = [
      interaction.options.getAttachment("image1"),
      interaction.options.getAttachment("image2"),
      interaction.options.getAttachment("image3"),
    ].filter(Boolean);

    await interaction.deferReply({ ephemeral: true });

    if (channel.type !== ChannelType.GuildForum) {
      await interaction.editReply("The selected channel isn't a forum channel.");
      return;
    }

    try {
      const thread = await channel.threads.create({
        name: title,
        message: {
          content: content,
          files: images.map((attachment) => attachment.url),
        },
      });

      await interaction.editReply(`✅ Post created: ${thread.url}`);
    } catch (error) {
      console.error("Error creating forum post:", error);
      const message =
        error.code === 50013
          ? "I don't have enough permissions to post there (check that I can create threads and send messages in that forum)."
          : "An error occurred creating the post. If the forum requires mandatory tags, this command doesn't support those yet.";
      await interaction.editReply(message);
    }
  });
}
