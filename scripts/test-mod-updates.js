// Offline test for the mod update checker (src/handlers/modUpdates.js).
// No Discord connection, no Nexus key and no network: Nexus is replaced by
// a stand-in that answers from a table.
// Run with: node scripts/test-mod-updates.js
import assert from "node:assert/strict";
import {
  parseModUrl,
  modPageUrl,
  pickChangelog,
  findUpdates,
  buildUpdateEmbed,
  explainNexusError,
} from "../src/handlers/modUpdates.js";

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.log(`  ❌ ${name}\n     ${error.message}`);
    process.exitCode = 1;
  }
}

function fakeNexus(mods, changelogs = {}, calls = []) {
  return {
    getMod: async (mod) => {
      calls.push(`mod ${mod.domain}/${mod.id}`);
      const answer = mods[`${mod.domain}/${mod.id}`];
      if (answer instanceof Error) throw answer;
      if (!answer) throw Object.assign(new Error("Not found"), { status: 404 });
      return answer;
    },
    getChangelogs: async (mod) => {
      calls.push(`changelog ${mod.domain}/${mod.id}`);
      const answer = changelogs[`${mod.domain}/${mod.id}`];
      if (answer instanceof Error) throw answer;
      return answer ?? {};
    },
  };
}

console.log("Mod update checker:\n");

await check("reads a plain mod address", () => {
  assert.deepEqual(parseModUrl("https://www.nexusmods.com/tcgcardshopsimulator/mods/577"), {
    domain: "tcgcardshopsimulator",
    id: 577,
    key: "tcgcardshopsimulator/577",
  });
});

await check("reads an address with a tab, a query, or the /games/ form", () => {
  assert.equal(parseModUrl("https://www.nexusmods.com/balatro/mods/12?tab=files").key, "balatro/12");
  assert.equal(parseModUrl("  nexusmods.com/PEAK/mods/9/  ").key, "peak/9");
  assert.equal(parseModUrl("https://www.nexusmods.com/games/peak/mods/31?tab=posts").key, "peak/31");
});

await check("refuses things that are not a mod page", () => {
  for (const text of ["", "hello", "https://www.nexusmods.com/peak", "https://www.nexusmods.com/users/123", "https://example.com/peak/mods/3", null]) {
    assert.equal(parseModUrl(text), null, `accepted: ${text}`);
  }
});

await check("builds the page address back", () => {
  assert.equal(modPageUrl({ domain: "peak", id: 9 }), "https://www.nexusmods.com/peak/mods/9");
});

await check("changelog: picks the version, cleans HTML, bullets every line", () => {
  const text = pickChangelog({ "1.0.0": ["old"], "1.1.0": ["New Cards tab<br />second line", "- already a bullet", "Tom &amp; Jerry &lt;3", "  "] }, "1.1.0");
  assert.equal(text, "- New Cards tab\nsecond line\n- already a bullet\n- Tom & Jerry <3");
});

await check("changelog: nothing for a version Nexus has no notes on", () => {
  assert.equal(pickChangelog({ "1.0.0": ["x"] }, "2.0.0"), null);
  assert.equal(pickChangelog(null, "1.0.0"), null);
  assert.equal(pickChangelog({ "1.0.0": [] }, "1.0.0"), null);
});

await check("changelog: a very long one is cut on a line and marked", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `change number ${i} with some words after it`);
  const text = pickChangelog({ "9.9": lines }, "9.9");
  assert.ok(text.length <= 3510, `length ${text.length}`);
  assert.ok(text.endsWith("\n…"));
  assert.ok(!text.slice(0, -2).endsWith("wor"), "cut in the middle of a line");
});

await check("first look at a mod records its version and announces nothing", async () => {
  const mods = { "peak/9": { domain: "peak", id: 9, name: "Summit", version: null } };
  const { updates, patches } = await findUpdates(mods, fakeNexus({ "peak/9": { name: "Summit", version: "1.0.0" } }));
  assert.equal(updates.length, 0);
  assert.equal(patches["peak/9"].version, "1.0.0");
});

await check("same version: no announcement", async () => {
  const mods = { "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" } };
  const calls = [];
  const { updates, patches } = await findUpdates(mods, fakeNexus({ "peak/9": { name: "Summit", version: "1.0.0" } }, {}, calls));
  assert.equal(updates.length, 0);
  assert.equal(patches["peak/9"].version, undefined);
  assert.deepEqual(calls, ["mod peak/9"], "the changelog was fetched for nothing");
});

await check("new version: one announcement, with that version's changelog", async () => {
  const mods = {
    "tcgcardshopsimulator/600": { domain: "tcgcardshopsimulator", id: 600, name: "God Pack", version: "1.0.0" },
    "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" },
  };
  const nexus = fakeNexus(
    {
      "tcgcardshopsimulator/600": { name: "God Pack - Cheat Menu", version: "1.1.0", summary: "The cheat menu", mod_downloads: 1234, picture_url: "https://example.com/a.png" },
      "peak/9": { name: "Summit", version: "1.0.0" },
    },
    { "tcgcardshopsimulator/600": { "1.0.0": ["First release."], "1.1.0": ["New Cards tab", "No bills"] } }
  );
  const { updates, patches, stop } = await findUpdates(mods, nexus);
  assert.equal(stop, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].previous, "1.0.0");
  assert.equal(updates[0].info.version, "1.1.0");
  assert.equal(updates[0].mod.name, "God Pack - Cheat Menu");
  assert.equal(updates[0].changelog, "- New Cards tab\n- No bills");
  assert.equal(patches["tcgcardshopsimulator/600"].version, "1.1.0");
});

