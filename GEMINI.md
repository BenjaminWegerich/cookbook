# GEMINI.md - Verhaltens- & Agenten-Anweisungen

Diese Datei enthält die grundlegenden Richtlinien für KI-Agenten, die an diesem Rezept-Repository arbeiten, Rezepte erstellen, bearbeiten oder verwalten.

---

## 🤖 Anweisungen für den KI-Agenten

Beim Erstellen, Bearbeiten oder Erweitern von Rezepten und Projektfunktionen sind folgende Core-Anforderungen zu beachten:

1. **KI-Erstellung & -Bearbeitung**
   - Rezepte stets strukturiert, verständlich und konsistent anlegen bzw. anpassen.

2. **Mengenskalierung & Einheiten (Deterministisch)**
   - Die Berechnung der Mengenskalierung (z. B. 4 Personen -> 50 ml Öl, 5 Personen -> 60 ml Öl statt 62,5 ml) sowie die Handhabung mehrfacher Einheiten (z. B. *"1 Block Tofu (200 g)"*) erfolgt **deterministisch über Code, Normzahltabellen und Regelwerke**, nicht freihändig on-the-fly durch die KI.
   - Der KI-Agent beachtet die im System festgelegten Einheiten-Regeln und Normzahltabellen bei der Rezepterstellung.

3. **Kühl- & Vorrats-Kennzeichnung (`alwaysInStock`)**
   - Zutaten identifizieren, die üblicherweise im Haushalt vorrätig sind (z. B. Gewürze, Salz, Grundöle), damit diese beim Export auf die Einkaufsliste (Gemini for Home) ignoriert werden können.

4. **Sprachausgabe-Kompatibilität (Gemini for Home)**
   - Anweisungen und Schritte so formulieren, dass sie flüssig und leicht verständlich vorgelesen werden können.

5. **Responsive & Display-Freundlichkeit**
   - Berücksichtige bei allen visuell relevanten Inhalten die Darstellung auf Smartphones und Smart Displays in der Küche (gute Lesbarkeit, klare Typografie, Distanzlesbarkeit).

6. **Teilbarkeit**
   - Formate und Strukturen so gestalten, dass Rezepte leicht exportiert oder mit Freunden geteilt werden können.
