import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LATEST_RELEASE,shouldAnnounceRelease} from '../js/release-notes.mjs';

const metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.ok(metadata.version===LATEST_RELEASE.version||shouldAnnounceRelease({...LATEST_RELEASE,version:metadata.version},LATEST_RELEASE.version),'Announcement cannot be newer than the package; quiet patches may retain the previous announcement');
assert.equal(new URL(LATEST_RELEASE.notesUrl).pathname,'/TBToolkit/tbtoolkit/releases/tag/v'+LATEST_RELEASE.version);
assert.equal(shouldAnnounceRelease(LATEST_RELEASE,null),true);
assert.equal(shouldAnnounceRelease(LATEST_RELEASE,'1.28.1'),true);
assert.equal(shouldAnnounceRelease(LATEST_RELEASE,'1.29.0'),false,'Do not interrupt on subsequent page visits');
assert.equal(shouldAnnounceRelease(LATEST_RELEASE,'v1.29.0'),false);
assert.equal(shouldAnnounceRelease(LATEST_RELEASE,'1.30.0'),false,'An older deployment must not reannounce after a newer release');
assert.equal(shouldAnnounceRelease({...LATEST_RELEASE,announce:false},null),false);
assert.ok(LATEST_RELEASE.highlights.length<=6,'Keep release highlights short');
console.log('What’s New: release/version consistency, first visit, once per release, rollback, and quiet-release policy passed.');
