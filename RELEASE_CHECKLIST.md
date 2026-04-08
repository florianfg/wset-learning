# Release-Checklist – WSET App

## Vor jedem Release prüfen

### PWA-Assets
- [ ] icon-192.png vorhanden und korrekt (192×192 px)
- [ ] icon-512.png vorhanden und korrekt (512×512 px)
- [ ] manifest.json referenziert beide Icons korrekt
- [ ] sw.js CACHE_VERSION wurde hochgezählt

### Content
- [ ] Alle content/*.js Dateien syntaktisch valide (kein JS-Fehler)
- [ ] content-registry.js enthält alle neuen Kapitel
- [ ] Keine verwaisten Backup-Dateien (*.bak, *_old.*, *_backup.*)

### Code
- [ ] app.js ohne Syntaxfehler (node --check app.js)
- [ ] styles.css ausgewogene Klammern
- [ ] index.html lädt alle Skripte in korrekter Reihenfolge

### Funktionalität (manueller Smoke-Test)
- [ ] App startet ohne Konsolenfehler
- [ ] Lernkarten-Navigation vorwärts/rückwärts
- [ ] Quiz beantwortet und Ergebnis korrekt angezeigt
- [ ] Mock Exam startet und Timer läuft
- [ ] Mixed Review startet (oder Hinweis erscheint)
- [ ] PWA installierbar (kein Manifest-Fehler in DevTools)

### Automatisierter Asset-Check
Ausführen: `node check_release.js`
