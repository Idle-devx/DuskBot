// Offline test for the verified-member welcome (src/handlers/verify.js).
// No Discord connection: only the functions that build the message.
// Run with: node scripts/test-verify-welcome.js
import assert from "node:assert/strict";
import {
  buildWelcomeText,
  buildWelcomeMessage,
  mentionFor,
  DEFAULT_WELCOME,
  WELCOME_MAX_LENGTH,
} from "../src/handlers/verify.js";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.log(`  ❌ ${name}\n     ${error.message}`);
    process.exitCode = 1;
  }
}

const USER = "111111111111111111";
const HELPER = "222222222222222222";

console.log("verify-welcome");

check("built-in text names the new member and the helper", () => {
  const text = buildWelcomeText({ template: null, userId: USER, helperMention: `<@${HELPER}>` });
  assert.equal(
    text,
    `Welcome <@${USER}>, feel free to tag <@${HELPER}> if you have any issue or error, or if you want a cheat menu for any offline game or slop game.`
  );
});

check("no placeholder is left in the text", () => {
  const text = buildWelcomeText({ template: null, userId: USER, helperMention: `<@${HELPER}>` });
  assert.ok(!text.includes("{"), text);
});

check("without a helper the sentence has no hole and no stray tag", () => {
  const text = buildWelcomeText({ template: null, userId: USER, helperMention: null });
  assert.ok(text.startsWith(`Welcome <@${USER}>`), text);
  assert.ok(!text.includes("{helper}") && !text.includes("tag  "), text);
  assert.equal((text.match(/<@/g) ?? []).length, 1, text);
});

check("a custom message fills both placeholders, every time they appear", () => {
  const text = buildWelcomeText({
    template: "hi {user}! ask {helper}. really, {helper}. bye {user}",
    userId: USER,
    helperMention: "<@&222>",
  });
  assert.equal(text, `hi <@${USER}>! ask <@&222>. really, <@&222>. bye <@${USER}>`);
});

check("a custom message without {user} still greets the member", () => {
  const text = buildWelcomeText({ template: "read the rules", userId: USER, helperMention: null });
  assert.equal(text, `<@${USER}> read the rules`);
});

check("a blank custom message falls back to the built-in text", () => {
  const text = buildWelcomeText({ template: "   ", userId: USER, helperMention: `<@${HELPER}>` });
  assert.ok(text.startsWith(`Welcome <@${USER}>`), text);
});

check("{helper} in a custom message with no helper set reads as words, not a broken tag", () => {
  const text = buildWelcomeText({ template: "{user} ask {helper}", userId: USER, helperMention: null });
  assert.equal(text, `<@${USER}> ask the staff`);
});

check("only the new member is pinged, never the helper, a role or @everyone", () => {
  const message = buildWelcomeMessage({
    template: "{user} ask {helper} @everyone <@&333>",
    userId: USER,
    helperMention: `<@${HELPER}>`,
  });
  assert.deepEqual(message.allowedMentions, { users: [USER], roles: [], parse: [] });
  assert.ok(message.content.includes(`<@${HELPER}>`), "the helper should still be shown as a tag");
});

check("a member, a bare user and a role each get the right kind of tag", () => {
  assert.equal(mentionFor({ id: "1", user: { id: "1" } }), "<@1>");
  assert.equal(mentionFor({ id: "2", username: "someone" }), "<@2>");
  assert.equal(mentionFor({ id: "3", name: "Helpers", color: 0 }), "<@&3>");
  assert.equal(mentionFor(null), null);
});

check("the longest allowed custom message still fits in one Discord message", () => {
  const template = "{user} {helper} " + "x".repeat(WELCOME_MAX_LENGTH - 16);
  assert.equal(template.length, WELCOME_MAX_LENGTH);
  const text = buildWelcomeText({ template, userId: "1".repeat(20), helperMention: `<@&${"9".repeat(20)}>` });
  assert.ok(text.length <= 2000, `length ${text.length}`);
});

check("the built-in text keeps the wording that was asked for", () => {
  for (const part of ["Welcome {user}", "feel free to tag {helper}", "issue", "error", "cheat menu", "offline game", "slop game"]) {
    assert.ok(DEFAULT_WELCOME.includes(part), `missing "${part}"`);
  }
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ", 0 failed"}`);
