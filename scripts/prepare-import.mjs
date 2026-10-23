import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../src/vendor/',import.meta.url),{recursive:true});
await copyFile(new URL('../node_modules/fflate/esm/browser.js',import.meta.url),new URL('../src/vendor/fflate.js',import.meta.url));
await copyFile(new URL('../node_modules/fflate/LICENSE',import.meta.url),new URL('../src/vendor/fflate.LICENSE.txt',import.meta.url));
console.log('Prepared offline MXL decoder.');
