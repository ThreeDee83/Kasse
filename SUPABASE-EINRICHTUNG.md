# Supabase-Einrichtung für Kassenraum

Die ausführliche Anleitung von der Projekterstellung bis GitHub Pages findest du in `EINRICHTUNG-SCHRITT-FUER-SCHRITT.md`.

## 1. Projekt erstellen

1. Auf [supabase.com](https://supabase.com) anmelden.
2. **New project** auswählen und ein Projekt erstellen.
3. Eine Region möglichst nahe am Einsatzort wählen.

## 2. Datenbank vorbereiten

1. Im Supabase-Dashboard **SQL Editor** öffnen.
2. Den gesamten Inhalt aus `supabase-schema.sql` einfügen.
3. **Run** ausführen.

Das Schema aktiviert Row Level Security. Benutzer sehen ausschließlich Standorte, denen sie zugeordnet sind. Nur Administratoren dürfen Sortiment, Einstellungen und Umsatzlöschungen verwalten.

## 3. Sicherheitswarnungen

- **Public Can Execute SECURITY DEFINER Function**: Das aktuelle Schema entzieht öffentlichen Besuchern die Ausführung der Funktionen. Führe `supabase-schema.sql` erneut komplett aus, damit die `revoke`-Regeln übernommen werden.
- **Signed-In Users Can Execute SECURITY DEFINER Function**: Diese Warnung ist für einzelne RPC-Funktionen bewusst akzeptiert. Die Website braucht sie für Standortverwaltung und Stempeluhr; die Funktionen prüfen intern trotzdem Admin- oder Standortrechte.
- **Leaked Password Protection Disabled**: Im Supabase-Dashboard unter **Authentication → Security** aktivieren.

## 4. Ersten Benutzer anlegen

1. **Authentication → Users → Add user** öffnen.
2. E-Mail und Passwort festlegen.
3. Mit diesem Konto in Kassenraum anmelden.

Beim ersten Login wird automatisch der Standort **Hauptstandort** angelegt und der Benutzer dort als Administrator eingetragen.

## 5. Website verbinden

Unter **Project Settings → Data API** beziehungsweise **API** stehen:

- Project URL
- Publishable Key oder `anon` public Key

Beide Werte in `config.js` eintragen:

```js
window.KASSENRAUM_CONFIG = {
  supabaseUrl: "https://DEIN-PROJEKT.supabase.co",
  supabaseAnonKey: "DEIN-PUBLISHABLE-ODER-ANON-KEY"
};
```

Der öffentliche Schlüssel darf im Frontend stehen. Niemals den `service_role`-Schlüssel verwenden.

## 6. Weitere Benutzer zuordnen

Weitere Benutzer zuerst unter **Authentication → Users** anlegen. Anschließend ihre UUID sowie die Standort-UUID in diesem SQL einsetzen:

```sql
insert into public.user_locations (user_id, location_id, role)
values (
  'BENUTZER-UUID',
  'STANDORT-UUID',
  'staff'
);
```

Mögliche Rollen:

- `admin`: vollständiger Adminbereich
- `staff`: Kasse, Abrechnung und Kassenstand; keine Sortimentsverwaltung

## 7. GitHub Pages

Alle Projektdateien ins Repository hochladen und GitHub Pages auf `main` / `root` veröffentlichen. Nach Änderungen an `config.js` erneut hochladen.

## Hinweise

- Die App speichert einen lokalen Offline-Cache und synchronisiert nach Wiederherstellung der Verbindung.
- Die erste Online-Nutzung muss vollständig laden, damit die Service-Worker-Dateien und externen Bibliotheken gecacht werden.
- Supabase Free pausiert nach längerer Inaktivität und enthält keine automatischen Backups. Regelmäßige Excel-Exporte bleiben daher empfehlenswert.
