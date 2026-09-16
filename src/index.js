import { Client, GatewayIntentBits, Partials } from "discord.js";
import "dotenv/config";

import { registerAskHandler } from "./handlers/ask.js";
import { registerGifHandler } from "./handlers/gif.js";
import { registerGifReplyHandler } from "./handlers/gifReplies.js";
import { registerModerationHandlers } from "./handlers/moderation.js";
import { registerForumHandler } from "./handlers/forum.js";
import { registerCodeStorageHandlers } from "./handlers/codeStorage.js";
import { registerTicketHandlers } from "./handlers/tickets.js";
import { registerVerifyHandlers } from "./handlers/verify.js";
import { registerAntiRaidHandlers } from "./handlers/antiraid.js";
import { registerReactionRoleHandlers } from "./handlers/reactionRoles.js";
import { registerVoiceCreateHandlers } from "./handlers/voiceCreate.js";

const client = new Client({
  // GuildMembers is required for the verification system (handlers/verify.js)
  // to see guildMemberAdd/guildMemberRemove events. It's a "privileged"
  // intent: you must also turn it on for the app in the Discord Developer
  // Portal (Bot > Privileged Gateway Intents > Server Members Intent).
  //
  // GuildMessageReactions is required for the reaction-role system
  // (handlers/reactionRoles.js) to see messageReactionAdd/Remove events.
  // GuildVoiceStates is required for the join-to-create voice channel
  // system (handlers/voiceCreate.js) to see voiceStateUpdate events at all,
  // and for VoiceChannel#members to be populated. Neither is privileged, so
  // no toggle is needed in the Developer Portal.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Reaction-role panels are often posted long before someone reacts to
  // them, so by the time a reaction comes in the message/reaction usually
  // isn't in the bot's cache anymore. Without these partials, discord.js
  // silently drops messageReactionAdd/Remove events for anything uncached
  // instead of emitting a partial event we can still read the IDs off of.
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// Every feature module registers its own "interactionCreate" (and, for a
// few, "messageCreate"/"guildMemberAdd"/etc.) listener by design — that's
// what keeps each feature self-contained in its own file instead of one
// giant dispatcher. With 11 handler modules that adds up to more than
// Node's default limit of 10 listeners per event, which logs a
// MaxListenersExceededWarning even though nothing is actually leaking
// (these are permanent listeners added once at startup, never repeatedly).
// Raise the limit instead of silencing the warning outright, so a real
// leak introduced later would still get flagged.
client.setMaxListeners(20);

registerAskHandler(client);
registerGifHandler(client);
registerGifReplyHandler(client);
registerModerationHandlers(client);
registerForumHandler(client);
registerCodeStorageHandlers(client);
registerTicketHandlers(client);
registerVerifyHandlers(client);
registerAntiRaidHandlers(client);
registerReactionRoleHandlers(client);
registerVoiceCreateHandlers(client);

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
