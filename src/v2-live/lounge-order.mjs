// Q Lounge's shared, read-only cart projection: current master catalogue
// determines price and availability, never cached client-submitted totals.
export function canOrderLoungeItem(item) {
  return Boolean(item && item.inStock !== false && item.onlineOrderEnabled !== false);
}

export function loungeOrderLines(cart, categories) {
  const catalog = new Map(
    categories.flatMap((category) => category.items.map((item) => [item.id, item]))
  );
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: catalog.get(id), qty: Number(qty) }))
    .filter(({ item, qty }) => item && canOrderLoungeItem(item) && Number.isInteger(qty) && qty > 0 && qty <= 100)
    .map(({ item, qty }) => ({
      id: item.id,
      name: item.name,
      qty,
      price: Number(item.price),
      lineTotal: Number(item.price) * qty,
    }));
}
