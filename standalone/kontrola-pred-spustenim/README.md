# Kontrola před spuštěním

[Otevřít demo](https://michalmachalik.github.io/Aardvarkland-LeadForce/kontrola-pred-spustenim/)

Nástroj pro kontrolu cílových adres a parametrů UTM před spuštěním kampaně. Připravené odkazy lze použít ke zkoušce lokálního formuláře a ověření údajů v modelovém CRM.

- Vložte až 500 odkazů. Schválené domény zadejte bez protokolu a oddělte čárkou. Subdoména potřebuje vlastní záznam. Kontrola najde chybějící a opakované parametry, duplicitní odkazy, neschválené domény a hodnoty mimo povolená pravidla.
- Odkazy se stejným zdrojem a ID kampaně mají shodný název a médium. Pokud se liší, výsledek ukáže oba řádky. U chybějícího ID nabídne editor hodnotu z jednoznačně shodné kampaně ve stejné dávce.
- Tvůrce odkazu má předvolby pro Google Ads, Meta, LinkedIn, Sklik a vlastní kanál. Při úpravě zachovává nesouvisející parametry a fragment adresy.
- Zkušební návštěva zaznamená otevření detailu a odeslání formuláře v ukázce. Fiktivní návštěvník může být nový nebo rozpoznaný podle ukázkového ID.
- Pro průchod mezi aplikacemi vyhledejte `prohlidka-b` a zvolte **Upravit odkaz**. Potvrďte nabídnuté ID `G-202`, vytvořte odkaz a nahraďte původní řádek. U stejného odkazu zvolte **Ověřit předání**, **Ověřit přenos** a **Otevřít v Auditu**. V Auditu se otevře fiktivní záznam `QA-SCENAR-01`. Při místním otevření použijte **Stáhnout CRM CSV** spolu s exportem výdajů z Auditu.

Kontrola neotevírá zadané adresy. Zkušební formulář a CRM běží pouze v prohlížeči. Veřejná ukázka používá fiktivní data.

Odkaz na Audit kampaní v postranním panelu otevře samostatný přehled v nové kartě. Tlačítko **Otevřít v Auditu** u předaného záznamu pokračuje scénářem ve stejné kartě.

## Místní spuštění

Příkaz `npm run build` v kořeni LeadForce připraví ukázku v `dist/kontrola-pred-spustenim/` vedle ostatních nástrojů. Pro místní kontrolu odkazů vytvořte stránku příkazem `node build.cjs` v této složce a otevřete `dist/index.html`.

Příkaz `node build.cjs --production` vytvoří `dist-production/index.html` bez fiktivních domén, odkazů a CRM záznamů. Zadejte doménu, pravidla a vlastní odkazy. Pro přenos vlastních záznamů do Auditu použijte CRM CSV.

Kontrolu URL ověří `node --test links.test.cjs`. Po sestavení `dist` lze s nainstalovaným Playwrightem spustit `node browser.test.cjs`. Proměnná `TEST_ENGINE` vybírá `chromium`, `firefox` nebo `webkit`. `CHROME_PATH` umožňuje použít nainstalovaný Chrome či Edge, `LAUNCH_TEST_URL` určuje adresu běžícího dema.

## Licence

Vlastní kód je dostupný pod [Apache License 2.0](LICENSE). Písmo Inter je distribuováno pod [SIL Open Font License 1.1](assets/OFL-Inter.txt).
