# Ascandir - PF1e Pathcompanion Importer

Foundry-VTT-Modul, das Charaktere aus [Path Companion](https://pathcompanion.com) in das
**Pathfinder 1e**-System importiert – inklusive Archetypen, Klassenfähigkeiten, alternativer
Volksmerkmale, Talente, Wesenszüge, Zauber und Ausrüstung.

| | Version |
|---|---|
| Foundry VTT | v13 |
| PF1-System | 11.x |

## Installation

In Foundry unter **Add-on Modules → Install Module** diese Manifest-URL einfügen:

```
https://github.com/Ascandir/Ascandir---PF1e-Pathcompanion-Importer/releases/latest/download/module.json
```

Danach das Modul in der Welt aktivieren.

## Benutzung

1. In Path Companion den Charakter als **JSON exportieren**.
2. In Foundry den Charakterbogen öffnen → **⋮-Menü → Ascandir Import**
   (bei älteren Bögen: Knopf **Ascandir** in der Titelleiste).
3. Quelle **Path Companion** wählen, die Datei auswählen oder den JSON-Inhalt ins Textfeld einfügen → **Importieren**.

Der Import **überschreibt** den geöffneten Charakter komplett (nach Rückfrage).
Über den Knopf **Ascandir Import** in der Akteur-Seitenleiste wird stattdessen ein neuer Charakter angelegt.

Am Ende zeigt ein Bericht, was aus den Kompendien übernommen wurde und was nur als
**Platzhalter** angelegt werden konnte (Name stimmt, Werte/Effekte bitte von Hand prüfen).

## So funktioniert es

- Alles wird per Namen in den **Item-Kompendien** gesucht (PF1-System zuerst, dann Module),
  dadurch kommen Werte, Formeln und Effekte direkt aus PF1.
- **Archetypen:** Path Companion liefert die tatsächlich erhaltenen Klassenfähigkeiten.
  Das Modul sucht zuerst die Archetyp-Variante (z. B. „Arcane Pool (Bladebound)“), dann die
  normale Fähigkeit. Ersetzte Grundfähigkeiten werden nicht hinzugefügt.
- **Volk:** Rassenboni rechnet das PF1-Volk selbst ein; alternative Volksmerkmale werden
  übernommen, die ersetzten Standardmerkmale nicht.
- Klassenverknüpfungen bleiben erhalten, d. h. Stufenaufstiege in Foundry funktionieren wie
  gewohnt (ersetzte Archetyp-Fähigkeiten bei späteren Stufen bitte selbst anpassen).

## Bekannte Grenzen

- Behälter (Rucksack usw.) werden nicht nachgebaut, alle Gegenstände liegen im Inventar.
- Magische Waffeneigenschaften und eigene Boni aus Path Companion müssen von Hand eingetragen werden.
- Inhalte, die in keinem Kompendium existieren (Homebrew, seltene Bücher), werden Platzhalter.

## Weitere Charakterbuilder ergänzen

Jede Quelle ist ein eigener Importer in `scripts/importers/`. Neue Quellen werden registriert mit:

```js
game.modules.get("ascandir-pf1e-pathcompanion-importer").api.registerImporter({
  id: "meinbuilder",
  label: "Mein Builder",
  hint: "Kurze Anleitung für das Import-Fenster",
  fileAccept: ".json",
  async run(text, actor) { /* actor ist der offene Bogen oder undefined */ },
});
```

Hilfsfunktionen für Kompendium-Suche, Platzhalter und Bericht liegen in `scripts/common.js`.

## Entwicklung

`node test/run.mjs` spielt einen Beispielimport (`test/durgan.json`) gegen eine
Foundry-Attrappe durch und prüft die wichtigsten Ergebnisse.

Neue Version veröffentlichen: auf GitHub ein Release mit Tag `vX.Y.Z` erstellen – der Workflow
baut `module.zip` und `module.json` und hängt sie an.
