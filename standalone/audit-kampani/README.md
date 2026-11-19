# Audit kampaní

[Otevřít demo](https://michalmachalik.github.io/Aardvarkland-LeadForce/audit-kampani/)

Nástroj propojí denní výdaje na reklamu se stavy poptávek z CRM. Ukazuje získané a přiřazené poptávky, podíl kvalifikovaných a náklady podle kanálů. Podrobnosti v tabulce vysvětlují, z jakých hodnot cena vznikla.

V sekci **Poptávky** vyhledejte `G-202-13`, otevřete **Upravit stav**, potvrďte zájem a vraťte se do přehledu. Cena jedné kvalifikované poptávky z Google Ads klesne z 800 Kč na 738 Kč. Počty a ceny ve výchozím přehledu vycházejí z fiktivních záznamů.

## Propojená ukázka

V [Kontrole před spuštěním](https://michalmachalik.github.io/Aardvarkland-LeadForce/kontrola-pred-spustenim/) opravte odkaz `G-202`, odešlete fiktivní formulář a otevřete Audit ze stejné karty. Poptávka `QA-SCENAR-01` se přidá k ukázkovým datům. Po kvalifikaci můžete projít modelové předání, následnou péči a obnovu zájmu. Odkaz v průchodu otevře samostatný [Portál investora](https://michalmachalik.github.io/Aardvarkland-LeadForce/portal-investora/) s historií poptávky. Tlačítko **Zpět do Auditu** nahoře v Portálu vás vrátí na stejnou poptávku. Při místním spuštění se historie otevře přímo v průchodu.

Odkazy na související aplikace v postranním panelu otevírají běžné přehledy v nové kartě. Rozpracovaný report zůstane v původní kartě.

## Import a výpočet

- Výdaje potřebují datum, kanál, ID kampaně a částku v Kč. V exportu má být jeden souhrn na den a kampaň v daném kanálu.
- Poptávky potřebují své ID, datum vzniku, kanál, ID kampaně a aktuální stav v CRM. Při importu zvolte stavy, které považujete za kvalifikované.
- Volitelný sloupec `handed_off_date` zaznamenává, kdy byla poptávka předána klientovi. Datum lze zadat i v editoru poptávky. Počet předaných a cena za předanou vycházejí z přiřazených poptávek vzniklých ve zvoleném období. Jejich předání může nastat později.
- Editor poptávky upravuje stav v otevřeném reportu. Sekce **Export aktuálních dat** stáhne výdaje nebo poptávky včetně změn v otevřeném reportu. Stažené soubory lze znovu importovat.
- Nejprve zkontrolujte náhled obou exportů. Ukáže použitelné a chybné řádky, přeskočené shody a období každého souboru. Poté použijte data. Výchozí období zahrnuje oba soubory, takže se zobrazí i poptávky z doby mimo reklamní výdaje.
- Přiřazení zohledňuje kanál a ID kampaně ve zvoleném období. Kontrola dat ukazuje podíl přiřazených poptávek a rozliší chybějící kampaň od výdajů v jiném období. Dotčené poptávky lze otevřít nebo stáhnout do CSV. Při nule poptávek aplikace nepočítá cenu za poptávku.
- Veškeré zpracování běží lokálně v prohlížeči. Veřejná ukázka je určená pro fiktivní exporty. Report stáhnete jako CSV se souhrny podle kampaní.

## Místní spuštění

Příkaz `npm run build` v kořeni LeadForce připraví ukázku v `dist/audit-kampani/` vedle ostatních nástrojů. Pro místní otevření samostatného reportu vytvořte stránku příkazem `node build.cjs` v této složce a otevřete `dist/index.html`.

Příkaz `node build.cjs --production` vytvoří `dist-production/index.html` s prázdným reportem bez výchozích záznamů. Vložte vlastní CSV s výdaji a poptávkami. Import a úpravy zůstávají v otevřeném reportu. Uchovat je můžete exportem aktuálních dat.

Výpočty ověří `node --test audit.test.cjs`. Po sestavení `dist` lze s nainstalovaným Playwrightem spustit `node browser.test.cjs`. Proměnná `TEST_ENGINE` vybírá `chromium`, `firefox` nebo `webkit`. `CHROME_PATH` umožňuje použít nainstalovaný Chrome či Edge, `AUDIT_TEST_URL` určuje adresu běžícího dema.

## Licence

Vlastní kód je dostupný pod [Apache License 2.0](LICENSE). Písmo Inter je distribuováno pod [SIL Open Font License 1.1](assets/OFL-Inter.txt).
