/**
 * Minimal stand-in for the Foundry VTT + PF1 runtime, enough to exercise the
 * importer end-to-end in Node. Not a faithful emulation – it checks the flow,
 * not PF1's rules engine.
 */
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
function getProperty(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setProperty(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (o[p] == null || typeof o[p] !== "object") o[p] = {};
    o = o[p];
  }
  const last = parts.at(-1);
  if (last.startsWith("-=")) delete o[last.slice(2)];
  else o[last] = value;
  return true;
}
function mergeObject(a, b) {
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") mergeObject(a[k], v);
    else a[k] = v;
  }
  return a;
}

let idCounter = 0;
const newId = () => `id${++idCounter}`.padEnd(16, "x");

// ---- Fake compendium ---------------------------------------------------
const PACK = "pf1.mock";
const docs = {};
function addDoc(name, type, system = {}) {
  const _id = newId();
  docs[_id] = { _id, name, type, system: clone(system) };
  return `Compendium.${PACK}.Item.${_id}`;
}
const U = {};
U.spellCombat = addDoc("Spell Combat", "feat", { subType: "classFeat", associations: { classes: ["Magus"] } });
U.arcanePool = addDoc("Arcane Pool", "feat", { subType: "classFeat", associations: { classes: ["Magus"] } });
U.spellstrike = addDoc("Spellstrike", "feat", { subType: "classFeat", associations: { classes: ["Magus"] } });
U.cantrips = addDoc("Cantrips", "feat", { subType: "classFeat", associations: { classes: ["Magus"] } });
// Same name for another class – must not be picked for the Magus
addDoc("Arcane Pool", "feat", { subType: "classFeat", associations: { classes: ["Arcanist"] } });
U.magus = addDoc("Magus", "class", {
  subType: "base", tag: "magus",
  links: { classAssociations: [
    { uuid: U.cantrips, level: 1 }, { uuid: U.spellCombat, level: 1 },
    { uuid: U.arcanePool, level: 1 }, { uuid: U.spellstrike, level: 2 },
  ] },
});
U.hardy = addDoc("Hardy", "feat", { subType: "racial" });
U.darkvision = addDoc("Darkvision", "feat", { subType: "racial", tags: ["Dwarf"] });
U.hatred = addDoc("Hatred", "feat", { subType: "racial", tags: ["Dwarf"] });
addDoc("Hatred", "feat", { subType: "racial", tags: ["Gnome"] });
U.dwarf = addDoc("Dwarf", "race", {
  changes: [
    { formula: "2", target: "con", type: "racial" },
    { formula: "2", target: "wis", type: "racial" },
    { formula: "-2", target: "cha", type: "racial" },
  ],
  links: { supplements: [{ uuid: U.hardy }, { uuid: U.darkvision }, { uuid: U.hatred }] },
});
addDoc("Toughness", "feat", { subType: "feat", changes: [{ formula: "max(3, @attributes.hd.total)", target: "mhp" }] });
U.unstoppable = addDoc("Unstoppable", "feat", { subType: "racial", changes: [{ formula: "1", target: "fort" }, { formula: "max(3, @attributes.hd.total)", target: "mhp" }] });
addDoc("Medium Armor Proficiency", "feat", { subType: "feat" });
addDoc("Shocking Grasp", "spell", { level: 1 });
addDoc("Enlarge Person", "spell", { level: 1 });
addDoc("Grease", "spell", { level: 1 });
addDoc("Detect Magic", "spell", { level: 0 });
addDoc("Ray of Frost", "spell", { level: 0 });
addDoc("Dwarven Longhammer", "weapon", { subType: "exotic" });
addDoc("Kikko", "equipment", { subType: "armor" });
addDoc("Backpack, Common", "container", {});
addDoc("Backpack, Masterwork", "container", {});
addDoc("Tent, Medium", "loot", { subType: "gear" });
addDoc("Spell Component Pouch", "loot", { subType: "gear" });

