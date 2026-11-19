# Aardvarkland LeadForce

Pracovní prostor pro tým, který měří kampaně, kvalifikuje poptávky a navazuje péčí o investory. Audit kampaní a Kontrola před spuštěním jsou dostupné týmu z přehledu. Investor má vlastní účet, přehled portfolia a schránku.

[Veřejné demo](https://michalmachalik.github.io/Aardvarkland-LeadForce/) · [Produktová analýza](ANALYZA.md) · [Plán dalších vydání](ROADMAP.md)

## Veřejné demo

Vyberte jednu z pěti rolí. Volba **Otevřít další roli** otevře nový panel. Každý panel má vlastní přihlášení a uživatelé ve stejném prohlížeči pracují nad společnými záznamy. Údaje i změny se ukládají v tomto profilu prohlížeče, kde přežijí obnovení stránky. Další návštěvníci mají vlastní prostor. Na přihlašovací stránce lze obnovit výchozí data.

Pro ukázku používejte smyšlené údaje a e-maily s koncovkou `.example`. Pozvánka funguje v jiném panelu stejného profilu prohlížeče. K vyzkoušení jiného zařízení nebo identit v oddělených prohlížečích slouží serverová verze. Veřejná ukázka žádné zprávy neposílá.

### Průchod od kampaně k investorovi

1. V **Marketingu** vytvořte poptávku s projektem, kanálem a ID kampaně.
2. V **Kvalifikaci** otevřete poptávku, převezměte ji a změňte stav na kontaktovanou. Přidejte interní poznámku, vyberte kolegu pro upozornění a poptávku kvalifikujte.
3. V **Péči** zkontrolujte poznámku, převezměte poptávku a označte ji jako předanou. Propojte účet investora. Pokud chybí, vznikne odkaz na jednorázovou pozvánku.
4. V dalším panelu založte účet z pozvánky. Z **Péče** přidejte tomuto účtu pozici a zveřejněte koncept zprávy. V účtu investora otevřete portfolio a zprávu. Stav přečtení se objeví po obnovení přehledu na straně péče.
5. Ve **Správě** projděte uživatele, historii organizace a upozornění. **Marketing** může stáhnout CSV pro import do Auditu. Export obsahuje identifikátor poptávky, kanál, kampaň, stav a data, jména a e-maily v něm chybí.

## Spuštění čisté verze

Po instalaci Node.js 24 nebo novější spusťte nastavení a aplikaci v interaktivním terminálu.

```powershell
node setup.mjs
npm start
```

Nastavení se zeptá na název a identifikátor organizace, jméno a e-mail správce a heslo (nejméně 12 znaků). Otevřete [přihlášení](http://127.0.0.1:4190/) a použijte zadané údaje. Správce pozve další uživatele přes **Uživatelé**. Pozvánku lze použít jednou během 24 hodin. Odkaz se kopíruje v aplikaci a předává se mimo ni. Po spuštění jsou poptávky, pozice i zprávy prázdné. SQLite soubor se vytvoří při prvním nastavení nebo spuštění služby.

| Nastavení | Účel |
| --- | --- |
| `WORKSPACE_DATA` | Absolutní cesta k databázi. Výchozí umístění je `data/workspace.sqlite` ve složce aplikace. Použijte stejnou cestu pro nastavení a následný start. |
| `WORKSPACE_PORT` | Místní port. Výchozí port čisté verze je 4190, port dema je 4191. |
| `WORKSPACE_ORIGIN` | HTTPS adresa v případě nasazení za reverzní proxy, bez cesty nebo parametrů. Pro místní start se odvodí z portu. |

Služba poslouchá pouze na `127.0.0.1`. Pro nasazení potřebuje vlastní HTTPS doménu, reverzní proxy, trvalý disk a spravovaný proces. Proxy musí předávat hlavičku `Origin` a měla by samostatně omezovat počet požadavků na přihlašovací trasy. Aplikace omezuje pokusy podle bezprostředního síťového protějšku, který je při tomto nasazení proxy. Endpoint `/health` slouží ke kontrole běžícího HTTP procesu.

Při zálohování po korektním zastavení služby zkopírujte databázi a případné související soubory WAL. Za běhu použijte nástroj, který zálohuje konzistentní SQLite snímek. Ověřte obnovu na odděleném serveru. Přístup k datovému adresáři, zálohám a propojeným nástrojům svěřte jen oprávněným uživatelům. Importované soubory pracují v oddělených nástrojích v prohlížeči.

## Ověření

Příkaz `npm test` spouští testy serverových oprávnění a obnovy stavu. `npm run demo` spustí místní serverovou ukázku s fiktivními daty na portu 4191. Sdílený průchod v prohlížeči je v `test/browser.cjs`. Vyžaduje Playwright a prohlížeč. `TEST_URL` umožňuje ověřit i veřejné sestavení, `TEST_ENGINE` vybírá `chromium`, `firefox` nebo `webkit`.

Příkazy `npm ci` a `npm run build` vytvoří v `dist/` statický build. Prohlížeč používá stejný model a pravidla jako server v samostatném workeru se SQLite a ukládá stav do IndexedDB. Build neobsahuje žádný serverový datový soubor.

## Licence

Apache-2.0. Písmo Inter, sql.js a kryptografická knihovna mají vlastní licence přiložené v sestavení.
