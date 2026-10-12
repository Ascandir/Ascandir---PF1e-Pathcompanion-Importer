// Runs the Path Companion import against the mock Foundry runtime.
// Usage: node test/run.mjs [path/to/export.json]
import { readFileSync } from "node:fs";
import { log } from "./mock-foundry.mjs";

const { importPathCompanion } = await import("../scripts/importers/pathcompanion.js");
await import("../scripts/main.js"); // make sure the entry module loads

const file = process.argv[2] ?? new URL("./durgan.json", import.meta.url);
const json = JSON.parse(readFileSync(file, "utf8"));
const actor = await importPathCompanion(json);

const items = actor.items.map((i) => `${i.type}${i.system?.subType ? `/${i.system.subType}` : ""}: ${i.name}`
  + (i.type === "spell" ? ` [book=${i.system.spellbook} lvl=${i.system.level} prep=${i.system.preparation?.value ?? 0}]` : "")
  + (i.type === "class" ? ` [lvl=${i.system.level} hp=${i.system.hp} fcSkill=${i.system.fc.skill.value} assoc=${i.system.links?.classAssociations?.length}]` : "")
  + (i.system?.quantity > 1 ? ` x${i.system.quantity}` : "")
  + (i.system?.equipped ? " (ausgerüstet)" : ""));
console.log("ACTOR:", actor.name);
console.log(items.sort().join("\n"));
console.log("\nSYSTEM:", JSON.stringify(actor._source.system, null, 1));
console.log("\nLOG:", log.join(" | "));
console.log("\nREPORT:", globalThis.lastReport.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

// Assertions
const names = actor.items.map((i) => i.name);
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
assert(!names.includes("Spellstrike"), "Level-2-Fähigkeit nicht vorhanden");
assert(!names.includes("Hardy"), "Ersetztes Volksmerkmal (Hardy) entfernt");
assert(names.filter((n) => n === "Arcane Pool").length === 1, "Arcane Pool genau einmal");
assert(names.filter((n) => n === "Spell Combat").length === 1, "Spell Combat genau einmal");
assert(actor._source.system.abilities.con.value === 10, "KON-Grundwert 10 (Rasse addiert +2)");
assert(actor._source.system.abilities.str.value === 16, "STR 16");
assert(actor._source.system.skills.kar.rank === 1, "Wissen (Arkanes) 1 Rang");
assert(actor._source.system.attributes.spells.spellbooks.primary.class === "magus", "Zauberbuch primary = magus");
assert(actor._source.system.currency.gp === 143, "143 GM");
assert(actor._source.system.traits.languages.base.length === 4, "4 Sprachen");
assert(actor.items.find((i) => i.type === "class").system.links.classAssociations.length === 4, "Klassen-Verknüpfungen wiederhergestellt");

// --- Sheet menu entry + re-import into the same (existing) actor ---
const { hooks } = await import("./mock-foundry.mjs");
const controls = [];
const app = { document: actor, options: { actions: {} } };
hooks.getHeaderControlsApplicationV2[0](app, controls);
assert(controls.length === 1 && controls[0].label === "Ascandir Import", "⋮-Menüeintrag 'Ascandir Import' vorhanden");
assert(typeof app.options.actions.ascandirImport === "function", "Aktion für ⋮-Menü registriert");
const buttons = [];
hooks.getActorSheetHeaderButtons[0]({ actor }, buttons);
assert(buttons[0]?.label === "Ascandir", "Titelleisten-Knopf für ältere Bögen vorhanden");

const before = actor.items.length;
await importPathCompanion(json, { actor });
assert(actor.items.length === before, `Zweiter Import in denselben Bogen: keine Duplikate (${actor.items.length} Einträge)`);
