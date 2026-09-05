import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const indexHtml = await readFile("index.html", "utf8");
assert.equal(/<script[^>]+src="https?:\/\//i.test(indexHtml), false, "Skripte dürfen für den Offline-Start nicht von einem CDN geladen werden");

const scriptSources = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
for (const source of scriptSources) {
  const localPath = source.split("?")[0];
  assert.equal(existsSync(localPath), true, `Fehlende lokale Scriptdatei: ${localPath}`);
}

const serviceWorker = await readFile("sw.js", "utf8");
const shellMatch = serviceWorker.match(/const APP_SHELL = (\[[^;]+\]);/);
assert.ok(shellMatch, "APP_SHELL konnte nicht gelesen werden");
const appShell = JSON.parse(shellMatch[1]);
for (const source of appShell) {
  if (source === "./") continue;
  assert.equal(existsSync(source.replace(/^\.\//, "")), true, `Fehlende Offline-Datei: ${source}`);
}
assert.match(serviceWorker, /ignoreSearch:\s*true/, "Versionierte Assets müssen ohne Query-String aus dem Cache geladen werden");

const appSource = await readFile("app.js", "utf8");
assert.match(appSource, /staffToolsVisibilityKey/, "Die User-Sichtbarkeit für Abrechnung und Arbeitszeit fehlt");
assert.match(appSource, /logoutLongPressTimer[\s\S]*1200/, "Der 1,2-sekündige Longpress auf Abmelden fehlt");
assert.match(appSource, /5 \* 60 \* 1000/, "Das automatische Ausblenden nach fünf Minuten fehlt");
assert.match(appSource, /reportsButton[\s\S]*timeClockButton/, "Abrechnung und Arbeitszeit müssen gemeinsam geschaltet werden");

const bcryptSource = await readFile("vendor/bcrypt.min.js", "utf8");
const browserContext = { dcodeIO: {}, self: { crypto: webcrypto }, setTimeout, clearTimeout };
vm.runInNewContext(bcryptSource, browserContext);
const bcrypt = browserContext.dcodeIO.bcrypt;
const sampleHash = bcrypt.hashSync("1234", 6);
assert.equal(bcrypt.compareSync("1234", sampleHash), true);
assert.equal(bcrypt.compareSync("4321", sampleHash), false);

const kdsHtml = await readFile("kds/index.html", "utf8");
assert.equal(/<script[^>]+src="https?:\/\//i.test(kdsHtml), false, "Das KDS darf keine CDN-Skripte benötigen");
assert.doesNotMatch(kdsHtml, /completeForm|pagerInput/, "Das KDS darf keine zentrale Pager-Fertigmeldung mehr enthalten");
assert.match(kdsHtml, /clearHistoryButton/, "Im erledigten Verlauf fehlt die Löschfunktion");
for (const path of ["kds/kds.js", "kds/kds.css", "kds/sw.js", "kds-order.js"]) {
  assert.equal(existsSync(path), true, `Fehlende KDS-Datei: ${path}`);
}
const kdsScript = await readFile("kds/kds.js", "utf8");
assert.match(kdsScript, /currentView === "open"[\s\S]*complete-order-button/, "Offene KDS-Karten benötigen einen Erledigt-Button");
assert.match(kdsScript, /60 \* 60 \* 1000/, "Die automatische einstündige KDS-Aufbewahrung fehlt");

console.log("Offline-Assets und bcrypt-PIN-Prüfung erfolgreich geprüft.");
