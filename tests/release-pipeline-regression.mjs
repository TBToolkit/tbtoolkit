import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,rm,stat} from 'node:fs/promises';

execFileSync(process.execPath,['scripts/build-site.mjs'],{stdio:'inherit'});
const manifest=JSON.parse(await readFile('dist/deployment-manifest.json','utf8'));
const html=await readFile('dist/stacking.html','utf8');
assert.match(html,/<link rel="canonical" href="https:\/\/tbtoolkit\.com\/stacking">/,'Calculator must declare its preferred public URL.');
assert.match(html,/<body class="[^"]*battle-mode-active[^"]*">/,'Calculator must ship its final layout before JavaScript initializes.');
assert.match(html,/<div class="battle-beta-panel" id="battleBetaPanel">/,'Initial calculator panel must not be hidden until JavaScript runs.');
const entryMatch=html.match(/js\/epic-stacker\.js\?v=([a-f0-9]{16})/);
assert.ok(entryMatch,'Built HTML must use a content-derived asset identity.');
assert.equal(entryMatch[1],manifest.assetVersion);
const packageMetadata=JSON.parse(await readFile('package.json','utf8'));
assert.equal(manifest.releaseVersion,process.env.RELEASE_VERSION||`v${packageMetadata.version}`);
const entry=await readFile('dist/js/epic-stacker.js','utf8');
assert.match(entry,new RegExp(`from './epic-engine\\.mjs\\?v=${manifest.assetVersion}'`),'Module dependencies must share the deployment identity.');
assert.doesNotMatch(html,/epic-stacker\.js\?v=1\.16\.0/,'Source-deployment cache numbers must not leak into the production artifact.');
const headers=await readFile('dist/_headers','utf8');
assert.match(headers,/\/css\/\*[\s\S]*max-age=0/,'Fallback asset cache policy must ship with the deployment.');
assert.match(headers,/\/js\/\*[\s\S]*max-age=0/,'Fallback script cache policy must ship with the deployment.');
assert.equal(manifest.storageSchemaVersion,20);
const sitemap=await readFile('dist/sitemap.xml','utf8');
assert.match(sitemap,/<loc>https:\/\/tbtoolkit\.com\/stacking<\/loc>/);
assert.doesNotMatch(sitemap,/epic-stacker\.html/,'Legacy redirect must not be indexed as a separate page.');
const robots=await readFile('dist/robots.txt','utf8');
assert.match(robots,/Sitemap: https:\/\/tbtoolkit\.com\/sitemap\.xml/);
for(const legacy of ['assets/images/home-concept.png','assets/images/homepage-approved.png','js/epic-optimizer-worker.js']){
  await assert.rejects(stat(`dist/${legacy}`),{code:'ENOENT'},`${legacy} should remain source-only.`);
}
await rm('dist',{recursive:true,force:true});
console.log(JSON.stringify({ok:true,assetVersion:manifest.assetVersion}));
