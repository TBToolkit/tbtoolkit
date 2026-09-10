export function parseNumber(value){
  const number=Number(String(value??'').replace(/[%,$\s]/g,'').replace(/,/g,''));
  return Number.isFinite(number)?number:0;
}
export function formatInteger(value){return Math.round(parseNumber(value)).toLocaleString('en-US');}
export function formatElapsed(milliseconds){
  const total=Math.max(0,Math.floor(Number(milliseconds||0)/1000));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}
export function formatDamage(value){
  const number=Number(value)||0;
  if(number>=1e12)return`${(number/1e12).toFixed(3)}T`;
  if(number>=1e9)return`${(number/1e9).toFixed(3)}B`;
  if(number>=1e6)return`${(number/1e6).toFixed(3)}M`;
  return Math.round(number).toLocaleString('en-US');
}
export function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
export function tierNumber(level){const match=String(level||'').match(/\d+/);return match?Number(match[0]):0;}
export function hexToRgb(hex){const value=hex.replace('#','');return[parseInt(value.slice(0,2),16),parseInt(value.slice(2,4),16),parseInt(value.slice(4,6),16)];}
export function mixHex(first,second,amount){const a=hexToRgb(first),b=hexToRgb(second),mixed=a.map((value,index)=>Math.round(value+(b[index]-value)*amount));return`#${mixed.map(value=>value.toString(16).padStart(2,'0')).join('')}`;}
