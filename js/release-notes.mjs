// Update this announcement for meaningful releases. Leave it unchanged for
// minor fixes so visitors are not interrupted by every deployment.
export const LATEST_RELEASE=Object.freeze({
  version:'1.29.0',
  date:'2026-11-07',
  announce:true,
  title:'More ways to plan your army',
  notesUrl:'https://github.com/TBToolkit/tbtoolkit/releases/tag/v1.29.0',
  highlights:[
    ['Custom bonus relationships','Save your in-game bonuses for a developing city or Seasonal Kingdom account. Other families then update automatically from your Monster bonuses.'],
    ['Troop Training Plan','See how many units to have ready for your chosen number of attacks and revival strategy. Find it above Battle Details.'],
    ['Explore by unit family','Choose separate tier ranges for Guardsmen, Specialists, Engineers, and Monsters. Defaults are 1, 1, 1, and 2 tiers below.'],
    ['Clearer battle cycles','Combined charts now show cycle boundaries and color-coded badges matching Battle Details, including in the optimizer popup.'],
    ['Larger player-file imports','Import player files up to 25 MB, with saved Explore finalists included.'],
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
