import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {SAVED_STATE_SCHEMA_VERSION} from '../js/saved-state-schema.mjs';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'dist');
const sourceDirectories=['assets','css','data','downloads','js'];
const deploymentFiles=['_headers','robots.txt'];
const htmlFiles=(await readdir(root)).filter(name=>name.endsWith('.html'));
const runtimeFiles=[];
// Keep editable source artwork and compatibility code in Git, not in the public site.
const sourceOnlyFiles=new Set([
  'assets/images/biff-1980s.jpg',
  'assets/images/hero-art-source.png',
  'assets/images/hero-characters.png',
  'assets/images/home-concept.png',
  'assets/images/homepage-approved.png',
  'js/epic-optimizer-worker.js',
]);
const sitePages=new Map([
  ['index.html','/'],
  ['stacking.html','/stacking'],
  ['chests.html','/chests'],
  ['calendar.html','/calendar'],
  ['research.html','/research'],
  ['resources.html','/resources'],
  ['about.html','/about'],
  ['privacy.html','/privacy'],
  ['terms.html','/terms'],
]);
const publicOrigin='https://tbtoolkit.com';

async function collect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())await collect(absolute);
    else if(!sourceOnlyFiles.has(path.relative(root,absolute).replaceAll('\\','/')))runtimeFiles.push(absolute);
  }
}

for(const directory of sourceDirectories)await collect(path.join(root,directory));
for(const file of htmlFiles)runtimeFiles.push(path.join(root,file));
runtimeFiles.sort();

const hash=createHash('sha256');
for(const file of runtimeFiles){
  hash.update(path.relative(root,file).replaceAll('\\','/'));
  hash.update('\0');
  hash.update(await readFile(file));
  hash.update('\0');
}
const assetVersion=hash.digest('hex').slice(0,16);
const packageMetadata=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const releaseVersion=process.env.RELEASE_VERSION||`v${packageMetadata.version}`;
const commit=process.env.GITHUB_SHA||process.env.COMMIT_SHA||'local';

await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const directory of sourceDirectories)await cp(path.join(root,directory),path.join(output,directory),{
  recursive:true,
  filter:source=>!sourceOnlyFiles.has(path.relative(root,source).replaceAll('\\','/')),
});
for(const file of deploymentFiles)await cp(path.join(root,file),path.join(output,file));

const localAsset=/\b((?:src|href)=["'])(?!https?:|#|mailto:)([^"']+?\.(?:css|js))(?:\?[^"']*)?(["'])/gi;
for(const name of htmlFiles){
  const source=await readFile(path.join(root,name),'utf8');
  let built=source.replace(localAsset,(_match,prefix,url,suffix)=>`${prefix}${url}?v=${assetVersion}${suffix}`);
  const route=sitePages.get(name);
  if(route)built=built.replace(/<\/head>/i,`<link rel="canonical" href="${publicOrigin}${route}">\n</head>`);
  await writeFile(path.join(output,name),built);
}

const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...sitePages.values()].map(route=>`  <url><loc>${publicOrigin}${route}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(output,'sitemap.xml'),sitemap);

// Every module in a deployment receives the same content-derived identity.
// This versions the complete import/worker graph, not only the HTML entry point.
for(const file of runtimeFiles.filter(file=>/\.(?:mjs|js)$/.test(file)&&file.includes(`${path.sep}js${path.sep}`))){
  const relative=path.relative(root,file);
  const source=await readFile(file,'utf8');
  const built=source.replace(/((?:from\s*|import\s*\(|new URL\s*\()\s*["'])(\.{1,2}\/[^"']+?\.(?:mjs|js))(?:\?[^"']*)?(["'])/g,
    (_match,prefix,url,suffix)=>`${prefix}${url}?v=${assetVersion}${suffix}`);
  await writeFile(path.join(output,relative),built);
}

const manifest={
  releaseVersion,
  commit,
  assetVersion,
  builtAt:new Date().toISOString(),
  storageSchemaVersion:SAVED_STATE_SCHEMA_VERSION,
};
await writeFile(path.join(output,'deployment-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
await writeFile(path.join(output,'.nojekyll'),'');
console.log(JSON.stringify({ok:true,output,manifest}));
