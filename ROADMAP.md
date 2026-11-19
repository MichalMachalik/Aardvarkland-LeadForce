# Plán plnohodnotného vydání

LeadForce má týmový postup od zdroje poptávky po účet klienta a schránku investora. Klientský účet pokrývá předání, náklady podle kampaní, období a export. Pro provoz s reálnými klienty zbývá návaznost na vlastní systémy, kontrola úplnosti dat a ověření provozních parametrů.

## Nejbližší rozšíření klientského účtu

| Oblast | Rozšíření | Co musí projít při převzetí |
| --- | --- | --- |
| Izolace a role | Přístup po projektu, oprávnění k exportu kontaktů a historie přístupů k výkazům. | Stejný den a ID kampaně mohou existovat ve více organizacích. Přímý odkaz, export ani změna role nesmí zpřístupnit cizí záznam. [Microsoft – oddělení dat ve výkazech](https://learn.microsoft.com/power-bi/developer/embedded-row-level-security) |
| Úplnost nákladů | Import denních výdajů podle účtu poskytovatele a časové zóny. Evidovat zdroj, čas poslední synchronizace, chybu a potvrzenou nulu. | Opakovaný import stejného dne opraví původní částku. Chybějící den se odliší od nuly a je vidět, jaké období je ve výkazu úplné. |
| Čas a atribuce | Samostatně měřit poptávky podle dne předání a podle skupiny vzniklé v období kampaně. U každé metriky uvést datum a model. | Pozdě předaná poptávka se správně projeví v provozním i atribučním pohledu. Číslo lze srovnat s exportem reklamního systému. [Google Ads – čas konverze](https://support.google.com/google-ads/answer/6270625) · [HubSpot – atribuční reporty](https://knowledge.hubspot.com/reports/create-attribution-reports) |
| Potvrzení a oprava předání | Klient může potvrdit převzetí, označit nesprávný kontakt a vrátit důvod. Tým má přehled případů bez odpovědi a dohledatelnou historii oprav. | Potvrzení je vidět oběma stranám. Opakované potvrzení nezvýší počet předání. Opravený kontakt zachová historii a odebraný přístup přestane fungovat okamžitě. |
| Měsíční uzávěrka | Rozlišit průběžný a potvrzený report. Uložit finální verzi s časem, zodpovědnou osobou a rozdíly po pozdější opravě. | CSV a rozhraní dávají totožné výsledky ke stejné verzi. Pozdější oprava vytváří novou verzi a původní report zůstává dohledatelný. |

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
