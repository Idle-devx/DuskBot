// Slash command definitions.
//
// All commands, including save-code/code, are registered GLOBALLY
// (deploy-commands.js) and available on every server the bot is on.
//
// save-code/code used to be restricted to a single "home" server because
// the file storage backing them was one shared folder on disk, not
// isolated per guild — a mod on any server could've read or overwritten
// another server's files. That's fixed now: index.js stores each guild's
// files under its own subfolder (codigos/<guildId>/...), so every server
// only ever touches its own data.
//
// Access to moderation commands, save-code/delete-code, and code is now
// fully controlled in index.js (see canSaveCode/canRetrieveCode/
// hasModerationAccess), not via .setDefaultMemberPermissions() here. That's
// intentional: it lets each server configure its OWN extra role for each
// of those (via /access-setup) on top of the usual Discord permissions,
// instead of being stuck with whatever a fixed permission or a hardcoded
// role name ("Scripter") assumes. The trade-off is that these commands
// show up as usable to everyone in Discord's command list/autocomplete —
// unauthorized users just get an in-code "you don't have permission"
// reply instead of the command being hidden from them.
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";

export const allCommands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the AI a question")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What you want to ask")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("gif")
    .setDescription("Convert an attached video or image to GIF")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("The video or image you want to convert")
        .setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("duration")
        .setDescription("Seconds to convert from the start (default: 5, max: 15)")
        .setMinValue(1)
        .setMaxValue(15)
    )
    .addIntegerOption((option) =>
      option
        .setName("width")
        .setDescription("Width in pixels of the GIF (default: 320)")
        .setMinValue(64)
        .setMaxValue(720)
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bans a user from the server")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to ban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the ban")
    )
    .addIntegerOption((option) =>
      option
        .setName("delete_days")
        .setDescription("Days of messages to delete (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
    ),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kicks a user from the server")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick")
    ),
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Bans and immediately unbans to wipe recent messages")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to softban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the softban")
    )
    .addIntegerOption((option) =>
      option
        .setName("delete_days")
        .setDescription("Days of messages to delete (default 1)")
        .setMinValue(0)
        .setMaxValue(7)
    ),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Times out a user for a set duration")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to mute").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Mute duration in minutes (max 40320 = 28 days)")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the mute")
    ),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Removes a user's timeout")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to unmute").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unbans a user using their ID")
    .addStringOption((option) =>
      option
        .setName("user_id")
        .setDescription("Numeric ID of the user to unban")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the unban")
    ),
  new SlashCommandBuilder()
    .setName("forum")
    .setDescription("Creates a post in a forum channel")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Forum channel where the post will be created")
        .addChannelTypes(ChannelType.GuildForum)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Title of the post")
        .setMaxLength(100)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("content")
        .setDescription("Post text (max 2000 characters)")
        .setMaxLength(2000)
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("image1").setDescription("Optional image for the post")
    )
    .addAttachmentOption((option) =>
      option.setName("image2").setDescription("Another optional image")
    )
    .addAttachmentOption((option) =>
      option.setName("image3").setDescription("Another optional image")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Sets up (or updates) the ticket panel")
    .addChannelOption((option) =>
      option
        .setName("panel_channel")
        .setDescription("Channel where the 'Open Ticket' button will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription("Category where new ticket channels will be created")
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel where ticket open/close logs and transcripts will be sent")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addRoleOption((option) =>
      option
        .setName("support_role")
        .setDescription("Role that can see and manage all tickets (besides Admins)")
    )
    .addIntegerOption((option) =>
      option
        .setName("alert_hours")
        .setDescription("Hours a ticket can stay open before an inactivity alert is posted (default 3)")
        .setMinValue(1)
        .setMaxValue(720)
    )
    .addIntegerOption((option) =>
      option
        .setName("inactivity_hours")
        .setDescription("Hours with zero activity before a ticket auto-closes (default 24)")
        .setMinValue(1)
        .setMaxValue(720)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("modlogs-setup")
    .setDescription("Sets the channel where ban/kick/mute/unban logs are sent")
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel where moderation logs will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("verify-setup")
    .setDescription("Sets up (or updates) the member verification panel")
    .addChannelOption((option) =>
      option
        .setName("panel_channel")
        .setDescription("Channel where the 'Verify' button will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option
        .setName("verified_role")
        .setDescription("Role granted to a member when they verify")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("kick_hours")
        .setDescription("Hours before an unverified member is automatically kicked (default 24)")
        .setMinValue(1)
        .setMaxValue(720)
    )
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel where join/verify/kick logs will be sent")
        .addChannelTypes(ChannelType.GuildText)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  // save-code/code/delete-code: file storage is isolated per guild in
  // index.js (codigos/<guildId>/...), so these are safe to register
  // globally alongside everything else — see the note above. Access is
  // fully controlled in index.js (Mods/Admins, plus whatever role each
  // server configures via /access-setup), not by setDefaultMemberPermissions.
  new SlashCommandBuilder()
    .setName("save-code")
    .setDescription("Saves a code file into a project folder")
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Name of the project folder")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("File name (without extension)")
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option.setName("file").setDescription("File to save")
    )
    .addStringOption((option) =>
      option.setName("content").setDescription("Plain text content")
    ),
  new SlashCommandBuilder()
    .setName("delete-code")
    .setDescription("Deletes a saved file, or an entire project folder")
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Name of the project folder")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Name of the file to delete (omit to delete the WHOLE project)")
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("code")
    .setDescription("Retrieves a saved code file")
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Name of the project folder")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Name of the saved file")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("access-setup")
    .setDescription("Configures per-server roles for moderation and code-storage commands")
    .addRoleOption((option) =>
      option
        .setName("moderation_role")
        .setDescription("Role allowed to use ban/kick/softban/mute/unmute/unban, besides the matching Discord permission")
    )
    .addRoleOption((option) =>
      option
        .setName("save_code_role")
        .setDescription("Role allowed to use /save-code and /delete-code, besides Mods/Admins")
    )
    .addRoleOption((option) =>
      option
        .setName("code_role")
        .setDescription("Role required to use /code (overrides the default 'Scripter' role name)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_moderation_role")
        .setDescription("Remove the configured moderation role (revert to Discord permissions only)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_save_code_role")
        .setDescription("Remove the configured save-code role (revert to Mods/Admins only)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_code_role")
        .setDescription("Remove the configured code role (revert to the default 'Scripter' role name)")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((command) => command.toJSON());
