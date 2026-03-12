export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { amount, customer_phone } = req.body;

  const order_id = "order_" + Date.now();

  const response = await fetch("https://sandbox.cashfree.com/pg/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY,
      "x-api-version": "2022-09-01"
    },
    body: JSON.stringify({
      order_id: order_id,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: "cust_" + Date.now(),
        customer_phone: customer_phone
      }
    })
  });

  const data = await response.json();

  res.status(200).json(data);
}