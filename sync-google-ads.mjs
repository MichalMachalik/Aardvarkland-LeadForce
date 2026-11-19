import { databaseFile } from './config.mjs';
import { syncWindow } from './google-ads.mjs';
import { googleAdsProvider } from './google-ads-provider.mjs';
import { openStore } from './store.mjs';

async function main() {
  const [workspace, from, to, extra] = process.argv.slice(2);
  if (!workspace || extra || Boolean(from) !== Boolean(to)) throw new Error('Použití: npm run sync:google-ads -- <organizace> [od do]');
  const provider = googleAdsProvider();
  if (!provider) throw new Error('Na serveru chybí konfigurace Google Ads.');
  const store = openStore(databaseFile());
  try {
    const { actor, campaigns } = store.googleAds.jobForWorkspace(workspace);
    const dates = from ? { from, to } : syncWindow();
    if (!campaigns.length) console.log('Organizace nemá napojenou kampaň Google Ads.');
    for (const entry of campaigns) {
      try {
        const plan = store.googleAds.plan(actor, { campaign: entry.campaign_id, ...dates });
        const result = store.googleAds.apply(actor, plan, await provider.read(plan));
        console.log(JSON.stringify({ campaign: entry.campaign_id, ...result }));
        if (result.missing.length) process.exitCode = 1;
      } catch (error) {
        console.error('Kampaň ' + entry.campaign_id + ' · ' + error.message);
        process.exitCode = 1;
      }
    }
  } finally {
    store.close();
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
