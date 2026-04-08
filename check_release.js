#!/usr/bin/env node
// WSET App – automatisierter Pre-Release Asset-Check
const fs   = require("fs");
const path = require("path");

const BASE = __dirname;
let errors = 0;
let warnings = 0;

function check(condition, msg, level = "ERROR") {
  if (!condition) {
    console.log((level === "ERROR" ? "✗ ERROR" : "⚠ WARN ") + "  " + msg);
    if (level === "ERROR") errors++;
    else warnings++;
  } else {
    console.log("✓       " + msg);
  }
}

console.log("=== WSET App Pre-Release Check ===\n");

// 1 – Icons
check(fs.existsSync(path.join(BASE, "icon-192.png")), "icon-192.png vorhanden");
check(fs.existsSync(path.join(BASE, "icon-512.png")), "icon-512.png vorhanden");

// 2 – Manifest
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(BASE, "manifest.json"), "utf8"));
  const iconSizes = manifest.icons.map(i => i.sizes);
  check(iconSizes.includes("192x192"), "manifest.json: 192×192 Icon eingetragen");
  check(iconSizes.includes("512x512"), "manifest.json: 512×512 Icon eingetragen");
} catch (e) {
  check(false, "manifest.json: Parse-Fehler");
}

// 3 – Service Worker Cache-Version
const sw = fs.readFileSync(path.join(BASE, "sw.js"), "utf8");
const cvMatch = sw.match(/CACHE_NAME\s*=\s*['"]([\w-]+)['"]/);
check(cvMatch, "sw.js: CACHE_NAME gefunden" + (cvMatch ? " (" + cvMatch[1] + ")" : ""));

// 4 – JS Dateien haben registerChapterContent oder keine Fehler-Zeichen
["app.js", "chapters.js", "sections.js", "content-registry.js"].forEach(f => {
  const filePath = path.join(BASE, f);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    // Simple: check for balanced braces and reasonable length
    const braceBalance = (content.match(/{/g) || []).length === (content.match(/}/g) || []).length;
    check(braceBalance, f + " – Klammern balanciert");
  } catch (e) {
    check(false, f + " – Datei nicht lesbar");
  }
});

// 5 – Content-Dateien vorhanden
const contentDir = path.join(BASE, "content");
let contentCount = 0;
try {
  const files = fs.readdirSync(contentDir).filter(f => f.endsWith(".js"));
  contentCount = files.length;
  check(files.length > 30, `Alle content/*.js – ${files.length} Dateien gefunden`);
} catch (e) {
  check(false, "content/ – Verzeichnis nicht gefunden");
}

// 6 – Backup-Dateien
const backupPattern = /\.(bak|backup|old|tmp)$|_old\.|_backup\.|_bak\./i;
const allFiles = fs.readdirSync(BASE);
const backups = allFiles.filter(f => backupPattern.test(f));
check(backups.length === 0, "Keine Backup-Dateien im Root-Verzeichnis" +
  (backups.length > 0 ? ": " + backups.join(", ") : ""), backups.length > 0 ? "WARN" : "OK");

// 7 – content_backup Ordner
check(!fs.existsSync(path.join(BASE, "content_backup")),
  "Kein content_backup-Ordner im Paket", "WARN");

console.log("\n=== Ergebnis: " + errors + " Fehler, " + warnings + " Warnungen ===");
process.exit(errors > 0 ? 1 : 0);
