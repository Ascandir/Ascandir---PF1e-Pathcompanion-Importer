/**
 * Shared helpers for all importers: compendium lookup, item data, placeholders.
 */
export const MODULE_ID = "ascandir-pf1e-pathcompanion-importer";
export const FLAGS = { [MODULE_ID]: { imported: true } };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const getProp = (obj, path) => foundry.utils.getProperty(obj, path);
export const setProp = (obj, path, value) => foundry.utils.setProperty(obj, path, value);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Normalizes a name for fuzzy comparison. */
export function norm(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Alternative spellings of a name, e.g. "Tent (Medium)" ↔ "Tent, Medium" ↔ "Medium Tent". */
export function nameVariants(name) {
  const out = new Set();
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  out.add(raw);
  let m = raw.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) {
    out.add(`${m[1]}, ${m[2]}`);
    out.add(`${m[2]} ${m[1]}`);
    out.add(m[1]);
  }
  m = raw.match(/^(.*?),\s*(.*)$/);
  if (m) {
    out.add(`${m[1]} (${m[2]})`);
    out.add(`${m[2]} ${m[1]}`);
  }
  return [...out];
}

/* -------------------------------------------- */
/*  Compendium index                            */
/* -------------------------------------------- */

let _index = null;

/** Clears the cached index (e.g. after installing new compendium modules). */
export function resetIndex() {
  _index = null;
}

export async function getIndex() {
  if (_index) return _index;
  const byName = new Map();
  const fields = ["system.subType", "system.associations.classes", "system.tags"];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    let index;
    try {
      index = await pack.getIndex({ fields });
    } catch (err) {
      console.warn(`${MODULE_ID} | Index von ${pack.collection} konnte nicht geladen werden`, err);
      continue;
    }
    const isSystem = pack.metadata.packageType === "system" || pack.metadata.packageName === "pf1";
    for (const e of index) {
      const entry = {
        uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`,
        name: e.name,
        type: e.type,
        subType: getProp(e, "system.subType"),
        classes: toList(getProp(e, "system.associations.classes")),
        tags: toList(getProp(e, "system.tags")),
        isSystem,
      };
      const key = norm(e.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(entry);
    }
  }
  _index = byName;
  return byName;
}

function toList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flat().map((x) => norm(x));
  if (v instanceof Set) return [...v].map((x) => norm(x));
  if (typeof v === "object") return Object.values(v).flat().map((x) => norm(x));
  return [norm(v)];
}

/**
 * Finds the best compendium entry for a list of candidate names.
 * @param {string[]} names            Candidate names, best first
 * @param {object}   opts
 * @param {string[]} [opts.types]     Allowed item types
 * @param {string[]} [opts.subTypes]  Allowed sub types (ignored if the entry has none)
 * @param {string}   [opts.context]   Class or race name to prefer
 */
export async function findEntry(names, { types, subTypes, context } = {}) {
  const index = await getIndex();
  const ctx = context ? norm(context) : null;
  for (const name of names) {
    for (const variant of nameVariants(name)) {
      const hits = (index.get(norm(variant)) ?? []).filter((e) => {
        if (types && !types.includes(e.type)) return false;
        if (subTypes && e.subType && !subTypes.includes(e.subType)) return false;
        return true;
      });
      if (!hits.length) continue;
      const score = (e) =>
        (e.isSystem ? 10 : 0)
        + (ctx && e.classes.includes(ctx) ? 50 : 0)
        + (ctx && e.tags.includes(ctx) ? 30 : 0)
        + (subTypes && e.subType === subTypes[0] ? 5 : 0);
      hits.sort((a, b) => score(b) - score(a));
      return hits[0];
    }
  }
  return null;
}

/** Item creation data for a compendium item, flagged as imported. */
export async function itemDataFromUuid(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) return null;
  const data = game.items.fromCompendium(doc, { keepId: false });
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, foundry.utils.deepClone(FLAGS));
  return data;
}

/** Converts PF1 link entries ({uuid} or legacy {id: "pack.id"}) into UUIDs. */
export function linkUuid(link) {
  const raw = link?.uuid ?? link?.id;
  if (!raw || typeof raw !== "string") return null;
  if (raw.startsWith("Compendium.") || raw.startsWith("Item.")) return raw;
  const parts = raw.split(".");
  if (parts.length >= 3) return `Compendium.${parts.slice(0, -1).join(".")}.Item.${parts.at(-1)}`;
  return null;
}

/** Map normName -> uuid for linked items (class associations, race supplements). */
export function linkMap(links) {
  const map = new Map();
  for (const l of links ?? []) {
    const uuid = linkUuid(l);
    if (!uuid) continue;
    let name = l.name;
    try {
      name = fromUuidSync(uuid)?.name ?? name;
    } catch (err) { /* ignore */ }
    if (name) map.set(norm(name), uuid);
  }
  return map;
}

export function placeholder(name, type, system = {}) {
  return {
    name,
    type,
    system: foundry.utils.mergeObject(
      { description: { value: "<p><em>Importiert – nicht im Kompendium gefunden. Bitte Werte und Effekte manuell prüfen.</em></p>" } },
      system,
    ),
    flags: foundry.utils.deepClone(FLAGS),
  };
}

/**
 * Empties an existing actor before an import: removes all items and skill ranks.
 */
export async function resetActor(actor) {
  if (actor.items.size) await actor.deleteEmbeddedDocuments("Item", actor.items.map((i) => i.id));
  const update = {};
  for (const [key, skill] of Object.entries(actor._source?.system?.skills ?? {})) {
    if (skill && "rank" in skill) update[`system.skills.${key}.rank`] = 0;
    if (skill?.subSkills && Object.keys(skill.subSkills).length) update[`system.skills.${key}.-=subSkills`] = null;
  }
  if (Object.keys(update).length) await actor.update(update);
}

export async function showReport(title, report) {
  const list = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  let content = `<p><strong>${report.found.length}</strong> Einträge aus den Kompendien übernommen.</p>`;
  if (report.placeholders.length) {
    content += `<p><strong>${report.placeholders.length}</strong> nicht gefunden – als Platzhalter angelegt
      (Name stimmt, Werte/Effekte bitte prüfen):</p>${list(report.placeholders)}`;
  }
  if (report.skipped.length) content += `<p>Übersprungen (reine Verwaltungseinträge):</p>${list(report.skipped)}`;
  if (report.notes.length) content += `<p>Hinweise:</p>${list(report.notes)}`;
  console.log(`${MODULE_ID} | Import-Bericht: ${title}`, report);
  await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 520 },
    content: `<div class="ascandir-report">${content}</div>`,
    ok: { label: "OK" },
    rejectClose: false,
  });
}
