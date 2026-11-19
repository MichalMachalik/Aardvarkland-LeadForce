import { Failure } from './validation.mjs';

export function googleAdsProvider(env = process.env, send = fetch) {
  const { GOOGLE_ADS_DEVELOPER_TOKEN: developerToken, GOOGLE_ADS_CLIENT_ID: clientId,
    GOOGLE_ADS_CLIENT_SECRET: secret, GOOGLE_ADS_REFRESH_TOKEN: refreshToken,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: manager, GOOGLE_ADS_API_VERSION: version = 'v26' } = env;
  if (![developerToken, clientId, secret, refreshToken].every(Boolean)) return null;
  if (!/^v\d{1,3}$/.test(version) || (manager && !/^\d{10}$/.test(manager))) {
    throw new Failure(422, 'Zkontrolujte verzi Google Ads API a ID účtu správce.');
  }

  async function post(url, options) {
    try {
      const response = await send(url, { ...options, method: 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch {
      throw new Failure(502, 'Google Ads je nedostupné nebo odmítlo požadavek. Zkontrolujte přístup a zkuste import znovu.');
    }
  }

  return {
    mode: 'live',
    async read(plan) {
      const oauth = await post('https://oauth2.googleapis.com/token', {
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: refreshToken }),
      });
      if (typeof oauth?.access_token !== 'string' || !oauth.access_token) throw new Failure(502, 'Přihlášení ke Google Ads se nezdařilo.');
      const headers = {
        Authorization: 'Bearer ' + oauth.access_token, 'developer-token': developerToken, 'Content-Type': 'application/json',
        ...(manager ? { 'login-customer-id': manager } : {}),
      };
      const endpoint = 'https://googleads.googleapis.com/' + version + '/customers/' + plan.customer + '/googleAds:searchStream';
      const search = (query) => post(endpoint, { headers, body: JSON.stringify({ query }) });
      const [account, campaigns] = await Promise.all([
        search('SELECT customer.id, customer.currency_code, customer.time_zone FROM customer'),
        search('SELECT campaign.id, segments.date, metrics.cost_micros FROM campaign WHERE campaign.id = ' + plan.external +
          " AND segments.date BETWEEN '" + plan.from + "' AND '" + plan.to + "'"),
      ]);
      return { account, campaigns };
    },
  };
}
