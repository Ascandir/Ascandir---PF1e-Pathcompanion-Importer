/**
 * Importer for Path Companion (pathcompanion.com) character exports.
 */
import {
  MODULE_ID, FLAGS, sleep, getProp, setProp, esc, norm,
  getIndex, findEntry, itemDataFromUuid, linkMap, placeholder, resetActor, showReport,
  traitUpdate, matchConfigKeys,
} from "../common.js?v=0.2.0";
import { buildPlan, isOptionalFeature } from "./pathcompanion-parser.js?v=0.2.0";

const BOOK_KEYS = ["primary", "secondary", "tertiary", "spelllike"];

export const pathCompanionImporter = {
  id: "pathcompanion",
  label: "Path Companion",
  hint: "In Path Companion den Charakter als JSON exportieren und den kompletten Inhalt hier einfügen (oder die Datei wählen).",
  placeholder: '{ "characterInfo": { … } }',
  fileAccept: ".json,.txt,application/json,text/plain",
  /**
   * @param {string} text   Raw file/textarea content
   * @param {Actor} [actor] Actor to overwrite; a new one is created if omitted
   */
  async run(text, actor) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("Der Text ist kein gültiges JSON.");
    }
    return importPathCompanion(data, { actor });
  },
};

function abilityType(t) {
  const v = String(t ?? "").toLowerCase();
  return ["ex", "su", "sp"].includes(v) ? v : "na";
}

