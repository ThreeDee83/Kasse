import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const storage = new Map();
const rpcCalls = [];
globalThis.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { onLine: false }
});
globalThis.addEventListener = () => {};
globalThis.KASSENRAUM_CONFIG = {
  supabaseUrl: "https://offline-test.supabase.co",
  supabaseAnonKey: "test-anon-key"
};
globalThis.supabase = {
  createClient: () => ({
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      return { data: params.target_entry, error: null };
    }
  })
};

await import(pathToFileURL(resolve("cloud.js")));

const entry = {
  id: "7a4e40a4-93f2-4b2e-87f2-39b5335f3bb5",
  employeeId: "343f7581-a3f4-45e6-b3bd-7679186d7af8",
  locationId: "50294077-518d-40fa-a8eb-193b68f1f84d",
  clockIn: "2026-08-25T18:00:00.000Z",
  clockOut: null,
  note: ""
};

globalThis.CloudStore.queueOfflineTimeEntry(entry);
globalThis.CloudStore.queueOfflineTimeEntry({ ...entry, clockOut: "2026-08-25T22:00:00.000Z" });
let queue = JSON.parse(storage.get("kassenraum-sync-queue"));
assert.equal(queue.length, 1, "Stempelaktionen derselben Schicht müssen zusammengefasst werden");
assert.equal(queue[0].entry.clockOut, "2026-08-25T22:00:00.000Z");

globalThis.navigator.onLine = true;
const result = await globalThis.CloudStore.flushQueue();
queue = JSON.parse(storage.get("kassenraum-sync-queue"));
assert.equal(queue.length, 0, "Erfolgreich synchronisierte Aktionen müssen aus der Warteschlange entfernt werden");
assert.equal(result.synced, 1);
assert.equal(rpcCalls[0].name, "sync_offline_time_entry");
assert.equal(rpcCalls[0].params.target_entry, entry.id);
assert.equal(rpcCalls[0].params.entry_clock_out, "2026-08-25T22:00:00.000Z");

console.log("Offline-Stempelwarteschlange erfolgreich geprüft.");
