exports.handler = async (event) => {
  const key = process.env.ANTHROPIC_API_KEY;
  
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      }
    });
    const data = await res.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ status: res.status, key_prefix: key?.slice(0,20), models: data })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
