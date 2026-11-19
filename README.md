# Aardvarkland LeadForce

Pracovní prostor pro tým, který měří kampaně, kvalifikuje poptávky a navazuje péčí o investory. Audit kampaní a Kontrola před spuštěním jsou dostupné týmu z přehledu. Klient sleduje předané poptávky a náklady podle kampaní. Investor má vlastní portfolio a schránku.

[Veřejné demo](https://michalmachalik.github.io/Aardvarkland-LeadForce/) · [Produktová analýza](ANALYZA.md) · [Plán dalších vydání](ROADMAP.md)

Samostatné ukázky se sestavují ze zdrojů v `standalone/`. [Audit kampaní](https://michalmachalik.github.io/Aardvarkland-LeadForce/audit-kampani/) · [Kontrola před spuštěním](https://michalmachalik.github.io/Aardvarkland-LeadForce/kontrola-pred-spustenim/) · [Portál investora](https://michalmachalik.github.io/Aardvarkland-LeadForce/portal-investora/)

## Veřejné demo

Vyberte jednu ze šesti rolí. Volba **Otevřít další roli** otevře nový panel. Každý panel má vlastní přihlášení a uživatelé ve stejném prohlížeči pracují nad společnými záznamy. Údaje i změny se ukládají v tomto profilu prohlížeče, kde přežijí obnovení stránky. Další návštěvníci mají vlastní prostor. Na přihlašovací stránce lze obnovit výchozí data.

Pro ukázku používejte smyšlené údaje a e-maily s koncovkou `.example`. Pozvánka funguje v jiném panelu stejného profilu prohlížeče. K vyzkoušení jiného zařízení nebo identit v oddělených prohlížečích slouží serverová verze. Veřejná ukázka žádné zprávy neposílá.

### Průchod od kampaně k investorovi

1. V **Marketingu** vytvořte poptávku s projektem, kanálem a ID kampaně.
2. V **Kvalifikaci** otevřete poptávku, převezměte ji a změňte stav na kontaktovanou. Přidejte interní poznámku, vyberte kolegu pro upozornění a poptávku kvalifikujte.
3. V **Péči** zkontrolujte poznámku, převezměte poptávku a označte ji jako předanou. Propojte účet investora. Pokud chybí, vznikne odkaz na jednorázovou pozvánku.
4. V dalším panelu založte účet z pozvánky. Z **Péče** přidejte tomuto účtu pozici a zveřejněte koncept zprávy. V účtu investora otevřete portfolio a zprávu. Stav přečtení se objeví po obnovení přehledu na straně péče.
5. Ve **Správě** projděte uživatele, historii organizace a upozornění. **Marketing** může stáhnout CSV pro import do Auditu. Export obsahuje identifikátor poptávky, kanál, kampaň, stav a data, jména a e-maily v něm chybí.

### Průchod klientským reportem

1. V roli **Klient** otevřete přehled fiktivního Lípového bydlení. Vyberte kampaň **Byty pod Lípou**. Čerstvé výchozí demo ukazuje 1 890 Kč, dvě předání a 945 Kč za předání.
2. V roli **Marketing** nebo **Správce** otevřete **Klienti a kampaně** a upravte denní náklad. Stejný den a kampaň se přepíší. Historie správce zapisuje původní i novou částku.
3. Při zakládání nové poptávky vyberte klientskou kampaň. Projekt, kanál a ID se převezmou z kampaně. Správce může kampaň přiřadit i starší poptávce před předáním. Po změně stavu na **Předaná** a obnovení přehledu uvidí klient nový kontakt ve svém účtu.
4. V klientském účtu vyzkoušejte filtr do minulosti a stáhněte CSV. Souhrnný soubor obsahuje kampaně, výdaje a počty předání. Kontaktní údaje zůstávají v klientském přehledu.

Report počítá evidovaný výdaj v Kč dělený počtem skutečných předání ve stejném období. Oba konce období jsou zahrnuté a den předání odpovídá časovému pásmu Praha. Kampaň bez výdajů v evidenci se zobrazí jako **Bez evidence**. Zadaná nula je platný náklad. Pokud u kampaně s předáním výdaj chybí, souhrnný náklad na předání se nevyčíslí. U výdajů doplněných jen zčásti report ukazuje evidovaný součet. Uzavření dříve předané poptávky zachová historické předání.

Správce vytvoří klienta v **Klienti a kampaně** a v **Uživatelích** zvolí roli **Klient** a konkrétního klienta. Všichni pozvaní uživatelé tohoto klienta uvidí stejný přehled. Výběr kampaně ani export nezpřístupňuje záznamy jiného klienta.

### Potvrzení převzetí a reklamace

1. Jako **Klient** otevřete v tabulce **Předané poptávky** detail kontaktu **Zuzana Šedá**. Použijte **Potvrdit převzetí**.
2. V detailu vyberte důvod reklamace a případně připište popis. Pro **Jiný důvod** je popis povinný. Podání se objeví v detailu klienta i ve frontě týmu.
3. Jako **Péče** nebo **Správce** otevřete **Čeká na reakci** a převezměte reklamaci. Tlačítkem **Vyžádat podklady** odešlete klientovi dotaz přímo ve vlákně.
4. Jako **Klient** otevřete **Čeká na reakci**, vyberte případ a použijte **Doplnit podklady**. Na čerstvě otevřeném demu lze tenhle krok vyzkoušet rovnou u kontaktu **Hana Vítová**.
5. Doplněný případ se vrátí do fronty týmu. Při potřebě dalších podkladů lze postup zopakovat. Po uložení rozhodnutí zůstává výsledek i celé vlákno v detailu. Filtr **Vyřízené reklamace** zobrazí uznané i zamítnuté případy.

**Lhůty na reakci.** Výchozí pracovní doba je od pondělí do pátku od 08:00 do 16:00 v časovém pásmu Praha. Tým má 24 pracovních hodin od podání reklamace nebo od doplnění podkladů klientem. Převzetí reklamace původní termín zachová. Vyžádáním podkladů přechází odpočet na klienta, který má 72 pracovních hodin na odpověď. Víkendy, [české svátky včetně Velkého pátku a Velikonočního pondělí](https://e-sbirka.gov.cz/eli/cz/sb/2000/245/2026-05-13) a vložené dny volna se vynechávají. Po vypršení lhůty lze stále odpovědět nebo uložit rozhodnutí.

Správce může v **Lhůtách reklamací** změnit pracovní dobu, obě lhůty a doplnit mimořádné dny volna. Nastavení platí pro danou organizaci. Po uložení se termíny otevřených případů přepočítají od začátku aktuálního kola. Na dříve otevřené kartě se po zjištění změny zobrazí výzva k obnovení zobrazení.

Prošlé otevřené případy se zobrazí v **Eskalacích reklamací** u správce a členů péče s přístupem k danému předání. Fronta uvádí termín i stranu, od které se čeká na reakci. Podle aktuálního termínu se počty v aplikaci obnovují při návratu na kartu a průběžně při jejím otevření. Obsah vlákna se načte znovu tlačítkem **Obnovit detail**. V čerstvém demu najde role **Péče** případ **Hana Vítová** už po lhůtě. Po odpovědi klienta se vrátí mezi běžné případy na reakci týmu s novým termínem.

Potvrzení je jednorázové. U jednoho předání může tým současně řešit jednu reklamaci. Další podání po vyřízení vytvoří nový případ a starší rozhodnutí zůstává v historii. V přehledu péče jsou předání tohoto pracovníka a případy bez aktivního vlastníka. Správce vidí předání v celé organizaci. Vyjádření k reklamaci je součást klientského detailu, interní poznámky CRM zůstávají v týmové evidenci. Původní datum a počet předání pro výpočet kampaní vycházejí ze skutečně evidovaného předání.

### Pilot importu Google Ads

1. V roli **Marketing** otevřete **Klienti a kampaně**. Pod **Import Google Ads** je připravená kampaň **Byty pod Lípou**.
2. Ponechte tři poslední uzavřené dny a scénář **Chybějící den**. **Synchronizovat náklady** automaticky zpracuje simulovanou odpověď. Objeví se dva nové dny včetně potvrzené nuly a jeden nevykázaný den.
3. Opakujte stejný import. Nové i opravené záznamy zůstanou na nule. Zvolte **Doplněná data** pro obnovu chybějícího dne nebo **Opravený náklad** pro změnu již zpracované částky.
4. V roli **Klient** si obnovte přehled. U nevykázaného dne má report poznámku a cena za předání se dopočítá po doplnění. Poslední známý náklad zůstane v evidenci i při opětovném vynechání dne.

Import mapuje konkrétní účet a kampaň, čte denní `metrics.cost_micros` a částky převádí na haléře. Pro jeden den použije poslední známý importovaný náklad nebo případný ruční podklad. Opakovaná odpověď nenavyšuje výdaje. Zcela chybějící řádek je nevykázaný den. Google Ads může nulové řádky vynechat, proto takový den zůstává otevřený k ověření. [Google Ads – denní segmentace a nulové metriky](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics)

## Spuštění čisté verze

Po instalaci Node.js 24 nebo novější spusťte nastavení a aplikaci v interaktivním terminálu.

```powershell
node setup.mjs
npm start
```

Nastavení se zeptá na název a identifikátor organizace, jméno a e-mail správce a heslo (nejméně 12 znaků). Otevřete [přihlášení](http://127.0.0.1:4190/) a použijte zadané údaje. Správce pozve další uživatele přes **Uživatelé**. Pozvánku lze použít jednou během 24 hodin. Odkaz se kopíruje v aplikaci a předává se mimo ni. Při prvním spuštění jsou klienti, kampaně, náklady, poptávky, pozice i zprávy prázdné. SQLite soubor se vytvoří při prvním nastavení nebo spuštění služby. U stávající instalace se při otevření databáze doplní schéma klientských účtů a zachovají se stávající záznamy.

| Nastavení | Účel |
| --- | --- |
| `WORKSPACE_DATA` | Absolutní cesta k databázi. Výchozí umístění je `data/workspace.sqlite` ve složce aplikace. Použijte stejnou cestu pro nastavení a následný start. |
| `WORKSPACE_PORT` | Místní port. Výchozí port čisté verze je 4190, port dema je 4191. |
| `WORKSPACE_ORIGIN` | HTTPS adresa v případě nasazení za reverzní proxy, bez cesty nebo parametrů. Pro místní start se odvodí z portu. |

Služba poslouchá pouze na `127.0.0.1`. Pro nasazení potřebuje vlastní HTTPS doménu, reverzní proxy, trvalý disk a spravovaný proces. Proxy musí předávat hlavičku `Origin` a měla by samostatně omezovat počet požadavků na přihlašovací trasy. Aplikace omezuje pokusy podle bezprostředního síťového protějšku, který je při tomto nasazení proxy. Endpoint `/health` slouží ke kontrole běžícího HTTP procesu.

Při zálohování po korektním zastavení služby zkopírujte databázi a případné související soubory WAL. Za běhu použijte nástroj, který zálohuje konzistentní SQLite snímek. Ověřte obnovu na odděleném serveru. Přístup k datovému adresáři, zálohám a propojeným nástrojům svěřte jen oprávněným uživatelům. Importované soubory pracují v oddělených nástrojích v prohlížeči.

### Zapnutí serverového zdroje

Google Ads se zapíná nastavením prostředí serveru. Použijte `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` a `GOOGLE_ADS_REFRESH_TOKEN`. Pro správcovský účet lze doplnit `GOOGLE_ADS_LOGIN_CUSTOMER_ID` bez pomlček. `GOOGLE_ADS_API_VERSION` standardně používá `v26`. Pilot podporuje účty v CZK a časové pásmo Europe/Prague. Služba používá přístupy k načtení metadat účtu a čísel kampaní. [Příklad dotazu Google Ads API](https://developers.google.com/google-ads/api/docs/reporting/example)

V **Klienti a kampaně** vyberte Google Ads kampaň a přes **Napojit kampaň** přiřaďte ID účtu a ID reklamy. Synchronizaci lze vyvolat z rozhraní, případně stejný import opakovat z plánovače serveru.

```powershell
npm run sync:google-ads -- identifikator-organizace
```

Bez zadaného období příkaz načítá posledních sedm uzavřených dnů. Volitelně přidejte dvě data ve formátu `RRRR-MM-DD` pro zpětné doplnění až 31 dnů. Příkaz vyžaduje stejnou cestu k databázi jako služba. Vrací chybu při nedostupnosti zdroje nebo nevykázaném dni. Připojení ke skutečnému účtu vyžaduje nasazení a ověření jeho oprávnění.

## Ověření

Příkaz `npm test` spouští testy serverových oprávnění a obnovy stavu. `npm run demo` spustí místní serverovou ukázku s fiktivními daty na portu 4191. Sdílený průchod v prohlížeči je v `test/browser.cjs`. Vyžaduje Playwright a prohlížeč. `TEST_URL` umožňuje ověřit i veřejné sestavení, `TEST_ENGINE` vybírá `chromium`, `firefox` nebo `webkit`.

Příkazy `npm ci` a `npm run build` vytvoří v `dist/` statický build. Prohlížeč používá stejný model a pravidla jako server v samostatném workeru se SQLite a ukládá stav do IndexedDB. Build neobsahuje žádný serverový datový soubor.

## Licence

Apache-2.0. Písmo Inter, sql.js a kryptografická knihovna mají vlastní licence přiložené v sestavení.
