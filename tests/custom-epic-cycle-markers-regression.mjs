import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cycleMarkersForOrder} from '../js/custom-epic-cycle-markers.mjs';

const order=['first','second','third','fourth'];
const friendly={first:{cycle:1},second:{cycle:1},third:{cycle:2},fourth:{cycle:3}};
const epic={first:{cycle:1},second:{cycle:2},third:{cycle:2},fourth:{cycle:4}};
assert.deepEqual(cycleMarkersForOrder(order,friendly,epic),[
  {id:'first',cycle:1,alternateCycle:1,startsCycle:false},
  {id:'second',cycle:1,alternateCycle:2,startsCycle:false},
  {id:'third',cycle:2,alternateCycle:2,startsCycle:true},
  {id:'fourth',cycle:3,alternateCycle:4,startsCycle:true},
]);
assert.deepEqual(cycleMarkersForOrder(['first','missing','third'],friendly,epic),[
  {id:'first',cycle:1,alternateCycle:1,startsCycle:false},
  {id:'missing',cycle:null,alternateCycle:null,startsCycle:false},
  {id:'third',cycle:2,alternateCycle:2,startsCycle:true},
]);
assert.equal(cycleMarkersForOrder(['third','first'],friendly,epic)[1].startsCycle,true);
const stacker=readFileSync(new URL('../js/epic-stacker.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../css/epic-stacker.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../stacking.html',import.meta.url),'utf8');
assert.match(stacker,/row\.classList\.add\('dragging'\);beginDragCycleBoundaries\(target\)/);
assert.match(stacker,/target\.insertBefore\(line,rows\[slot\.index\]\)/);
assert.match(stacker,/positionDragCycleBoundaries\(target\)\};/);
assert.match(styles,/\.order-list\.drag-active \.squad-order-item\.has-cycle-break::before\{display:none\}/);
assert.match(styles,/\.cycle-drag-boundary\{/);
assert.match(styles,/\.order-list\.drag-active \.squad-order-item\.dragging \.squad-order-cycle\{visibility:hidden\}/);
assert.match(stacker,/const cycleMarkers=cycleMarkersForOrder\(rows\.map\(s=>String\(s\.id\)\),r\.cases\?\.friendlyFirst\?\.death,r\.cases\?\.epicFirst\?\.death\)/,'Battle Details must reuse the Custom view cycle calculation.');
assert.match(html,/<thead><tr><th>Unit<\/th><th>Cycle<\/th><th>Qty<\/th>/,'Epic Battle Details must place Cycle between Unit and Qty.');
assert.doesNotMatch(stacker,/class="prediction-cycle-divider"/,'Cycle markers must not add a separate table row.');
assert.doesNotMatch(stacker,/class="prediction-cycle-start"/,'Cycle boundary lines must not carry a label.');
assert.match(stacker,/class="prediction-cycle-badge"[^`]+aria-label=/,'Battle Details must label each squad cycle accessibly.');
assert.match(stacker,/<td><span class="prediction-unit-name">[\s\S]*?<\/td><td>\$\{cycleBadge\}<\/td><td>\$\{formatInteger\(s\.quantity\)\}/,'Cycle badges must occupy their own cell between Unit and Qty.');
assert.match(styles,/\.prediction-table \.prediction-cycle-row\.starts-cycle td\{[\s\S]*?border-top:2px solid var\(--cycle-accent/,'New cycles must use a bold, colored row border.');
assert.match(styles,/\.epic-prediction-panel \.prediction-table td:nth-child\(8\)\{width:13%\}/,'Epic table must allocate width to all eight columns.');
for(let cycle=1;cycle<=6;cycle++)assert.match(styles,new RegExp(`\\.prediction-table \\.prediction-cycle-${cycle}\\{--cycle-accent:`),`Cycle color ${cycle} must be defined.`);
console.log('Custom Epic cycle markers regression checks passed.');
