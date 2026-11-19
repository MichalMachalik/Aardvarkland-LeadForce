# Od kampaně k investorovi

## Co skutečně dělá podobná platforma

Clientelo veřejně ukazuje tok od nákupu návštěvnosti přes kvalifikaci a předání po dlouhodobou péči. Popisuje měření, behaviorální analytiku, databázi kontaktů, e-mailové sekvence, CRM s voláním a retenci. Investorské rozhraní uvádí jako připravované. Z veřejného pohledu lze odvodit, jaké role a předávky dávají pro takový produkt smysl. Vnitřní architekturu, přesnou matici oprávnění a pravidla jednotlivých klientů veřejné materiály nepopisují. [Clientelo](https://www.clientelo.cz/)

Samostatné kontroly kampaní řeší správný vstup a audit řeší zpětné vyhodnocení. Tým mezi nimi potřebuje vlastnictví kontaktu, zápis rozhodnutí, termín dalšího kroku a kontrolu toho, co uvidí externí účet. Pracovní prostor tyto kroky staví na společném serveru. Investor dostává oddělenou navigaci a vlastní pohled. Samostatná vydání tří nástrojů zůstávají k dispozici.

| Oblast Clientelo | Co se dá v této sadě projít | Co by potřebovala skutečná integrace |
| --- | --- | --- |
| Nákup návštěvnosti | Kontrola kampaně před spuštěním a audit dodaných výsledků | Správa rozpočtu a reklam v účtech jednotlivých sítí |
| Analytika a tracking | Kanál a ID kampaně zůstanou u poptávky až do předání a exportu | Zpracování událostí z více webů, souhlas, konzistentní atribuce a řešení duplicit |
| Behaviorální analýza | — | Sběr povolených událostí, heatmapy a anonymizace záznamů návštěv |
| CHECK a databáze | Kontrola přesných duplicit a evidence poptávek v organizaci | Segmentace, slučování identity a obohacení z více zdrojů |
| E-mailová automatizace | Koncept, zveřejnění a přečtení zprávy ve schránce investora | Šablony, plánování sekvencí, doručitelnost, odhlášení a potvrzení doručení |
| CRM a volání | Vlastník poptávky, fronta, kvalifikace, interní poznámky a úkoly | Poskytovatel telefonie, dostupnost operátorů a řízení přístupu k nahrávkám |
| Retence | Portfolio, splatnosti a adresné novinky investora | Segmenty a navazující činnosti podle životního cyklu |
| Investorské rozhraní | Oddělený účet, pozice a soukromé zprávy | Sdílené přístupy podle investic, dokumenty a klientem schválený onboarding |

Názvy oblastí vycházejí z veřejného popisu. [Clientelo – přehled platformy](https://www.clientelo.cz/)

## Srovnání pracovních postupů

| Oblast | Co je vidět u zavedených produktů | Co řeší pracovní prostor | Hranice současné verze |
| --- | --- | --- | --- |
| Příjem poptávky | CRM rozlišuje zdroj kontaktu, jeho identitu a způsob párování importů. [HubSpot – deduplikace](https://knowledge.hubspot.com/records/deduplication-of-records) | Poptávka dostává interní ID, projekt, zdroj a kampaň. Přesná shoda e-mailu, zdroje a kampaně v téže organizaci se odmítne. | Chybí import jednotlivých kontaktů, slučování duplicit a synchronizace se zdroji. |
| Fronta a vlastník | Salesforce umožňuje předat nezpracované záznamy do fronty a z ní je přidělit konkrétnímu pracovníkovi. Dynamics přidává přiřazení podle segmentu, dovednosti, kapacity a dostupnosti. [Salesforce – fronty](https://help.salesforce.com/s/articleView?id=queues_overview.htm&language=en_US&type=0) · [Dynamics 365 – pravidla přiřazení](https://learn.microsoft.com/en-us/dynamics365/sales/wa-create-and-activate-assignment-rule) | Nová poptávka má frontu a potom vlastníka. Převzetí ověřuje verzi záznamu, takže dva lidé stejnou poptávku nepřevezmou současně. | Pravidla a rozdělování práce podle kapacity zde zatím nejsou. |
| Kvalifikace a předání | Výkonné týmy spojují stav příležitosti se sekvencí reálných činností. [Dynamics 365 – Work Assignment](https://learn.microsoft.com/en-us/dynamics365/sales/work-assignment-intro) | Stav postupuje přes kontaktování a kvalifikaci. Předání vyžaduje určeného pracovníka péče a uloží okamžik předání. Při změně vlastníka s poptávkou přejdou otevřené úkoly. | Reálné hovory, e-maily, kvalifikační skóre a směny týmů závisí na vstupních datech a pravidlech provozu. |
| Role a organizace | HubSpot odděluje povolené činnosti od dosahu na vlastní, týmové nebo všechny záznamy. Salesforce používá vlastnictví a sdílení záznamů. [HubSpot – oprávnění](https://knowledge.hubspot.com/user-management/hubspot-user-permissions-guide) · [Salesforce – sdílení](https://help.salesforce.com/s/articleView?id=platform.managing_the_sharing_model.htm&language=en_US&type=5) | Server ověřuje organizaci, roli a dosah na záznam. Pozvánka vybírá předdefinovanou roli. Deaktivace ukončuje relace a otevřené poptávky vrátí do fronty. | Vlastní role, více rolí na uživatele, samoobslužná obnova a firemní adresář jsou mimo aktuální rozsah. |
| Práce týmu | Attio váže komentáře a adresná upozornění ke konkrétnímu záznamu. DealCloud spojuje investor relations s historií vztahu a aktivit. [Attio – spolupráce](https://attio.com/help/reference/productivity-collaborating/comments-and-mentions) · [Intapp DealCloud – vztahy](https://www.intapp.com/wp-content/uploads/2022/08/DealCloud-Relationship-Management-Suite_August-2022.pdf) | Poptávka má interní poznámky s autorem, schránku upozornění, úkoly s termínem a časovou osu. Oznámení při čtení znovu podléhá přístupu ke konkrétní poptávce. | Poznámky tvoří jednoduchý seznam. Chybí vlákna, přílohy, synchronizace kalendáře a integrace týmových kanálů. |
| Kvalita kampaně | Google Ads popisuje zpětné využití výsledků z CRM jako offline konverzí. Smyslem je navázat výdaj na kvalitní výsledek, i když vznikl po prvním odeslání formuláře. [Google Ads – offline konverze](https://support.google.com/google-ads/answer/2998031) | Marketing vyexportuje poptávky pro Audit podle zdroje a kampaně bez kontaktních údajů. Dosažené předání v CSV zůstane i po uzavření poptávky. | Chybí příjem reklamních výdajů a zpětné odesílání událostí přímo přes rozhraní poskytovatele. |
| Pozvánka investora | Portály pro fondy oddělují účet uživatele, jeho oprávnění a investici, ke které má přístup. Carta dokumentuje udělení přístupu pro konkrétní investici. [Carta – přístup k investici](https://releasenotes.carta.com/grant-fund-investment-access-on-your-investors-behalf-2pPJiU) | Péče propojí předanou poptávku s existujícím účtem stejného e-mailu nebo vytvoří vázanou pozvánku. Samotný investor vidí přiřazené pozice a zprávy. | Pokročilé modely zástupců a skupin, ověření totožnosti, elektronický podpis a správa dokumentů by potřebovaly vlastní model oprávnění. |
| Publikace a retence | Juniper Square spojuje přehled investora, sdílení dokumentů a komunikaci v průběhu celého vztahu. [Juniper Square – edice](https://assets.junipersquare.com/files/Juniper-Square-Editions.pdf?v=1655927171) | Péče vybere konkrétního příjemce, uloží koncept a potvrzením zpřístupní zprávu pouze jeho účtu. Vidí, zda ji otevřel. Pozice mají částku, splatnost a stav. | Chybí plánované sekvence, automatická péče, bezpečné úložiště dokumentů a import finančních výkazů. |
| Evidence a provoz | U SSO, auditování a retenčních pravidel jde o řešení životního cyklu identit a důkazů, včetně toho, kdo a kdy může přístup odebrat. [Microsoft – role pro Dynamics 365 Sales](https://learn.microsoft.com/en-us/dynamics365/sales/security-roles-for-sales) · [OWASP – relace](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | Správce má přehled zaznamenaných změn. Aplikace používá serverové relace s omezenou platností, zneplatnění relace a oddělené úložiště organizací. | Produkční audit vyžaduje omezení změn logů, dobu uchování, bezpečný export a provozní test obnovy. |

## Oprávnění v této verzi

| Role | Rozsah a akce |
| --- | --- |
| Správce | Spravuje členy a pozvánky, přiřazuje otevřené případy, pracuje s pozicemi a zprávami, má historii své organizace. |
| Marketing | Zakládá poptávky a vidí jejich projekt, zdroj, kampaň a stav. Stahuje CSV a používá Audit a Kontrolu. Kontaktní údaje a pracovní poznámky nejsou v jeho výsledném seznamu. |
| Kvalifikace | Přebírá poptávky z fronty a spravuje své případy do předání péči. U vlastněného případu mění stav, zapisuje interní poznámky a zakládá úkoly. |
| Péče | Převezme kvalifikovanou poptávku, provede předání, propojí účet a připraví jeho pozice a zprávy. V této verzi má přehled všech investorů vlastní organizace. |
| Investor | Vidí vlastní portfolio, zveřejněné zprávy a nastavení účtu. Nemá přístup k týmovým nástrojům, poznámkám, konceptům ani údajům jiných investorů. |

Interní poznámka patří k poptávce a je dostupná oprávněným pracovníkům. Zpráva investora má zadaného příjemce a schází mu ve schránce do výslovného zveřejnění. Historie zaznamená změnu stavu, převzetí, úkol i zveřejnění. Každý požadavek na čtení či zápis ověřuje dosah znovu na serveru. Databáze vynucuje vazby mezi záznamy stejné organizace.

## Co rozhoduje o připravenosti pro větší firmu

1. **Identita a samostatnost týmů.** Potvrdit s provozovatelem, kdo může vidět citlivé položky a zda různé týmy péče potřebují přístup po projektech. Doplnit správu rolí a obnovu přístupu, SSO a vícefaktorové ověření podle poskytovatele identity.
2. **Měření celého životního cyklu.** Definovat identitu kontaktu napříč kanály, atribuci a důvody kvalifikace. Tým pak může počítat čas do prvního kontaktu, počet nesplněných SLA a poměr kvalifikovaných či předaných poptávek k rozpočtu. Při automatickém importu řešit opakované události a původ každého údaje.
3. **Komunikace a eskalace.** Vyjasnit, kdy stačí upozornění u poptávky, co se odesílá mimo aplikaci a kdo zvedá opožděné případy. Pro provoz s objemy přidat bezpečné fronty pro notifikace, stavy doručení a opakování po chybě.
4. **Dokumenty, ověřování a finance.** Oddělit evidenční pozici od skutečných finančních operací. Pro dokumentový portál ověřit, kdo může publikovat, kdo potvrdí příjem a kdy se přístup zruší. Integrace ověření nebo podpisů patří k samostatně přijatému procesu s oprávněními.
5. **Odolnost.** Změřit odezvu a zápisy se souběžnou prací reprezentativního počtu lidí, obnovit zálohu v odděleném prostředí a vyzkoušet provozní výpadek. Aktuální aplikace je jeden proces na jednom hostiteli. Před veřejným provozem patří do ověření autentizace za skutečnou proxy, logy, monitoring, retenční pravidla a bezpečnostní revize.

Současná verze dokládá průchod od kampaně přes skutečné přihlášení kolegů a předání až po viditelný výsledek v účtu investora. Rozsah srovnání vychází z veřejné dokumentace a nevyjadřuje, jak má který z dodavatelů své konkrétní nasazení nastavené.
