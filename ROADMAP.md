# Plán plnohodnotného vydání

LeadForce má týmový postup od zdroje poptávky po účet klienta a schránku investora. Klientský účet pokrývá předání, náklady podle kampaní, období a export. Pro provoz s reálnými klienty zbývá návaznost na vlastní systémy, kontrola úplnosti dat a ověření provozních parametrů.

## Nejbližší rozšíření klientského účtu

| Oblast | Rozšíření | Co musí projít při převzetí |
| --- | --- | --- |
| Izolace a role | Přístup po projektu, oprávnění k exportu kontaktů a historie přístupů k výkazům. | Stejný den a ID kampaně mohou existovat ve více organizacích. Přímý odkaz, export ani změna role nesmí zpřístupnit cizí záznam. [Microsoft – oddělení dat ve výkazech](https://learn.microsoft.com/power-bi/developer/embedded-row-level-security) |
| Úplnost nákladů | Pilot Google Ads má opakovatelný import, evidenci nevykázaných dnů a opravy. Další krok je ověřit reálný účet, doplnit provozní dohled nad opakováním a přidávat další poskytovatele po jednom. | Stejný den se nepřičte dvakrát, nesrovnalost je dohledatelná a výpadek zdroje vyvolá upozornění. U potvrzené nuly je doložitelné, jak vznikla. |
| Čas a atribuce | Samostatně měřit poptávky podle dne předání a podle skupiny vzniklé v období kampaně. U každé metriky uvést datum a model. | Pozdě předaná poptávka se správně projeví v provozním i atribučním pohledu. Číslo lze srovnat s exportem reklamního systému. [Google Ads – čas konverze](https://support.google.com/google-ads/answer/6270625) · [HubSpot – atribuční reporty](https://knowledge.hubspot.com/reports/create-attribution-reports) |
| Potvrzení a reklamace předání | Klient může potvrdit převzetí, podat reklamaci a doplnit podklady ve vlákně. Tým případ převezme, vyžádá podklady a zveřejní rozhodnutí. Prošlé případy vidí ve frontě eskalací. | Opakované odeslání nevytvoří druhý záznam. Čekající případy, vlákno a výsledek vidí oprávněné účty. Report zachová původní počet předání. |
| Měsíční uzávěrka | Správce zveřejní ověřený měsíční náhled. Archiv obsahuje export každé verze a důvod pozdější revize. | CSV a rozhraní dávají totožné výsledky ke stejné verzi. Pozdější oprava vytváří novou verzi a původní report zůstává dohledatelný. |

## Reklamace v každodenním provozu

| Vzor | Jak se promítá do LeadForce | Další ověření |
| --- | --- | --- |
| Zendesk rozlišuje práci řešitele, čekání na podklady a uzavření. Odpověď klientovi má vlastní měření. [Životní cyklus případu](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses) · [Cíle SLA](https://support.zendesk.com/hc/en-us/articles/5600997516058-About-SLA-policies-and-how-they-work) | Při vyžádání podkladů běží lhůta klientovi. Doplnění vrací případ do fronty týmu s novým termínem. Interní poznámky zůstávají v CRM. | Klient doplní údaje, případ se vrátí řešiteli a odpověď uvidí pouze oprávněné účty daného klienta. |
| Salesforce umožňuje přiřadit případ člověku nebo frontě a při splnění pravidla ho eskalovat. [Přiřazování případů](https://help.salesforce.com/s/articleView?id=cases_assign.htm&language=en_US&type=5) · [Pravidla eskalace](https://help.salesforce.com/s/articleView?id=sf.rules_escalation_create.htm&language=en_US&type=5) | Přiřazení a ruční předání mají interní historii a vlastní frontu řešitele. Deaktivace účtu vrátí otevřené případy do fronty. | Změní se odpovědný pracovník a adresát eskalace. Termín i původní čas zůstávají a opakování stejného požadavku nevytvoří druhý zápis. |
| Dynamics 365 počítá upozornění a překročení lhůty podle pracovní doby a podmínek pozastavení. [Pracovní doba a SLA](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/define-service-level-agreements) | Eskalace respektují pracovní dobu, české svátky a mimořádné dny volna nastavené správcem. Interní převzetí původní termín zachová. | Ověřit přechod přes konec pracovní doby při přesunu případu mezi řešiteli. Při více směnách ověřit potřebu kalendářů podle týmu. |
| HubSpot rozlišuje pohled na případy konkrétního kontaktu a na případy jeho organizace. [Oprávnění klientského portálu](https://knowledge.hubspot.com/inbox/manage-support-portal-settings) | LeadForce ověřuje klienta i projektovou kampaň při čtení předání. Doplnit možnost omezit uživateli přístup jen na vybrané projekty a oddělit přístup k exportům. | Stejný klient se dvěma projekty a třemi kontakty projde přímé odkazy, hledání, odpovědi i export po změně oprávnění. |

Pro první provozní pilot dává smysl vybrat jednoho klienta a projekt. Na domluveném vzorku porovnat podíl potvrzených předání, reklamace podle důvodů, dobu do převzetí a dobu do rozhodnutí. Podíl reklamací se počítá z unikátních předání s alespoň jedním případem. Počet podání se vykazuje zvlášť, aby opakované podání nezvýšilo chybovost kampaně.

Před propojením s fakturací domluvit, které důvody vedou k opravě, náhradní poptávce nebo kreditu. Schválenou změnu promítnout do měsíčního výkazu čitelnou opravnou položkou. Původní předání a vyjádření zůstávají dohledatelná. Před rozšířením na další klienty ověřit doručování upozornění, opakování po výpadku, odebrání přístupů a obnovu z kopie dat.

## 1. Organizace, přístupy a klientské účty

- Rozšířit existující přístup po klientovi o projekt, tým a samostatná oprávnění pro dohled a podporu provozu.
- Zavést SSO přes OIDC, vícefaktorové ověření, bezpečnou obnovu přístupu, správu aktivních relací a změny rolí s dohledatelnou historií. Určit, kdo vydává a ruší pozvánky.
- Investorům dát přístup k jednotlivé pozici nebo projektu i při více kontaktech za jednoho investora. Ověřit přístup při odebrání člena, změně role a přesunu případu.

Převzetí etapy vyžaduje doloženou matici oprávnění. Každá role projde scénáři přímých odkazů, náhledů, exportů a zamítnutí dotazů mezi organizacemi. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

## 2. CRM, kvalifikace a měření práce

- Rozšířit evidenci o kontakty, společnosti, více poptávek ke stejnému kontaktu, vlastní kvalifikační formuláře, důvody uzavření a slučování duplicit s náhledem důsledků.
- Přidat fronty podle projektu, zdroje a jazyků, směny, limity kapacity a eskalaci přes termín prvního kontaktu. Pro předání uchovat kvalifikační kontext a potvrzení příjemcem.
- Unifikovat historii poznámek, hovorů, e-mailů a úkolů, přidat vlákna, adresná upozornění a samostatný pohled vedoucího na nevyřešené případy.

Převzetí etapy vyžaduje ověřit, kdo má případ na starosti při nepřítomnosti, souběžném převzetí, přesunu projektu a obnově po výpadku. Retrospektivní report musí vysvětlit, proč a kdy došlo ke kvalifikaci nebo předání. [Dynamics 365 – přiřazování práce](https://learn.microsoft.com/en-us/dynamics365/sales/work-assignment-intro) · [Attio – komentáře a upozornění](https://attio.com/help/reference/productivity-collaborating/comments-and-mentions)

## 3. Marketing, telefonie a e-mail

- Připojit formuláře a reklamní systémy přes ověřené webhooky nebo autorizované importy. Rozdělit surové události od kanonických kontaktů, sjednotit měny i časové zóny a zaznamenat zdroj změny.
- Měřit výsledky podle doby vzniku kontaktu, nákladů, kvalifikace a předání. Nabídnout kontrolu rozdílů před exportem kvalifikovaných konverzí.
- Přidat telefonii, stav hovoru, jeho výsledek a oprávnění k nahrávce. U e-mailu řešit šablony, schválení, odhlášení, stav doručení a omezení opakovaných pokusů.

Převzetí etapy vyžaduje ověřit opakovaný webhook, zpožděnou událost, změněné mapování a vypršení oprávnění. Součet reportu musí jít dohledat k importovaným událostem a opakování nesmí vytvářet duplikáty. [Google Ads – offline konverze](https://support.google.com/google-ads/answer/2998031)

## 4. Investorské dokumenty a péče

- Přidat dokumenty s verzemi, pravidly publikace po investorovi či pozici a evidencí stažení. U důležitých dokumentů oddělit schválení a zveřejnění.
- Vést pozici, související termíny, potvrzení, výkazy a stav komunikace. Příjemci si nastaví upozornění a kontaktní údaje.
- S provozovatelem definovat hranici pro elektronický podpis a ověření totožnosti. Evidenci portfolia oddělit od platebních a účetních operací.

Převzetí etapy vyžaduje scénář pozvánky, předání, publikace, opravy dokumentu a odebrání přístupu. Testuje se i situace, kdy stejný investor vystupuje za více subjektů. [Carta – přístup k investici](https://releasenotes.carta.com/grant-fund-investment-access-on-your-investors-behalf-2pPJiU) · [Juniper Square – investorské edice](https://assets.junipersquare.com/files/Juniper-Square-Editions.pdf?v=1655927171)

## 5. Provoz, testování a uvolnění

- Připravit staging a produkci s řízenými migracemi. Při růstu na více instancí posoudit PostgreSQL, řízené připojení a frontu pro práci na pozadí.
- Stanovit měřitelné cíle odezvy, objemu, obnovy dat a dostupnosti podle očekávaného zatížení. Zavést kontrolu běhu, chyb integrací a opožděných případů.
- Zkoušet obnovení záloh, rotaci klíčů, výpadek integrace i obnovu po přerušené migraci. Automatizovat regresní testy, ověřit klávesnici a mobilní zobrazení a zajistit dohledatelné předání zákazníkovi.

Finální vydání vyžaduje potvrzení reálných scénářů s uživateli, dohodnuté provozní parametry, bezpečnostní revizi a úspěšný test obnovy. Pro pilot dávají přednost přístupy a předávání poptávek, protože na nich stojí návazné integrace i portál.