await check("it is announced once: the next round with the saved version is quiet", async () => {
  const nexus = fakeNexus({ "peak/9": { name: "Summit", version: "1.1.0" } });
  let mods = { "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" } };
  const first = await findUpdates(mods, nexus);
  mods = { "peak/9": { ...mods["peak/9"], ...first.patches["peak/9"] } };
  const second = await findUpdates(mods, nexus);
  assert.equal(first.updates.length, 1);
  assert.equal(second.updates.length, 0);
});

await check("no changelog on Nexus: still announced, without one", async () => {
  const mods = { "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" } };
  const nexus = fakeNexus({ "peak/9": { name: "Summit", version: "1.1.0" } }, { "peak/9": new Error("boom") });
  const { updates } = await findUpdates(mods, nexus);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].changelog, null);
});

await check("a mod that fails does not stop the others, and the reason is kept", async () => {
  const mods = {
    "peak/1": { domain: "peak", id: 1, name: "Gone", version: "1.0" },
    "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" },
  };
  const { updates, patches, stop } = await findUpdates(mods, fakeNexus({ "peak/9": { name: "Summit", version: "2.0.0" } }));
  assert.equal(stop, false);
  assert.equal(updates.length, 1);
  assert.match(patches["peak/1"].lastError, /no mod at that address/);
  assert.equal(patches["peak/1"].version, undefined, "a failed mod must keep its saved version");
  assert.equal(patches["peak/9"].lastError, null);
});

await check("rate limit or a bad key stops the round at once", async () => {
  for (const status of [429, 401]) {
    const calls = [];
    const mods = {
      "peak/1": { domain: "peak", id: 1, name: "A", version: "1.0" },
      "peak/2": { domain: "peak", id: 2, name: "B", version: "1.0" },
    };
    const nexus = fakeNexus({ "peak/1": Object.assign(new Error("nope"), { status }), "peak/2": { name: "B", version: "2.0" } }, {}, calls);
    const { updates, stop } = await findUpdates(mods, nexus);
    assert.equal(stop, true, `status ${status} did not stop the round`);
    assert.equal(updates.length, 0);
    assert.deepEqual(calls, ["mod peak/1"]);
  }
});

await check("a mod watched by two servers is asked for once per round", async () => {
  const calls = [];
  const nexus = fakeNexus({ "peak/9": { name: "Summit", version: "1.1.0" } }, {}, calls);
  const cache = new Map();
  const a = await findUpdates({ "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" } }, nexus, cache);
  const b = await findUpdates({ "peak/9": { domain: "peak", id: 9, name: "Summit", version: "1.0.0" } }, nexus, cache);
  assert.equal(a.updates.length, 1);
  assert.equal(b.updates.length, 1);
  assert.equal(calls.filter((c) => c === "mod peak/9").length, 1);
});

await check("the announcement card has the name, both versions, the changes and the link", () => {
  const embed = buildUpdateEmbed({
    mod: { domain: "tcgcardshopsimulator", id: 600, name: "God Pack" },
    previous: "1.0.0",
    info: { version: "1.1.0", summary: "The cheat menu", mod_downloads: 12345, picture_url: "https://example.com/a.png" },
    changelog: "- New Cards tab",
  }).toJSON();
  assert.equal(embed.title, "God Pack 1.1.0");
  assert.equal(embed.url, "https://www.nexusmods.com/tcgcardshopsimulator/mods/600");
  assert.equal(embed.description, "- New Cards tab");
  assert.equal(embed.thumbnail.url, "https://example.com/a.png");
  const fields = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.equal(fields.Version, "1.0.0 → **1.1.0**");
  assert.equal(fields.Downloads, "12,345");
  assert.match(fields["Get it"], /mods\/600\?tab=files/);
});

await check("the card falls back to the mod's summary when there is no changelog", () => {
  const embed = buildUpdateEmbed({
    mod: { domain: "peak", id: 9, name: "Summit" },
    previous: "1.0.0",
    info: { version: "1.1.0", summary: "A cheat menu<br />for PEAK" },
    changelog: null,
  }).toJSON();
  assert.equal(embed.description, "A cheat menu\nfor PEAK");
  assert.equal(embed.author, undefined);
});

await check("error messages are plain about what went wrong", () => {
  assert.match(explainNexusError({ status: 401 }), /API key/);
  assert.match(explainNexusError({ status: 404 }), /no mod/);
  assert.match(explainNexusError({ status: 429 }), /rate-limiting/);
  assert.match(explainNexusError(new Error("socket hang up")), /socket hang up/);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ", 0 failed"}`);
