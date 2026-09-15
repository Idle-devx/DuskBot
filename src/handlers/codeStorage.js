// Per-project code snippet storage, isolated per guild
// (data/codigos/<guildId>/<project>/<name>.txt).
import { AttachmentBuilder, PermissionFlagsBits } from "discord.js";
import { writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, MAX_INPUT_SIZE } from "../lib/constants.js";
import { getAccessConfig } from "../lib/accessConfig.js";

// Default role name used for /code when a server hasn't set a custom
// code_role via /access-setup. Adjust it if you want a different default.
const SCRIPTER_ROLE_NAME = "Scripter";

// Base folder. Each guild gets its own subfolder so files, projects, and
// autocomplete suggestions never cross between servers.
const CODE_DIR = join(DATA_DIR, "codigos");

function guildCodeDir(guildId) {
  return join(CODE_DIR, guildId);
}

async function ensureGuildCodeDir(guildId) {
  const dir = guildCodeDir(guildId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

// Admins/Mods can always save, plus any extra role a server configured via
// /access-setup (save_code_roles). Also gates /delete-code.
function canSaveCode(member, accessConfig = {}) {
  if (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }
  return (accessConfig.saveCodeRoleIds ?? []).some((id) => member.roles.cache.has(id));
}

// Anyone who can save (Admins/Mods/configured save_code_roles) can also
// retrieve. Otherwise: any of the server's configured code_roles, or the
// default "Scripter" role name if none have been set.
function canRetrieveCode(member, accessConfig = {}) {
  if (canSaveCode(member, accessConfig)) return true;

  if (accessConfig.codeRoleIds?.length) {
    return accessConfig.codeRoleIds.some((id) => member.roles.cache.has(id));
  }

  return member.roles.cache.some((role) => role.name === SCRIPTER_ROLE_NAME);
}

// Returns the list of subfolders (projects) that exist for this guild.
async function listProjects(guildId) {
  const dir = guildCodeDir(guildId);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// Returns the list of files (without extension) inside a project for this guild.
async function listFiles(guildId, project) {
  const projectDir = join(guildCodeDir(guildId), project);
  if (!existsSync(projectDir)) return [];
  const entries = await readdir(projectDir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name.replace(/\.txt$/, ""));
}

// Sanitizes project/file names so they can't be used to escape CODE_DIR
// (e.g. "../../etc"), include odd path characters, or (on NTFS) address an
// Alternate Data Stream via a colon (e.g. "x:hidden" silently writing into
// a hidden stream instead of a normal file). Returns null if nothing usable
// is left after stripping — callers must check for that instead of
// silently writing into the guild's root code folder.
function sanitizeName(name) {
  const cleaned = name
    .replace(/[\\/]/g, "-")
    .replace(/\.\./g, "-")
    .replace(/[:*?"<>|\x00-\x1f]/g, "-")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function registerCodeStorageHandlers(client) {
  // --- Autocomplete for /save-code, /delete-code, and /code ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isAutocomplete()) return;
    if (!["save-code", "delete-code", "code"].includes(interaction.commandName)) return;

    const focused = interaction.options.getFocused(true);
    const guildId = interaction.guild.id;

    try {
      let options = [];

      if (focused.name === "project") {
        const projects = await listProjects(guildId);
        options = projects.filter((p) => p.startsWith(focused.value)).slice(0, 25);
      }

      if (focused.name === "name" && ["code", "delete-code"].includes(interaction.commandName)) {
        const project = interaction.options.getString("project") ?? "";
        const files = await listFiles(guildId, project);
        options = files.filter((a) => a.startsWith(focused.value)).slice(0, 25);
      }

      await interaction.respond(options.map((value) => ({ name: value, value })));
    } catch (error) {
      console.error("Error in code autocomplete:", error);
      await interaction.respond([]);
    }
  });

  // --- /save-code ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "save-code") return;

    const accessConfig = await getAccessConfig(interaction.guild.id);
    if (!canSaveCode(interaction.member, accessConfig)) {
      await interaction.reply({ content: "You don't have permission to save code.", ephemeral: true });
      return;
    }

    const project = sanitizeName(interaction.options.getString("project", true));
    const name = sanitizeName(interaction.options.getString("name", true));
    const file = interaction.options.getAttachment("file");
    const content = interaction.options.getString("content");

    if (!project || !name) {
      await interaction.reply({
        content: "`project` and `name` need at least one non-slash, non-dot character.",
        ephemeral: true,
      });
      return;
    }

    if (!file && !content) {
      await interaction.reply({
        content: "You must attach a file or write content in the `content` option.",
        ephemeral: true,
      });
      return;
    }

    // Unlike a plain-text `content` option (capped by Discord itself), an
    // attachment's size isn't bounded anywhere else — cap it the same way
    // /gif does, before downloading it into memory.
    if (file && file.size > MAX_INPUT_SIZE) {
      await interaction.reply({
        content: "The file is too large (25 MB max).",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const guildDir = await ensureGuildCodeDir(interaction.guild.id);
      const projectDir = join(guildDir, project);
      await mkdir(projectDir, { recursive: true });

      const filePath = join(projectDir, `${name}.txt`);

      if (file) {
        const response = await fetch(file.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(filePath, buffer);
      } else {
        await writeFile(filePath, content, "utf-8");
      }

      await interaction.editReply(`✅ Saved as \`${project}/${name}\`.`);
    } catch (error) {
      console.error("Error saving code:", error);
      await interaction.editReply("An error occurred saving the file.");
    }
  });

  // --- /delete-code ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "delete-code") return;

    const accessConfig = await getAccessConfig(interaction.guild.id);
    if (!canSaveCode(interaction.member, accessConfig)) {
      await interaction.reply({ content: "You don't have permission to delete code.", ephemeral: true });
      return;
    }

    const project = sanitizeName(interaction.options.getString("project", true));
    const name = interaction.options.getString("name");

    if (!project) {
      await interaction.reply({
        content: "`project` needs at least one non-slash, non-dot character.",
        ephemeral: true,
      });
      return;
    }

    const guildDir = guildCodeDir(interaction.guild.id);
    const projectDir = join(guildDir, project);

    await interaction.deferReply({ ephemeral: true });

    try {
      if (!name) {
        // No file name given: delete the whole project folder.
        if (!existsSync(projectDir)) {
          await interaction.editReply(`There's no project called \`${project}\`.`);
          return;
        }
        await rm(projectDir, { recursive: true, force: true });
        await interaction.editReply(`✅ Deleted the whole project \`${project}\`.`);
        return;
      }

      const safeName = sanitizeName(name);
      if (!safeName) {
        await interaction.editReply("`name` needs at least one non-slash, non-dot character.");
        return;
      }

      const filePath = join(projectDir, `${safeName}.txt`);
      if (!existsSync(filePath)) {
        await interaction.editReply(`Couldn't find anything saved as \`${project}/${safeName}\`.`);
        return;
      }
      await rm(filePath, { force: true });
      await interaction.editReply(`✅ Deleted \`${project}/${safeName}\`.`);
    } catch (error) {
      console.error("Error deleting code:", error);
      await interaction.editReply("An error occurred deleting that.");
    }
  });

  // --- /code ---
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "code") return;

    const accessConfig = await getAccessConfig(interaction.guild.id);
    if (!canRetrieveCode(interaction.member, accessConfig)) {
      const roleHint = accessConfig.codeRoleIds?.length
        ? accessConfig.codeRoleIds.map((id) => `<@&${id}>`).join(", ")
        : `the "${SCRIPTER_ROLE_NAME}" role`;
      await interaction.reply({
        content: `You don't have permission to use this command (requires ${roleHint}).`,
        ephemeral: true,
      });
      return;
    }

    const project = sanitizeName(interaction.options.getString("project", true));
    const name = sanitizeName(interaction.options.getString("name", true));

    if (!project || !name) {
      await interaction.reply({
        content: "`project` and `name` need at least one non-slash, non-dot character.",
        ephemeral: true,
      });
      return;
    }

    const filePath = join(guildCodeDir(interaction.guild.id), project, `${name}.txt`);

    if (!existsSync(filePath)) {
      await interaction.reply({
        content: `Couldn't find anything saved as \`${project}/${name}\`.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ files: [new AttachmentBuilder(filePath, { name: `${name}.txt` })] });
  });
}
