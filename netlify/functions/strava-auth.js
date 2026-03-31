exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 302,
      headers: { Location: '/?strava_error=' + error }
    };
  }

  if (!code) {
    return { statusCode: 400, body: 'Missing code' };
  }

  try {
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: '218912',
        client_secret: '6f4c340ee0f9af730f33f16dac6d4445f92d221f',
        code,
        grant_type: 'authorization_code'
      })
    });

    const data = await res.json();

    if (data.errors) {
      return {
        statusCode: 302,
        headers: { Location: '/?strava_error=token_exchange_failed' }
      };
    }

    const params = new URLSearchParams({
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token,
      strava_expires_at: data.expires_at,
      strava_athlete: JSON.stringify({ id: data.athlete?.id, name: data.athlete?.firstname })
    });

    return {
      statusCode: 302,
      headers: { Location: '/?' + params.toString() }
    };

  } catch (e) {
    return {
      statusCode: 302,
      headers: { Location: '/?strava_error=server_error' }
    };
  }
};