export async function importPathCompanion(pcData, { actor = null } = {}) {
  if (game.system.id !== "pf1") throw new Error("Dieses Modul funktioniert nur mit dem Pathfinder-1e-System.");
  const plan = buildPlan(pcData);
  const report = { found: [], placeholders: [], skipped: [], notes: [...plan.notes] };
  ui.notifications.info(`Importiere ${plan.name} …`);

  await getIndex();

  if (actor) {
    await resetActor(actor);
    await actor.update({ name: plan.name });
  } else {
    actor = await Actor.implementation.create({
      name: plan.name,
      type: "character",
      flags: foundry.utils.deepClone(FLAGS),
    });
  }

  const created = []; // items created in one batch at the end
  const takeOrPlaceholder = async (label, hit, fallback, mutate) => {
    let data = hit ? await itemDataFromUuid(hit.uuid) : null;
    if (data) report.found.push(label);
    else {
      data = fallback;
      report.placeholders.push(label);
    }
    if (mutate) mutate(data);
    created.push(data);
    return { data, found: data !== fallback };
  };
  // Class features / racial traits taken from a compendium, by name (to detect feats they already grant).
  const grantingItems = new Map();
  const changeTargets = (d) => (d?.system?.changes ?? [])
    .map((c) => (c?.target === "ability" ? c.subTarget : c?.target))
    .filter(Boolean);

  /* ---------- Race ---------- */
  let raceSupplements = new Map();
  let raceItem = null;
  if (plan.race?.name) {
    const hit = await findEntry([plan.race.name], { types: ["race"] });
    let data = hit ? await itemDataFromUuid(hit.uuid) : null;
    if (data) {
      raceSupplements = linkMap(getProp(data, "system.links.supplements"));
      // Racial traits come from the export instead (keeps alternate racial traits correct).
      if (getProp(data, "system.links.supplements")) setProp(data, "system.links.supplements", []);
      report.found.push(`Volk: ${plan.race.name}`);
    } else {
      data = placeholder(plan.race.name, "race");
      report.placeholders.push(`Volk: ${plan.race.name}`);
    }
    [raceItem] = await actor.createEmbeddedDocuments("Item", [data]);
  }

  /* ---------- Classes ---------- */
  const classInfo = new Map(); // className -> { item, assoc, originalLinks }
  for (const cls of plan.classes) {
    const hit = await findEntry([cls.name], { types: ["class"] });
    let data = hit ? await itemDataFromUuid(hit.uuid) : null;
    let originalLinks = null;
    let assoc = new Map();
    if (data) {
      originalLinks = getProp(data, "system.links.classAssociations") ?? null;
      assoc = linkMap(originalLinks);
      // Prevent automatic base-class features; archetype-correct features are added below.
      if (originalLinks) setProp(data, "system.links.classAssociations", []);
      report.found.push(`Klasse: ${cls.name} ${cls.level}`);
    } else {
      data = placeholder(cls.name, "class", { subType: "base" });
      report.placeholders.push(`Klasse: ${cls.name}`);
    }
    setProp(data, "system.level", cls.level);
    setProp(data, "system.hp", cls.hp);
    setProp(data, "system.fc.hp.value", cls.fc.hp);
    setProp(data, "system.fc.skill.value", cls.fc.skill);
    setProp(data, "system.fc.alt.value", cls.fc.alt);
    if (cls.archetypes.length) {
      const desc = getProp(data, "system.description.value") ?? "";
      setProp(data, "system.description.value",
        `<p><strong>Archetyp:</strong> ${cls.archetypes.map(esc).join(", ")}</p>${desc}`);
    }
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    classInfo.set(cls.name, { item, assoc, originalLinks });
  }

  /* ---------- Class features (archetype aware) ---------- */
  const seen = new Set();
  for (const cls of plan.classes) {
    const { assoc } = classInfo.get(cls.name) ?? { assoc: new Map() };
    for (const f of cls.features) {
      const key = `${cls.name}|${norm(f.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const archetypeNames = [];
      for (const a of cls.archetypes) {
        archetypeNames.push(`${f.name} (${a})`, `${a} ${f.name}`, `${f.name}, ${a}`);
      }
      if (f.variant) archetypeNames.unshift(f.variant);

      let hit = null;
      // 1) archetype version, 2) the class's own linked feature, 3) any matching class feature
      if (archetypeNames.length) {
        hit = await findEntry(archetypeNames, { types: ["feat"], subTypes: ["classFeat"], context: cls.name });
      }
      if (!hit) {
        const uuid = assoc.get(norm(f.name));
        if (uuid) hit = { uuid };
      }
      if (!hit) hit = await findEntry([f.name], { types: ["feat"], subTypes: ["classFeat"], context: cls.name });

      const label = `${cls.name}: ${f.name}`;
      if (!hit && isOptionalFeature(f.name)) {
        report.skipped.push(label);
        continue;
      }
      const res = await takeOrPlaceholder(label, hit,
        placeholder(f.name, "feat", { subType: "classFeat", abilityType: abilityType(f.type) }));
      if (res.found) grantingItems.set(norm(f.name), res.data);
    }
  }

  /* ---------- Racial traits ---------- */
  for (const t of plan.race?.traits ?? []) {
    // Prefer the race-specific version ("Hatred (Dwarf)") over generic entries of the same name.
    const specific = `${t.name} (${plan.race.name})`;
    let hit = null;
    const uuid = raceSupplements.get(norm(specific)) ?? raceSupplements.get(norm(t.name));
    if (uuid) hit = { uuid };
    if (!hit) {
      hit = await findEntry([specific, t.name],
        { types: ["feat"], subTypes: ["racial"], context: plan.race.name });
    }
    const res = await takeOrPlaceholder(`Volksmerkmal: ${t.name}`, hit, placeholder(t.name, "feat", { subType: "racial" }));
    if (res.found) grantingItems.set(norm(t.name), res.data);
  }

  /* ---------- Feats & traits ---------- */
  for (const ft of plan.feats) {
    const hit = await findEntry([ft.name], { types: ["feat"], subTypes: ["feat"] });
    // Bonus feats granted by a racial trait / class feature (e.g. Toughness from "Unstoppable"):
    // skip them if the PF1 item of that source already applies the same effects.
    const granting = ft.source ? grantingItems.get(norm(ft.source)) : null;
    if (granting && hit) {
      const featData = await itemDataFromUuid(hit.uuid);
      const featTargets = changeTargets(featData);
      const sourceTargets = changeTargets(granting);
      if (featTargets.length && featTargets.every((t) => sourceTargets.includes(t))) {
        report.notes.push(`${ft.name} nicht separat angelegt – wirkt bereits über „${granting.name}“.`);
        continue;
      }
    }
    await takeOrPlaceholder(`Talent: ${ft.name}`, hit, placeholder(ft.name, "feat", { subType: "feat" }));
  }
  for (const tr of plan.traits) {
    const hit = await findEntry([tr.name], { types: ["feat"], subTypes: ["trait"] });
    await takeOrPlaceholder(`Wesenszug: ${tr.name}`, hit,
      placeholder(tr.name, "feat", { subType: "trait", traitType: tr.type }),
      (d) => { if (tr.type && !getProp(d, "system.traitType")) setProp(d, "system.traitType", tr.type); });
  }

  /* ---------- Equipment ---------- */
  const equipmentData = new Map(); // plan ref -> item data
  const profs = plan.proficiencies ?? { armor: [], weapon: [], weaponCustom: [] };
  const namedWeaponProfs = new Set(profs.weaponCustom.map((n) => norm(n)));
  const weaponCategory = { simple: "sim", martial: "mar" };
  const armorCategory = { light: "lgt", medium: "med", heavy: "hvy", shield: "shl", tower: "twr" };
  for (const w of plan.weapons) {
    const hit = await findEntry([w.name], { types: ["weapon"] });
    const fb = placeholder(w.name, "weapon", {
      subType: ["simple", "martial", "exotic"].includes(w.proficiency) ? w.proficiency : "martial",
    });
    equipmentData.set(w.ref, (await takeOrPlaceholder(`Waffe: ${w.name}`, hit, fb, (d) => {
      setProp(d, "system.quantity", w.quantity);
      setProp(d, "system.equipped", w.equipped);
      if (namedWeaponProfs.has(norm(w.name)) || namedWeaponProfs.has(norm(d.name))
        || profs.weapon.includes(weaponCategory[w.proficiency])) setProp(d, "system.proficient", true);
      if (w.masterwork) setProp(d, "system.masterwork", true);
      if (w.enhancement) setProp(d, "system.enh", w.enhancement);
    })).data);
    if (w.hasEnchantments) report.notes.push(`${w.name}: Waffeneigenschaften bitte manuell eintragen.`);
  }
  for (const a of plan.armor) {
    const hit = await findEntry([a.name], { types: ["equipment"] });
    const fb = placeholder(a.name, "equipment", {
      subType: a.type === "shield" ? "shield" : "armor",
      equipmentSubtype: { light: "lightArmor", medium: "mediumArmor", heavy: "heavyArmor" }[a.type] ?? "lightShield",
      armor: { value: a.ac, dex: a.maxDex, acp: a.acp },
      spellFailure: a.spellFailure,
    });
    equipmentData.set(a.ref, (await takeOrPlaceholder(`Rüstung: ${a.name}`, hit, fb, (d) => {
      setProp(d, "system.equipped", a.equipped);
      if (profs.armor.includes(armorCategory[a.type])) setProp(d, "system.proficient", true);
      if (a.masterwork) setProp(d, "system.masterwork", true);
      if (a.enhancement) setProp(d, "system.armor.enh", a.enhancement);
    })).data);
  }
  for (const g of plan.gear) {
    const hit = await findEntry([g.name], { types: ["loot", "equipment", "consumable", "container", "weapon", "implant"], prefix: true });
    equipmentData.set(g.ref, (await takeOrPlaceholder(`Gegenstand: ${g.name}`, hit, placeholder(g.name, "loot", { subType: "gear" }), (d) => {
      setProp(d, "system.quantity", g.quantity);
      if (g.equipped && ["equipment", "container"].includes(d.type)) setProp(d, "system.equipped", true);
    })).data);
  }

  /* ---------- Containers ---------- */
  // Items inside a backpack etc. are stored in the PF1 container item itself (system.items).
  const notInContainer = [];
  for (const e of [...plan.weapons, ...plan.armor, ...plan.gear]) {
    if (!e.parent) continue;
    const child = equipmentData.get(e.ref);
    const parent = equipmentData.get(e.parent);
    if (!child || !parent) continue;
    if (parent.type !== "container") {
      notInContainer.push(`${e.name} (${parent.name} ist in PF1 kein Behälter)`);
      continue;
    }
    const idx = created.indexOf(child);
    if (idx >= 0) created.splice(idx, 1);
    child._id = foundry.utils.randomID(16);
    if (getProp(child, "system.equipped") !== undefined) setProp(child, "system.equipped", false);
    const contents = getProp(parent, "system.items");
    setProp(parent, "system.items", { ...(contents && typeof contents === "object" ? contents : {}), [child._id]: child });
  }
  if (notInContainer.length) report.notes.push(`Liegen direkt im Inventar: ${notInContainer.join(", ")}`);

  /* ---------- Spells ---------- */
  await sleep(300); // let the system finish class setup (it may auto-configure spellbooks)
  const bookUpdates = {};
  const usedBooks = new Set();
  const spellbooks = actor.system.attributes?.spells?.spellbooks ?? {};
  for (const book of plan.spellbooks) {
    const clsItem = classInfo.get(book.className)?.item;
    const tag = clsItem?.system?.tag ?? norm(book.className).replace(/\s+/g, "");
    let key = Object.entries(spellbooks).find(([k, b]) => b?.inUse && b?.class === tag && !usedBooks.has(k))?.[0];
    if (!key) key = BOOK_KEYS.find((k) => !usedBooks.has(k) && !spellbooks[k]?.inUse);
    if (!key) {
      report.notes.push(`Kein freies Zauberbuch für ${book.className}.`);
      continue;
    }
    usedBooks.add(key);
    const p = `system.attributes.spells.spellbooks.${key}`;
    Object.assign(bookUpdates, {
      [`${p}.inUse`]: true,
      [`${p}.class`]: tag,
      [`${p}.kind`]: book.kind,
      [`${p}.ability`]: book.ability,
      [`${p}.spellPreparationMode`]: book.mode,
      [`${p}.casterType`]: book.casterType,
      [`${p}.autoSpellLevelCalculation`]: true,
    });

    for (const s of book.spells) {
      const hit = await findEntry([s.name], { types: ["spell"] });
      await takeOrPlaceholder(`Zauber: ${s.name}`, hit, placeholder(s.name, "spell"), (d) => {
        setProp(d, "system.spellbook", key);
        setProp(d, "system.level", s.level);
        if (book.mode === "prepared") {
          // Current PF1 field names plus the older ones.
          setProp(d, "system.preparation.value", s.prepared);
          setProp(d, "system.preparation.max", s.prepared);
          setProp(d, "system.preparation.preparedAmount", s.prepared);
          setProp(d, "system.preparation.maxAmount", s.prepared);
        }
      });
    }
  }

  /* ---------- Create all items ---------- */
  if (created.length) await actor.createEmbeddedDocuments("Item", created);

  /* ---------- Actor data ---------- */
  const update = { ...bookUpdates };
  if (plan.alignment) update["system.details.alignment"] = plan.alignment;
  if (plan.deity) update["system.details.deity"] = plan.deity;

  // Ability scores: the PF1 race item applies its own racial modifiers, so subtract the ones it covers.
  const raceTargets = (raceItem?.system?.changes ?? [])
    .map((c) => (c?.target === "ability" ? c.subTarget : c?.target))
    .filter(Boolean);
  for (const [key, a] of Object.entries(plan.abilities)) {
    const raceHandles = raceTargets.includes(key);
    update[`system.abilities.${key}.value`] = a.permanent - (raceHandles ? a.racial : 0) - a.enhancement;
  }

  for (const [key, rank] of Object.entries(plan.skills)) update[`system.skills.${key}.rank`] = rank;
  for (const s of plan.subSkills) {
    update[`system.skills.${s.parent}.subSkills.${s.key}`] = {
      name: s.name, ability: s.ability, rank: s.rank, rt: false, acp: false, cs: s.cs,
    };
  }

  for (const [k, v] of Object.entries(plan.currency)) update[`system.currency.${k}`] = v;

  const pf1cfg = globalThis.pf1?.config ?? CONFIG.PF1 ?? {};
  const langs = matchConfigKeys(plan.languages, pf1cfg.languages);
  Object.assign(update, traitUpdate(actor, "system.traits.languages", langs.keys, langs.custom));

  // Armor & weapon proficiencies (feats like "Medium Armor Proficiency", Weapon Familiarity, …)
  Object.assign(update, traitUpdate(actor, "system.traits.armorProf", profs.armor, []));
  const weaponNamed = matchConfigKeys(profs.weaponCustom, pf1cfg.weaponProficiencies);
  // Use the compendium spelling so PF1 can match the proficiency to the weapon item.
  for (let i = 0; i < weaponNamed.custom.length; i++) {
    const hit = await findEntry([weaponNamed.custom[i]], { types: ["weapon"] });
    if (hit?.name) weaponNamed.custom[i] = hit.name;
  }
  Object.assign(update, traitUpdate(actor, "system.traits.weaponProf",
    [...profs.weapon, ...weaponNamed.keys], weaponNamed.custom));
  const armorLabels = { lgt: "leichte Rüstung", med: "mittelschwere Rüstung", hvy: "schwere Rüstung", shl: "Schilde", twr: "Turmschilde" };
  const weaponLabels = { sim: "einfache Waffen", mar: "Kriegswaffen" };
  const profText = [
    ...profs.armor.map((k) => armorLabels[k] ?? k),
    ...profs.weapon.map((k) => weaponLabels[k] ?? k),
    ...profs.weaponCustom,
  ];
  if (profText.length) report.found.push(`Übungen: ${profText.join(", ")}`);
  update["system.details.biography.value"] = biography(plan);

  await actor.update(update);

  /* ---------- Restore class links, clean up, HP ---------- */
  for (const { item, originalLinks } of classInfo.values()) {
    if (!originalLinks?.length) continue;
    try {
      await item.update({ "system.links.classAssociations": originalLinks });
    } catch (err) {
      console.warn(`${MODULE_ID} | Klassen-Verknüpfungen konnten nicht wiederhergestellt werden`, err);
    }
  }
  await sleep(500);
  // Features the system auto-added during import (e.g. base features replaced by an archetype) are removed.
  const stray = actor.items
    .filter((i) => i.type === "feat"
      && ["classFeat", "racial"].includes(i.system?.subType)
      && !i.getFlag(MODULE_ID, "imported"))
    .map((i) => i.id);
  if (stray.length) await actor.deleteEmbeddedDocuments("Item", stray);

  // Items PF1 attached on its own (e.g. Toughness as supplement of "Unstoppable") that the
  // import already contains → remove the automatic copy so effects don't count twice.
  const isOurs = (i) => !!i.getFlag(MODULE_ID, "imported");
  const itemKey = (i) => `${i.type}|${norm(i.name)}`;
  const ourKeys = new Set(actor.items.filter(isOurs).map(itemKey));
  const dupes = actor.items.filter((i) => !isOurs(i) && ourKeys.has(itemKey(i)));
  if (dupes.length) {
    await actor.deleteEmbeddedDocuments("Item", dupes.map((i) => i.id));
    report.notes.push(`Doppelt (von PF1 automatisch angehängt) entfernt: ${dupes.map((i) => i.name).join(", ")}`);
  }

  const hpMax = actor.system.attributes?.hp?.max;
  if (Number.isFinite(hpMax) && hpMax > 0) {
    const current = plan.hpCurrent != null ? Math.min(plan.hpCurrent, hpMax) : hpMax;
    await actor.update({ "system.attributes.hp.value": current });
  }

  ui.notifications.info(`${plan.name} wurde importiert.`);
  actor.sheet?.render(true);
  await showReport(`Path Companion Import: ${plan.name}`, report);
  return actor;
}

function biography(plan) {
  const lines = [];
  for (const c of plan.classes) {
    const arch = c.archetypes.length ? ` – Archetyp: ${c.archetypes.map(esc).join(", ")}` : "";
    lines.push(`<li><strong>${esc(c.name)} ${c.level}</strong>${arch}</li>`);
  }
  if (plan.alignmentLabel) lines.push(`<li>Gesinnung: ${esc(plan.alignmentLabel)}</li>`);
  if (plan.deity) lines.push(`<li>Gottheit: ${esc(plan.deity)}</li>`);
  if (plan.age) lines.push(`<li>Alter: ${esc(plan.age)}</li>`);
  return `<h3>Aus Path Companion importiert</h3><ul>${lines.join("")}</ul>`;
}
