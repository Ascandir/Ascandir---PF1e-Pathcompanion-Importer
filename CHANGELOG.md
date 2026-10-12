# Changelog

## 0.1.6
- Volksmerkmale: Die Version mit Volksnamen (z. B. „Hatred (Dwarf)“) wird vor allgemeinen Einträgen gleichen Namens bevorzugt, damit die PF1-Effekte mitkommen.

## 0.1.5
- Talente, die PF1 über ein Volksmerkmal oder eine Klassenfähigkeit automatisch anhängt (z. B. Toughness über „Unstoppable“), werden nicht mehr doppelt geführt – TP waren dadurch zu hoch.

## 0.1.4
- Die Startdatei ist jetzt ein kleiner Lader, der den eigentlichen Code immer frisch nachlädt. Updates wirken dadurch auch hinter Proxys/Tunneln (z. B. Cloudflare), die Dateien mit festem Namen lange zwischenspeichern.

## 0.1.3
- Nach einem Update lädt Foundry jetzt zuverlässig die neuen Skriptdateien (vorher konnte der Browser die alte Fassung weiterverwenden).
- Das Import-Fenster zeigt die Modulversion im Titel.

## 0.1.2
- Bonus-Talente aus Volksmerkmalen/Klassenfähigkeiten (z. B. Toughness aus „Unstoppable“) werden nicht mehr doppelt angelegt, wenn das PF1-Merkmal den Effekt schon enthält (TP waren zu hoch).
- Waffen und Rüstungen, für die der Charakter eine Übung hat, werden zusätzlich direkt als „geübt“ markiert.
- Der Import-Bericht zeigt die Modulversion im Titel.

## 0.1.1
- Rüstungs- und Waffenübungen (z. B. „Medium Armor Proficiency“) werden jetzt als Übungen im Bogen gesetzt statt als Platzhalter-Talent.
- Waffenübungen aus dem Volk (z. B. zwergische Weapon Familiarity: Zwergenwaffen, Streitaxt, Kriegshammer) werden übernommen.
- Sprachen werden im Format von PF1 11 gespeichert (vorher: „bitte manuell eintragen“).
- Gegenstände mit Zusatz im Kompendium-Namen werden gefunden (z. B. „Backpack“ → „Backpack, Common“).

## 0.1.0
- Erste Version: Import von Path-Companion-Charakteren (JSON) für PF1 11.x auf Foundry v13.
- Eintrag im Charakterbogen unter ⋮ → **Ascandir Import**, Knopf in der Akteur-Seitenleiste für neue Charaktere.
- Archetyp-gerechte Klassenfähigkeiten, alternative Volksmerkmale, Talente, Wesenszüge, Zauber, Ausrüstung, Fertigkeiten, Sprachen, Geld.
