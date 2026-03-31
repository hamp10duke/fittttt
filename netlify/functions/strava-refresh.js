exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { refresh_token } = JSON.parse(event.body);
    if (!refresh_token) return { statusCode: 400, body: 'Missing refresh_token' };

    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: '218912',
        client_secret: '6f4c340ee0f9af730f33f16dac6d4445f92d221f',
        refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: data.access_token,
        expires_at: data.expires_at
      })
    };
  } catch (e) {
    return { statusCode: 500, body: 'Server error' };
  }
};
