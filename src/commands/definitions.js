// Slash command definitions.
//
// All commands, including save-code/code, are registered GLOBALLY
// (scripts/deploy-commands.js) and available on every server the bot is on.
//
// save-code/code used to be restricted to a single "home" server because
// the file storage backing them was one shared folder on disk, not
// isolated per guild — a mod on any server could've read or overwritten
// another server's files. That's fixed: src/handlers/codeStorage.js stores
// each guild's files under its own subfolder (data/codigos/<guildId>/...),
// so every server only ever touches its own data.
//
// Access to moderation commands, save-code/delete-code, and code is fully
// controlled in src/handlers/*.js (see canSaveCode/canRetrieveCode/
// hasAccess), not via .setDefaultMemberPermissions() here. That's
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
    .addStringOption((option) =>
      option
        .setName("support_roles")
        .setDescription("Mention every role that can manage tickets, e.g. @Staff @Helper (leave empty for none)")
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
    .setName("close")
    .setDescription("Closes the current ticket (must be used inside a ticket channel)"),
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
    .addStringOption((option) =>
      option
        .setName("moderation_roles")
        .setDescription("Mention every role allowed to use ban/kick/softban/mute/unmute/unban, e.g. @Mod @Helper")
    )
    .addStringOption((option) =>
      option
        .setName("save_code_roles")
        .setDescription("Mention every role allowed to use /save-code and /delete-code, besides Mods/Admins")
    )
    .addStringOption((option) =>
      option
        .setName("code_roles")
        .setDescription("Mention every role allowed to use /code (overrides the default 'Scripter' role name)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_moderation_roles")
        .setDescription("Remove the configured moderation roles (revert to Discord permissions only)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_save_code_roles")
        .setDescription("Remove the configured save-code roles (revert to Mods/Admins only)")
    )
    .addBooleanOption((option) =>
      option
        .setName("clear_code_roles")
        .setDescription("Remove the configured code roles (revert to the default 'Scripter' role name)")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("antiraid-setup")
    .setDescription("Configures automatic lockdown when a burst of members joins")
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel where raid alerts and lockdown logs will be sent")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("join_threshold")
        .setDescription("How many joins within the time window trigger a lockdown (default 5)")
        .setMinValue(2)
        .setMaxValue(100)
    )
    .addIntegerOption((option) =>
      option
        .setName("time_window_seconds")
        .setDescription("Time window in seconds to count joins (default 10)")
        .setMinValue(2)
        .setMaxValue(300)
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("What to do to members who joined during the burst (default kick)")
        .addChoices({ name: "Kick", value: "kick" }, { name: "Ban", value: "ban" })
    )
    .addIntegerOption((option) =>
      option
        .setName("lockdown_minutes")
        .setDescription("How long to keep verification raised and invites revoked (default 10)")
        .setMinValue(1)
        .setMaxValue(1440)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("voicecreate-setup")
    .setDescription("Sets up (or disables) join-to-create personal voice channels")
    .addChannelOption((option) =>
      option
        .setName("trigger_channel")
        .setDescription("Voice channel that, when joined, creates a new personal voice channel")
        .addChannelTypes(ChannelType.GuildVoice)
    )
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription("Category where new channels are created (default: same as the trigger channel)")
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .addStringOption((option) =>
      option
        .setName("name_template")
        .setDescription("Name for new channels, must include {user} (default: '🔊 {user}')")
        .setMaxLength(100)
    )
    .addIntegerOption((option) =>
      option
        .setName("user_limit")
        .setDescription("Max users per created channel (default: 0 = unlimited)")
        .setMinValue(0)
        .setMaxValue(99)
    )
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel where channel creation/deletion is logged")
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption((option) =>
      option.setName("disable").setDescription("Disable join-to-create voice channels for this server")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("reactionrole-setup")
    .setDescription("Posts a new reaction-role panel embed")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel where the panel will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Embed title (default: '🎭 Reaction Roles')")
        .setMaxLength(256)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Intro text shown above the role list (default text provided)")
        .setMaxLength(1000)
    )
    .addStringOption((option) =>
      option
        .setName("color")
        .setDescription("Hex color for the embed, e.g. #5865F2 (default: Discord blurple)")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("reactionrole-add")
    .setDescription("Adds (or updates) a role/emoji pair on an existing reaction-role panel")
    .addStringOption((option) =>
      option
        .setName("message_id")
        .setDescription("ID of the panel message (right-click it > Copy Message ID)")
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to grant when someone reacts with the emoji").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("emoji")
        .setDescription("Emoji to react with (a default emoji, or a custom one from a server I'm in)")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("reactionrole-remove")
    .setDescription("Removes a role/emoji pair from an existing reaction-role panel")
    .addStringOption((option) =>
      option.setName("message_id").setDescription("ID of the panel message").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("emoji").setDescription("Emoji whose mapping should be removed").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((command) => command.toJSON());
