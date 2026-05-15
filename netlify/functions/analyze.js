exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { image, mediaType } = JSON.parse(event.body);
    const prompt = "You are a junk removal estimator for Junk Relief LLC, Clarksville TN. Analyze this photo and estimate using these prices: BOX SPRINGS: Twin $15, Full $20, Queen $20, King $30. ADJUSTABLE BASES: Twin $35, Full $35, Queen $40, King $45. MATTRESSES: Crib $15, Twin $25, Full $30, Queen $35, King $40, Topper $20. BED FRAMES: Twin $35, Full $40, Queen $45, King $55. HEADBOARD $25, FOOTBOARD $25, NIGHTSTAND $20, ARMOIRE $75. BUNK BED: Disassembled $85, Not Disassembled $125. DRESSERS: Vertical $40, Horizontal $50, Double $55, Combo $60, Mirror $30, Lingerie Chest $35. SOFAS: Couch/Loveseat $30, Sleeper Sofa $70, Reclining Sofa $95, Recliner $55, Reclining Loveseat $75. SECTIONALS: 2pc $50, 3pc $75, 4pc $125, 5pc $150, 6pc+ $200, w/Recliner $225, w/Sleeper $250. LIVING ROOM: Coffee Table $25, End Table $20, TV Stand $45, Small Bookshelf $20, Large Bookshelf $35, Ottoman $20, Accent Chair $25. APPLIANCES: Fridge $75, Mini Fridge $35, Chest Freezer $60, Washer $60, Dryer $50, Dishwasher $45, Stove $55, Microwave $20, Water Heater $75, Window AC $40, Central AC $95. ELECTRONICS: TV under 40in $35, TV 40-60in $55, TV over 60in $75, Desktop Computer $30, Laptop $20, Printer $25, Monitor $25. OFFICE: Office Chair $25, Small Desk $40, Large Desk $60, 2-drawer Filing Cabinet $35, 4-drawer Filing Cabinet $55. CARDBOARD: Single Box $7, Bundle of 10 Broken Down $25, Small Bale $40, Medium Bale $75, Large Bale $125. OUTDOOR: Push Mower $45, Riding Mower $125, Small Grill $35, Large Grill $55, Patio Chair $15, Patio Table $35, Patio Set $85, Swing Set Disassembled $95, Swing Set Not Disassembled $150, Trampoline $125, Shed Contents $150, Fence Panel $15, Bag of Yard Waste $10. EXERCISE: Residential Treadmill $95, Commercial Treadmill $200, Weight Bench $45, Dumbbells per set $25, Elliptical $85, Stationary Bike $55, Rowing Machine $65, Squat Rack $95. MISC: Bag of Junk $10, Upright Piano $250, Safe under 100lbs $75, Safe over 100lbs $150, Hot Tub $350, Pool Table $200, Bag of Clothing $10, Tire $15, Bag of Construction Debris $20. MINIMUM CHARGE: $35 - if total is under $35 set total to 35. Return ONLY valid JSON with no markdown: {\"items\":[{\"name\":\"item name\",\"qty\":1,\"unit\":50,\"sub\":50}],\"total\":50,\"notes\":\"one sentence\"}";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: "API error: " + data.error.message }) };
    }
    const text = data.content.map(function(c) { return c.text || ""; }).join("").replace(/```json|```/g, "").trim();
    const result = JSON.parse(text);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
