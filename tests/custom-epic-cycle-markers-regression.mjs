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
assert.match(stacker,/row\.classList\.add\('dragging'\);target\.classList\.add\('drag-active'\)/);
assert.match(styles,/\.order-list\.drag-active \.squad-order-item\.has-cycle-break::before\{display:none\}/);
assert.match(styles,/\.order-list\.drag-active \.squad-order-cycle\{visibility:hidden\}/);
console.log('Custom Epic cycle markers regression checks passed.');
