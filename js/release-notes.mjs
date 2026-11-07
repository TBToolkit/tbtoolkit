// Update this announcement for meaningful releases. Leave it unchanged for
// minor fixes so visitors are not interrupted by every deployment.
export const LATEST_RELEASE=Object.freeze({
  version:'1.30.0',
  date:'2026-11-07',
  announce:true,
  title:'More control over Explore',
  notesUrl:'https://github.com/TBToolkit/tbtoolkit/releases/tag/v1.30.0',
  highlights:[
    ['Choose which families Explore searches','Use Do not explore to keep a family’s selected unit types while still optimizing their quantities. Initial settings are Do not explore for Guardsmen and Specialists, 1 tier below for Engineers, and 2 for Monsters.'],
    ['Remembered Explore settings','Your tier choices are saved for each player account, shared across encounters, and included in player exports.'],
    ['Smaller player and clan files','Exports now use lossless compression while retaining the same data. Older player and clan files still import.'],
    ['Capacity at a glance','Mercenaries, Monsters, and Troops now show actual / maximum Authority, Dominance, and Leadership above and below their results.'],
    ['More reliable clan saving','Clan linking and revival strategy changes can recover when browser storage is full.'],
  ],
});

export const WHATS_NEW_SEEN_KEY='tbtoolkit.whatsNew.seenVersion';
export function shouldAnnounceRelease(release,seen){
  if(!release?.announce)return false;
  const parse=value=>/^v?\d+\.\d+\.\d+$/.test(String(value))?String(value).replace(/^v/,'').split('.').map(Number):null;
  const current=parse(release.version),previous=parse(seen);
  if(!previous||!current)return seen!==release.version;
  for(let i=0;i<3;i++)if(current[i]!==previous[i])return current[i]>previous[i];
  return false;
}
