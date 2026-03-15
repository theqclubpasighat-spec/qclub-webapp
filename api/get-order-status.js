export default async function handler(req, res) {
  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).json({ error: "Missing order_id" });
  }

  try {
    const response = await fetch(`https://api.cashfree.com/pg/orders/${order_id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": process.env.CASHFREE_APP_ID,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY,
        "x-api-version": "2022-09-01"
      }
    });

    const data = await response.json();

    return res.status(200).json(data);
  } catch (err) {
    console.error("get-order-status error:", err);
    return res.status(500).json({ error: "Failed to fetch order status" });
  }
}