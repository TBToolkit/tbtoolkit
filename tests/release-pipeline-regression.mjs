import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';

execFileSync(process.execPath,['scripts/build-site.mjs'],{stdio:'inherit'});
const manifest=JSON.parse(await readFile('dist/deployment-manifest.json','utf8'));
const html=await readFile('dist/stacking.html','utf8');
const entryMatch=html.match(/js\/epic-stacker\.js\?v=([a-f0-9]{16})/);
assert.ok(entryMatch,'Built HTML must use a content-derived asset identity.');
assert.equal(entryMatch[1],manifest.assetVersion);
assert.equal(manifest.releaseVersion,'v1.12.0');
const entry=await readFile('dist/js/epic-stacker.js','utf8');
assert.match(entry,new RegExp(`from './epic-engine\\.mjs\\?v=${manifest.assetVersion}'`),'Module dependencies must share the deployment identity.');
assert.doesNotMatch(html,/epic-stacker\.js\?v=201/,'Manual source cache numbers must not leak into the deployment.');
assert.equal(manifest.storageSchemaVersion,20);
await rm('dist',{recursive:true,force:true});
console.log(JSON.stringify({ok:true,assetVersion:manifest.assetVersion}));
