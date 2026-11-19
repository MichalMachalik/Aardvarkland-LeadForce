'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

function fontStyles(assets) {
  const subsets = ['latin-ext', 'latin'];
  const rules = subsets.map((subset) => {
    const range = readFileSync(path.join(assets, `inter-${subset}.range`), 'utf8').trim();
    if (!/^U\+[\dA-F?,\- U+]+$/i.test(range)) throw new Error(`Invalid range for ${subset}`);
    const encoded = readFileSync(path.join(assets, `inter-${subset}.woff2`)).toString('base64');
    return `@font-face { font-family: Inter; font-style: normal; font-weight: 400 750; font-display: swap; src: url(data:font/woff2;base64,${encoded}) format('woff2'); unicode-range: ${range}; }`;
  });
  const license = readFileSync(path.join(assets, 'OFL-Inter.txt'), 'utf8');
  if (license.includes('-->')) throw new Error('Unexpected HTML delimiter in font license');
  return { rules: rules.join('\n'), license: `<!--\n${license.trimEnd()}\n-->` };
}

module.exports = { fontStyles };
