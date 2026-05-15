exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { image, mediaType } = JSON.parse(event.body);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "You are a junk removal estimator for Junk Relief LLC, Clarksville TN. Look at this photo and identify every item you see. Use these prices: Couch/Loveseat $30, Sleeper Sofa $70, Recliner $55, Sectional 2pc $50, 3pc $75, 4pc $125, 5pc $150, 6pc+ $200, Mattress Twin $25, Full $30, Queen $35, King $40, Box Spring $20, Bed Frame $45, Dresser $50, Nightstand $20, Armoire $75, Fridge $75, Washer $60, Dryer $50, Stove $55, Dishwasher $45, Microwave $20, Water Heater $75, Window AC $40, TV under 40in $35, TV 40-60in $55, TV over 60in $75, Desktop $30, Laptop $20, Printer $25, Office Chair $25, Desk $50, Filing Cabinet $45, Lawn Mower push $45, riding $125, Grill $45, Patio Set $85, Trampoline $125, Treadmill $95, Elliptical $85, Stationary Bike $55, Weight Bench $45, Piano $250, Hot Tub $350, Pool Table $200, Safe $100, Tire $15, Bag of Junk $10. Minimum charge $35. Respond with ONLY this JSON and nothing else: {\"items\":[{\"name\":\"Couch\",\"qty\":1,\"unit\":30,\"sub\":30}],\"total\":35,\"notes\":\"brief note\"}" }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }
    const raw = data.content[0].text.trim();
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const result = JSON.parse(cleaned);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
