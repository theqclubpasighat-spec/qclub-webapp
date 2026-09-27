import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const files = readdirSync('dist/assets').filter(name => /\.(js|css)$/.test(name));
const included = files.some(name => /Design preview|v2-product-grid/.test(readFileSync(`dist/assets/${name}`, 'utf8')));
assert.equal(included, process.argv[2] === 'present', 'Unexpected V2 preview inclusion in build');
console.log(`V2 preview ${included ? 'present' : 'absent'} as expected.`);
