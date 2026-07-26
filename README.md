# Digitales Kochbuch & Rezept-Sammlung

Eine persönliche, digitale Sammlung von Kochrezepten mit KI-Unterstützung, intelligenter Mengenskalierung, Mehrfach-Einheiten, Optimierung für Smart Displays & Smartphones sowie Anbindung an Google Keep und Gemini for Home.

---

## Funktionen

1. **Automatische Erstellung & Bearbeitung durch KI-Agenten**
   - Unterstützung bei der Eingabe, Erfassung, Ergänzung und Überarbeitung von Rezepten durch KI.

2. **Zutatenspezifische Zusatz-Einheiten**
   - Fest hinterlegte Zusatz-Einheiten (z. B. EL, Packung, Stück) mit Umrechnung in g / ml je Zutat.
   - Verbesserung der Genauigkeit (z. B.: Wie viel g Schale hat eine Zitrone?) durch Eingabe von Messwerten
   - Im Rezept: automatisch passende Auswahl je nach Menge (z. B. 50 g Joghurt → 2 EL; 400 g Joghurt → 1 Becher) und Angabe zusätzlich zur Basiseinheit (g / kg / ml / l)

3. **Benutzerdefinierte Mengenskalierung**
   - Skalierungslogik, die mathematisch genaue Werte auf runde Zahlen oder ganze Packungen rundet.
   - Deterministisch programmiert (über Tabellen mit Normzahlen), nicht KI-gestützt.
   - Beispiel: Bei 4 Personen 5 EL Öl -> bei 5 Personen praxisnah 6 EL, statt rechnerisch 6,25.

4. **Layout und Design**
   - Layout optimiert für Smartphone und Smart Display
   - Eigene visuelle Gestaltung, besonders Typografie

5. **Vorlesen durch Gemini for Home**
   - Für KI optimierte Ablage der Rezeptdateien.
   - Sprachoptimierte Aufbereitung der Rezeptschritte zum einfachen Vorlesen über Smart Speakers und Smart Displays.

6. **Smarte Einkaufsliste in Google Keep**
   - Automatische Übertragung der Zutaten eines Rezeptes auf die Einkaufsliste.
   - Intelligentes Filtern: Zutaten, die standardmäßig auf Vorrat sind, werden automatisch ausgeschlossen. Zutaten, die vielleicht auf Vorrat sind, werden abgefragt.

7. **Teilen von Rezepten mit Freunden**
   - Einfache Möglichkeit, einzelne Rezepte oder die Sammlung mit Freunden zu teilen.

---

## Erste Schritte

Dieses Repository bildet die Basis für das Kochbuch-Projekt. Das konkrete technische Setup (Programmiersprache, Frameworks, Speicherformat, Schnittstellen) wird noch definiert.
