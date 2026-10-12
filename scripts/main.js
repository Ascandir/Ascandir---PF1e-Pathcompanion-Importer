/**
 * Ascandir - PF1e Pathcompanion Importer
 *
 * Adds an "Ascandir Import" entry to PF1 character sheets (⋮ menu on V2 sheets,
 * title-bar button on V1 sheets) and a button to the Actors sidebar. The import
 * window lets you pick the source (currently Path Companion) and paste/select the
 * export. New sources can be added with `registerImporter`.
 */
import { MODULE_ID, esc, resetIndex } from "./common.js";
import { pathCompanionImporter } from "./importers/pathcompanion.js";

const LABEL = "Ascandir Import";
const ICON = "fa-solid fa-file-import";

/** @type {Map<string, {id:string,label:string,hint?:string,placeholder?:string,fileAccept?:string,run:Function}>} */
const importers = new Map();

/**
 * Registers an import source.
 * @param {object} importer
 * @param {string} importer.id          Unique key
 * @param {string} importer.label       Name shown in the source selection
 * @param {string} [importer.hint]      Short instructions shown in the dialog
 * @param {string} [importer.placeholder] Placeholder for the text field
 * @param {string} [importer.fileAccept]  File types for the file picker
 * @param {(text:string, actor?:Actor) => Promise<Actor>} importer.run
 */
export function registerImporter(importer) {
  if (!importer?.id || typeof importer.run !== "function") throw new Error("Ungültiger Importer");
  importers.set(importer.id, importer);
}

registerImporter(pathCompanionImporter);

Hooks.once("init", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { registerImporter, openImportDialog, importers, resetIndex };
});

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

function canImportInto(actor) {
  return game.system.id === "pf1"
    && actor instanceof Actor
    && actor.type === "character"
    && actor.isOwner;
}

// ApplicationV2 sheets: entry in the ⋮ header menu.
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document ?? app.actor;
  if (!canImportInto(actor)) return;
  if (controls.some((c) => c.action === "ascandirImport")) return;
  // Fallback for the action handler lookup in case `onClick` isn't honoured.
  if (app.options?.actions && !app.options.actions.ascandirImport) {
    app.options.actions.ascandirImport = () => openImportDialog(actor);
  }
  controls.push({
    action: "ascandirImport",
    icon: ICON,
    label: LABEL,
    onClick: () => openImportDialog(actor),
  });
});

// ApplicationV1 sheets: button in the title bar.
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.actor ?? sheet.document;
  if (!canImportInto(actor)) return;
  if (buttons.some((b) => b.class === "ascandir-import")) return;
  buttons.unshift({
    label: "Ascandir",
    class: "ascandir-import",
    icon: ICON,
    onclick: () => openImportDialog(actor),
  });
});

// Actors sidebar: import as a new character.
Hooks.on("renderActorDirectory", (app, html) => {
  if (game.system.id !== "pf1" || !game.user.can("ACTOR_CREATE")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".ascandir-import-button")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("ascandir-import-button");
  btn.innerHTML = `<i class="${ICON}"></i> ${LABEL}`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    openImportDialog(null);
  });
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(btn);
});

/* -------------------------------------------- */
/*  Dialog                                      */
/* -------------------------------------------- */

/**
 * Opens the import window.
 * @param {Actor|null} actor  Character to overwrite, or null to create a new one
 */
export async function openImportDialog(actor = null) {
  if (game.system.id !== "pf1") {
    ui.notifications.warn("Ascandir Import funktioniert nur im Pathfinder-1e-System.");
    return;
  }
  const list = [...importers.values()];
  const first = list[0];
  const options = list.map((i) => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join("");
  const target = actor
    ? `<p class="ascandir-warning"><i class="fa-solid fa-triangle-exclamation"></i>
         Überschreibt <strong>${esc(actor.name)}</strong> komplett (alle Gegenstände, Talente, Zauber und Werte).</p>`
    : `<p>Es wird ein <strong>neuer</strong> Charakter angelegt.</p>`;

  const content = `
    <div class="ascandir-import">
      ${target}
      <div class="form-group">
        <label>Quelle</label>
        <select name="source">${options}</select>
      </div>
      <p class="hint ascandir-hint">${esc(first?.hint ?? "")}</p>
      <div class="form-group">
        <label>Datei</label>
        <input type="file" name="file" accept="${esc(first?.fileAccept ?? "")}">
      </div>
      <div class="form-group stacked">
        <label>… oder Inhalt einfügen</label>
        <textarea name="text" rows="10" placeholder="${esc(first?.placeholder ?? "")}"></textarea>
      </div>
    </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: actor ? `${LABEL}: ${actor.name}` : LABEL, icon: ICON },
    position: { width: 520 },
    content,
    buttons: [
      {
        action: "import",
        label: "Importieren",
        icon: ICON,
        default: true,
        callback: (event, button) => {
          const els = button.form.elements;
          return {
            source: els.source.value,
            file: els.file.files?.[0] ?? null,
            text: els.text.value,
          };
        },
      },
      { action: "cancel", label: "Abbrechen", icon: "fa-solid fa-xmark" },
    ],
    render: (event, dialog) => {
      const el = dialog?.element ?? event?.target?.element;
      const select = el?.querySelector?.("select[name=source]");
      if (!select) return;
      select.addEventListener("change", () => {
        const imp = importers.get(select.value);
        el.querySelector(".ascandir-hint").textContent = imp?.hint ?? "";
        el.querySelector("textarea[name=text]").placeholder = imp?.placeholder ?? "";
        el.querySelector("input[name=file]").accept = imp?.fileAccept ?? "";
      });
    },
    rejectClose: false,
  });
  if (!result || result === "cancel" || typeof result !== "object") return;

  const importer = importers.get(result.source);
  if (!importer) return;
  const text = result.file ? await result.file.text() : result.text;
  if (!text?.trim()) {
    ui.notifications.warn("Keine Datei gewählt und nichts eingefügt.");
    return;
  }

  if (actor) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: LABEL },
      content: `<p>${esc(actor.name)} wirklich mit dem Import überschreiben?</p>`,
      rejectClose: false,
    });
    if (!ok) return;
  }

  try {
    await importer.run(text, actor ?? undefined);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(`Import fehlgeschlagen: ${err.message}`);
  }
}
