import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const base = '/tree-grow-game/';

async function exists(file) {
    try { await stat(file); return true; } catch { return false; }
}
async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(full));
        else files.push(full);
    }
    return files;
}

if (!await exists(path.join(root, 'index.html'))) {
    throw new Error('Pages build is missing dist/index.html');
}
const html = await readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes(`href="${base}`) || !html.includes(`src="${base}`)) {
    throw new Error('Built HTML does not use the GitHub Pages repository base path');
}
const files = await walk(root);
const relativeFiles = files.map(file => path.relative(root, file).split(path.sep).join('/'));
const assetFiles = relativeFiles.filter(file => file.startsWith('assets/'));
if (!assetFiles.some(file => file.endsWith('.js'))) {
    throw new Error('Pages build is missing the JavaScript application bundle');
}
if (!assetFiles.some(file => file.includes('AIWorker') && file.endsWith('.js'))) {
    throw new Error('Pages build is missing the bundled AI Worker');
}
if (!assetFiles.some(file => file.endsWith('.css'))) {
    throw new Error('Pages build is missing the stylesheet bundle');
}
for (const reference of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])) {
    if (reference.startsWith(base)) {
        const localPath = path.join(root, reference.slice(base.length));
        if (!await exists(localPath)) throw new Error(`Built HTML references a missing asset: ${reference}`);
    }
}
console.log(`Pages output verified: ${assetFiles.length} assets, base path ${base}, AI Worker present.`);
