exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, customerName, email, phone, address, notes, pricingStr } = JSON.parse(event.body);

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: 'usd',
      receipt_email: email,
      description: `Junk Relief LLC — ${pricingStr}`,
      metadata: {
        customer_name: customerName,
        phone: phone || '',
        address: address || '',
        notes: notes || '',
        items: pricingStr
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
