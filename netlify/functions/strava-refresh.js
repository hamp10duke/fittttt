exports.handler = async (event) => {
  const { refresh_token } = JSON.parse(event.body || '{}');
  if (!refresh_token) return { statusCode: 400, body: 'Missing refresh_token' };

  const CLIENT_ID = '218912';
  const CLIENT_SECRET = '6f4c340ee0f9af730f33f16dac6d4445f92d221f';

  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
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
        refresh_token: data.refresh_token,
        expires_at: data.expires_at
      })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
