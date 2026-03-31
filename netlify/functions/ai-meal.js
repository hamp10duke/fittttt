exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { description } = JSON.parse(event.body);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: `Break down this meal into individual food items and estimate nutritional content. Assume standard portions.\n\nMeal: "${description}"\n\nRespond with ONLY a JSON object, no other text:\n{\n  "meal_name": "short name",\n  "items": [\n    { "name": "item", "cal": 000, "protein": 00.0, "carbs": 00.0, "fat": 00.0 }\n  ]\n}` }]
      })
    });
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: data.content?.[0]?.text || '' })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
