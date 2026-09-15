// Shared helper for reading/writing the small per-feature JSON config and
// state files (moderation log config, access roles, ticket state, verify
// state, anti-raid config, etc).
//
// Every previous version of this bot had each feature module (index.js,
// tickets.js, verify.js, antiraid.js) copy-paste its own loadJSON/saveJSON
// and do a plain read-modify-write. That's a real race condition: two
// concurrent updates to the same file (e.g. two /access-setup runs, or a
// guildMemberAdd firing while /verify-setup is being saved) can interleave
// and one write silently clobbers the other, because the whole file gets
// rewritten from a stale in-memory read.
//
// updateJSON() fixes this by serializing every read-modify-write against
// the same file path through a promise chain ("mutex"). Everything in this
// bot runs in a single Node process, so this is enough to make concurrent
// updates to one file safe without needing a real file lock or a database.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const locks = new Map(); // absolute path -> promise chain tail

async function loadJSON(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

async function saveJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

// Runs `mutator(data)` with the full parsed contents of the JSON file at
// `path`, then persists whatever `data` looks like afterwards (the mutator
// is expected to mutate `data` in place, e.g. `data[guildId] = {...}`).
// Returns whatever `mutator` returns. Guaranteed to run after every
// previously-queued operation on the same path has finished, and to block
// any operation queued after it until it's done — so reads see every prior
// write, and writes can never race each other.
export function updateJSON(path, mutator) {
  const previous = locks.get(path) ?? Promise.resolve();

  const run = previous.then(
    async () => {
      const data = await loadJSON(path);
      const result = await mutator(data);
      await saveJSON(path, data);
      return result;
    },
    async () => {
      // A prior operation on this path threw — don't let that poison the
      // queue forever, just retry from a fresh read.
      const data = await loadJSON(path);
      const result = await mutator(data);
      await saveJSON(path, data);
      return result;
    }
  );

  // Keep the chain alive even if this operation throws, so the *next*
  // queued operation still runs (it starts from a fresh read either way).
  locks.set(
    path,
    run.catch(() => {})
  );

  return run;
}

// Read-only helper for callers that just need the current contents (still
// queued behind any pending writes to the same path, so it never reads a
// half-written state).
export function readJSON(path) {
  return updateJSON(path, (data) => structuredClone(data));
}

// Convenience for the very common "per-guild partial update" shape used by
// almost every feature in this bot.
export async function getGuildValue(path, guildId, fallback = null) {
  const data = await readJSON(path);
  return data[guildId] ?? fallback;
}

export async function setGuildValue(path, guildId, partial) {
  return updateJSON(path, (data) => {
    data[guildId] = { ...(data[guildId] ?? {}), ...partial };
    return data[guildId];
  });
}
