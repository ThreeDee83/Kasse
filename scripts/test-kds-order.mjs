import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

await import(pathToFileURL(resolve("kds-order.js")));

const categories = [
  { id: "food", name: "Speisen" },
  { id: "drinks", name: "Getränke" }
];
const products = [
  { id: "soup", name: "Suppe", categoryId: "food" },
  { id: "soup-special", name: " Suppe ", categoryId: "drinks" },
  { id: "water", name: "Wasser", categoryId: "drinks" }
];
const cart = [
  { productId: "soup", quantity: 2 },
  { productId: "soup-special", quantity: 1 },
  { productId: "water", quantity: 1 }
];

assert.deepEqual(globalThis.KdsOrder.foodItemsFromCart(cart, products, categories), [
  { productId: "soup", name: "Suppe", quantity: 3 }
]);
assert.equal(globalThis.KdsOrder.isFoodProduct(products[1], products, categories), true);
assert.deepEqual(globalThis.KdsOrder.foodItemsFromSale({ items: [
  { productId: "soup", name: "Suppe", categoryName: "Speisen", quantity: 2 },
  { productId: "old", name: "Storniert", categoryName: "Speisen", quantity: 1, canceled: true },
  { productId: "soup-special", name: "Suppe", categoryName: "Getränke", isKdsFood: true, quantity: 1 },
  { productId: "water", name: "Wasser", categoryName: "Getränke", quantity: 1 }
] }), [{ productId: "soup", name: "Suppe", quantity: 3 }]);
assert.equal(globalThis.KdsOrder.normalizePagerNumber(" 24 "), "24");
assert.equal(globalThis.KdsOrder.normalizePagerNumber("24A"), "");
assert.equal(globalThis.KdsOrder.normalizePagerNumber("1234567"), "");

console.log("KDS-Speisenfilter und Pager-Prüfung erfolgreich geprüft.");
