# Aardvarkland LeadForce

CRM pro zpracování poptávek od kampaně přes kvalifikaci a předání klientovi až po péči o investora.

[Týmový prostor](https://michalmachalik.github.io/Aardvarkland-LeadForce/) · [Audit kampaní](https://michalmachalik.github.io/Aardvarkland-LeadForce/audit-kampani/) · [Kontrola před spuštěním](https://michalmachalik.github.io/Aardvarkland-LeadForce/kontrola-pred-spustenim/) · [Portál investora](https://michalmachalik.github.io/Aardvarkland-LeadForce/portal-investora/)

## Architektura

- Server běží na Node.js 24+ a používá HTTP API, SQLite (`node:sqlite`) a frontend v `public/`. Přístup oddělují role správce, marketing, kvalifikace, péče, klient a investor.
- GitHub Pages sestavuje stejná doménová pravidla do samostatného workeru se SQLite přes sql.js. Fiktivní záznamy a změny se ukládají do IndexedDB v profilu prohlížeče. Role lze zkoušet současně v několika kartách. Pozvánky fungují uvnitř stejného profilu. Import Google Ads používá simulované odpovědi.
- Pracovní postupy zahrnují předání a reklamace s přiřazením řešitele, interní audit, klientské uzávěrky s historií verzí a investorské portfolio se zprávami. Lhůty reklamací se počítají v pracovní době `Europe/Prague` s vynecháním víkendů a svátků. Předání reklamace mezi řešiteli termín zachová.

## Lokální server

Vyžaduje Node.js 24+. Interaktivní nastavení založí organizaci a správce v prázdné databázi. Schéma databáze se aktualizuje při otevření. Další účty přidává správce pozvánkou.

```sh
node setup.mjs
npm start
```

Server běží na [portu 4190](http://127.0.0.1:4190/). `npm run demo` spustí místní demo s fiktivními daty na portu 4191.

| Proměnná | Nastavení |
| --- | --- |
| `WORKSPACE_DATA` | Cesta k trvalé SQLite databázi. Výchozí hodnota je `data/workspace.sqlite`. |
| `WORKSPACE_PORT` | Port lokální služby. |
| `WORKSPACE_ORIGIN` | Veřejný HTTPS původ bez cesty při nasazení za proxy. |

Pro síťové nasazení použijte HTTPS proxy a trvalý disk. Proxy předává hlavičku Origin a omezuje požadavky na přihlášení. `/health` ověřuje HTTP proces, `/ready` také čtení databáze. `npm run backup -- cesta-k-nove-zaloze.sqlite` vytvoří ověřený snímek.

## Google Ads

Serverový konektor používá `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` a `GOOGLE_ADS_REFRESH_TOKEN`. Volitelné jsou `GOOGLE_ADS_LOGIN_CUSTOMER_ID` a `GOOGLE_ADS_API_VERSION` (výchozí `v26`). Podporované účty mají měnu CZK a pásmo `Europe/Prague`.

Po napojení účtu a kampaně lze import spustit z rozhraní nebo příkazem `npm run sync:google-ads -- <organizace> [od do]`. Výchozí okno je sedm posledních uzavřených dní. Opakovaný import aktualizuje tentýž den a kampaň. Chybějící řádek zůstává k ověření. Cena za předání vychází z evidovaných výdajů a skutečných předání ve stejném období.

## Build a testy

```sh
npm ci
npx playwright install chromium
npm run test:release
```

`npm run test:release` prověří doménová pravidla, sestaví web a spustí uživatelské scénáře v prohlížeči. Stejný balíček lze sestavit samostatně a otevřít na [localhostu](http://127.0.0.1:4192/).

```sh
npm run build
python -m http.server 4192 --bind 127.0.0.1 --directory dist
```

V kořeni je týmový prostor. Cesty `audit-kampani/`, `kontrola-pred-spustenim/` a `portal-investora/` otevírají jednotlivé nástroje přímo. [Analýza](ANALYZA.md) · [Plán vývoje](ROADMAP.md)

## Licence

[Apache-2.0](LICENSE) · [NOTICE](NOTICE)
