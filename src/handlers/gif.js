// /gif: downloads an attached video or image and converts it to a GIF
// with ffmpeg.
import { AttachmentBuilder } from "discord.js";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_INPUT_SIZE } from "../lib/constants.js";

ffmpeg.setFfmpegPath(ffmpegPath);

async function convertToGif(inputPath, outputPath, { duration, width, isStaticImage }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);

    // Static images need "-loop 1" so ffmpeg treats them as a continuous
    // video; without this, the conversion fails or produces an empty file.
    // Videos and animated GIFs don't need it.
    if (isStaticImage) {
      command.inputOptions(["-loop 1"]);
    }

    command
      .setStartTime(0)
      .duration(duration)
      .outputOptions([`-vf scale=${width}:-1:flags=lanczos,fps=12`])
      .toFormat("gif")
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

export function registerGifHandler(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "gif") return;

    const attachment = interaction.options.getAttachment("file", true);
    const duration = interaction.options.getNumber("duration") ?? 5;
    const width = interaction.options.getInteger("width") ?? 320;

    if (attachment.size > MAX_INPUT_SIZE) {
      await interaction.reply({
        content: "The file is too large (25 MB max).",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    let tempDir;
    try {
      tempDir = await mkdtemp(join(tmpdir(), "gifbot-"));
      const extension = attachment.name.split(".").pop() || "input";
      const inputPath = join(tempDir, `input.${extension}`);
      const outputPath = join(tempDir, "output.gif");

      const response = await fetch(attachment.url);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(inputPath, buffer);

      // Animated GIFs and videos are already "continuous", they don't need
      // -loop 1; only static images (png, jpg, webp, etc.) need it.
      const isStaticImage =
        (attachment.contentType?.startsWith("image/") ?? false) &&
        attachment.contentType !== "image/gif";

      await convertToGif(inputPath, outputPath, { duration, width, isStaticImage });

      const gifAttachment = new AttachmentBuilder(outputPath, { name: "result.gif" });
      await interaction.editReply({ files: [gifAttachment] });
    } catch (error) {
      console.error("Error converting to GIF:", error);
      await interaction.editReply(
        "An error occurred converting the file. Make sure it's a valid video or image."
      );
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });
}
