# Portál investora

[Otevřít veřejné demo](https://michalmachalik.github.io/Aardvarkland-LeadForce/portal-investora/)

Interaktivní ukázka s fiktivním portfoliem, platebním harmonogramem, katalogem příležitostí a schránkou zpráv. K dispozici je ukázkový účet bez přihlašování.

- V portfoliu vyhledejte projekt podle názvu nebo ID a filtrujte aktivní či splacené pozice. Stejné filtry platí pro CSV a harmonogram, který lze stáhnout do kalendáře jako `.ics`.
- V katalogu vyhledejte třeba `Javorova`, otevřete projekt a vyzkoušejte uložení příležitosti i záznam zkušebního zájmu.
- Ve schránce vyhledávejte ve zprávách a filtrujte je podle pozice. Na její zprávy přejdete rovnou z detailu pozice. Otevření zprávy ji označí jako přečtenou. Tlačítko **Vymazat uložený stav** odstraní místní změny.

Změny se ukládají místně v prohlížeči. Ukázkový záznam zájmu i platební harmonogram používají fiktivní data.

## Propojený scénář

Z [Kontroly před spuštěním](https://michalmachalik.github.io/Aardvarkland-LeadForce/kontrola-pred-spustenim/) předejte fiktivní poptávku `QA-SCENAR-01` do [Auditu kampaní](https://michalmachalik.github.io/Aardvarkland-LeadForce/audit-kampani/). Po kvalifikaci připravte následnou péči a otevřete portál ve stejné kartě. Ve schránce se zobrazí provedené kroky. Tlačítko **Zpět do Auditu** vede na stejnou poptávku z libovolné obrazovky Portálu. Samostatně otevřený portál zobrazí vlastní přehled.

## Místní spuštění a ověření

Příkaz `npm run build` v kořeni LeadForce připraví ukázku v `dist/portal-investora/` vedle ostatních nástrojů. Pro samostatné otevření portálu vytvořte stránku příkazem `node build.cjs` v této složce a otevřete `dist/index.html`.

Příkaz `node build.cjs --production` vytvoří `dist-production/index.html` bez výchozích záznamů. Tlačítko **Import dat** načte soubor JSON s poli `positions`, `opportunities` a `messages`. Každé z nich je seznam a může zůstat prázdné.

- Pozice obsahuje `id`, `name`, `category`, `principal` v Kč, `status` (`active` nebo `closed`), `maturity` a `schedule`. `schedule` je seznam položek `date` a `amount` v Kč. Splacená pozice má prázdný `schedule`. Pole `note` je volitelné.
- Příležitost obsahuje `id`, `name`, `category`, `horizon` a `phase`. Pole `note` je volitelné.
- Zpráva obsahuje `id`, `date`, `type` a `title`. Pole `text` a `positionId` jsou volitelná. Vyplněné `positionId` odkazuje na ID pozice v témže souboru.

Data mají formát `RRRR-MM-DD`, částky přijímají dvě desetinná místa. ID je v každém seznamu jedinečné a používá písmena A–Z, číslice, spojovník a podtržítko. Import a stav práce s ním se drží v otevřené stránce.

- `node --test portal.test.cjs` ověří výpočty, filtrování, práci se stavem a výstup CSV.
- `node browser.test.cjs` spustí průchod s nainstalovaným Playwrightem po sestavení. `TEST_ENGINE` vybírá `chromium`, `firefox` nebo `webkit`. `CHROME_PATH` umožní použít nainstalovaný Chrome či Edge. `PORTAL_TEST_URL` určí adresu zveřejněné nebo místně hostované verze.

## Licence

Vlastní kód je dostupný pod [Apache License 2.0](LICENSE). Písmo Inter je distribuováno pod [SIL Open Font License 1.1](assets/OFL-Inter.txt).
