(function (global) {
  "use strict";

  function normalizedName(value) {
    return String(value || "").trim().toLocaleLowerCase("de");
  }

  function isFoodCategoryName(value) {
    return normalizedName(value) === "speisen";
  }

  function isKdsExcludedCategoryName(value) {
    return normalizedName(value) === "bruch";
  }

  function normalizePagerNumber(value) {
    const pagerNumber = String(value || "").trim();
    return /^\d{1,6}$/.test(pagerNumber) ? pagerNumber : "";
  }

  function foodProductNames(products, categories) {
    const categoriesById = new Map((categories || []).map((category) => [String(category.id), category]));
    return new Set((products || []).filter((product) =>
      isFoodCategoryName(categoriesById.get(String(product?.categoryId))?.name)
    ).map((product) => normalizedName(product.name)).filter(Boolean));
  }

  function isFoodProduct(product, products, categories) {
    const categoriesById = new Map((categories || []).map((category) => [String(category.id), category]));
    const selectedCategory = categoriesById.get(String(product?.categoryId));
    return Boolean(product)
      && !isKdsExcludedCategoryName(selectedCategory?.name)
      && foodProductNames(products, categories).has(normalizedName(product.name));
  }

  function mergeFoodItems(items) {
    const merged = new Map();
    (items || []).forEach((item) => {
      const key = normalizedName(item.name) || String(item.productId || "");
      const quantity = Number(item.quantity || 0);
      if (!key || quantity <= 0) return;
      const existing = merged.get(key);
      if (existing) existing.quantity += quantity;
      else merged.set(key, { productId: item.productId || null, name: String(item.name || "Artikel"), quantity });
    });
    return [...merged.values()];
  }

  function foodItemsFromCart(cart, products, categories) {
    const productsById = new Map((products || []).map((product) => [String(product.id), product]));
    const categoriesById = new Map((categories || []).map((category) => [String(category.id), category]));
    const foodNames = foodProductNames(products, categories);
    return mergeFoodItems((cart || []).flatMap((entry) => {
      const product = productsById.get(String(entry.productId));
      const selectedCategory = categoriesById.get(String(product?.categoryId));
      if (!product || isKdsExcludedCategoryName(selectedCategory?.name) || !foodNames.has(normalizedName(product.name))) return [];
      return [{
        productId: product.id,
        name: product.name,
        quantity: Number(entry.quantity || 0)
      }];
    }));
  }

  function foodItemsFromSale(sale, products, categories) {
    const foodNames = foodProductNames(products, categories);
    return mergeFoodItems((sale?.items || []).filter((item) =>
      !isKdsExcludedCategoryName(item?.categoryName)
      && (item?.isKdsFood === true || isFoodCategoryName(item?.categoryName) || foodNames.has(normalizedName(item?.name)))
      && !item?.canceled && item?.status !== "canceled"
    ).map((item) => ({
      productId: item.productId || null,
      name: String(item.name || "Artikel"),
      quantity: Number(item.quantity || 0)
    })));
  }

  global.KdsOrder = { isFoodCategoryName, isKdsExcludedCategoryName, normalizePagerNumber, isFoodProduct, foodItemsFromCart, foodItemsFromSale };
})(globalThis);