const pack = {
  collection: PACK,
  documentName: "Item",
  metadata: { packageType: "system", packageName: "pf1" },
  async getIndex() {
    return Object.values(docs).map((d) => ({
      _id: d._id, name: d.name, type: d.type, uuid: `Compendium.${PACK}.Item.${d._id}`,
      system: { subType: d.system.subType, associations: d.system.associations, tags: d.system.tags },
    }));
  },
};
const docFromUuid = (uuid) => {
  const id = uuid.split(".").at(-1);
  const d = docs[id];
  return d ? { ...clone(d), toObject: () => clone(d) } : null;
};

// ---- Fake actor ------------------------------------------------------------
class FakeItem {
  constructor(actor, data) {
    this.actor = actor;
    this.id = newId();
    Object.assign(this, clone(data));
    this.flags ??= {};
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) setProperty(this, k, v);
    return this;
  }
}
export const log = [];
class FakeActor {
  constructor(data) {
    this.id = newId();
    this.name = data.name;
    this.type = data.type;
    this.flags = data.flags ?? {};
    this._source = {
      system: {
        skills: { acr: { rank: 0 }, crf: { rank: 0, subSkills: {} }, kar: { rank: 0 } },
        traits: { languages: [], armorProf: [], weaponProf: [] },
      },
    };
    this.itemMap = new Map();
    this.isOwner = true;
    this.sheet = { render: () => {} };
  }
  get items() {
    const arr = [...this.itemMap.values()];
    arr.size = arr.length;
    return arr;
  }
  get system() {
    const s = clone(this._source.system);
    const books = {};
    // Emulate PF1 auto-configuring a spellbook for a casting class.
    for (const i of this.itemMap.values()) {
      if (i.type === "class" && i.system.tag === "magus") books.primary = { inUse: true, class: "magus" };
    }
    s.attributes = { spells: { spellbooks: books }, hp: { max: 12 } };
    return s;
  }
  async createEmbeddedDocuments(type, list) {
    const out = list.map((d) => new FakeItem(this, d));
    for (const i of out) this.itemMap.set(i.id, i);
    // Emulate PF1 auto-adding class associations (should be suppressed by the importer).
    for (const i of out) {
      if (i.type === "class") {
        for (const a of i.system.links?.classAssociations ?? []) {
          if ((a.level ?? 1) <= i.system.level) {
            const d = docFromUuid(a.uuid);
            const it = new FakeItem(this, { name: d.name, type: d.type, system: d.system });
            this.itemMap.set(it.id, it);
            log.push(`AUTO-ADDED ${d.name}`);
          }
        }
      }
    }
    return out;
  }
  async deleteEmbeddedDocuments(type, ids) {
    for (const id of ids) {
      log.push(`DELETED ${this.itemMap.get(id)?.name}`);
      this.itemMap.delete(id);
    }
  }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) {
      if (k === "name") this.name = v;
      else if (k.startsWith("system.")) setProperty(this._source, k, v);
    }
    return this;
  }
}

// ---- Globals ---------------------------------------------------------------
globalThis.foundry = {
  utils: { getProperty, setProperty, mergeObject, deepClone: clone, escapeHTML: (s) => s },
  applications: { api: { DialogV2: {
    prompt: async (o) => { log.push(`DIALOG: ${o.window.title}`); globalThis.lastReport = o.content; return true; },
    wait: async () => null,
    confirm: async () => true,
  } } },
};
export const hooks = {};
globalThis.Hooks = { on: (n, f) => { (hooks[n] ??= []).push(f); }, once: (n, f) => { (hooks[n] ??= []).push(f); } };
globalThis.Actor = class {};
Object.setPrototypeOf(FakeActor.prototype, Actor.prototype);
Actor.implementation = { create: async (d) => new FakeActor(d) };
globalThis.game = {
  system: { id: "pf1" },
  packs: [pack],
  items: { fromCompendium: (doc) => { const d = doc.toObject(); delete d._id; return d; } },
  i18n: { localize: (s) => s },
  user: { can: () => true },
  modules: new Map(),
};
globalThis.ui = { notifications: { info: () => ({}), warn: console.warn, error: console.error } };
globalThis.CONFIG = { PF1: { languages: { common: "Common", dwarven: "Dwarven", elven: "Elven", orc: "Orc" }, weaponProficiencies: { sim: "Simple", mar: "Martial" } } };
globalThis.fromUuid = async (u) => docFromUuid(u);
globalThis.fromUuidSync = (u) => docFromUuid(u);
