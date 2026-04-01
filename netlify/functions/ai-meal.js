exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { description } = JSON.parse(event.body);
    if (!description) return { statusCode: 400, body: JSON.stringify({ error: 'No description provided' }) };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Break down this meal into individual food items and estimate nutritional content. Assume standard home-cooked or restaurant portions.\n\nMeal: "${description}"\n\nRespond with ONLY valid JSON, no markdown, no explanation:\n{"meal_name":"short name","items":[{"name":"item name","cal":000,"protein":0.0,"carbs":0.0,"fat":0.0}]}`
        }]
      })
    });

    const data = await res.json();
    console.log('Anthropic response status:', res.status);
    console.log('Anthropic response:', JSON.stringify(data).slice(0, 500));

    const text = data.content?.[0]?.text || '';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: text })
    };
  } catch(e) {
    console.log('Function error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
