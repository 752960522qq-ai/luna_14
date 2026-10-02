import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';
import {sourceIndex} from '../scripts/source-index.mjs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('game.mjs'),html=read('app/src/main/assets/index.html');
assert.equal(html.split('<script type="module">')[1].split('</script>')[0],source);
const original=JSON.parse(read('validation/aircraft-v17-reference.json')),h=loadGame();
for(const [table,values] of Object.entries(original)){
 const actual=JSON.parse(h.run('JSON.stringify('+table+')'));
 for(const [id,expected] of Object.entries(values)){
  const observed={...actual[id]},reference={...expected};
  // Catalogue strings are now computed from the same numbers used in combat.
  if(table==='planeInfo'){delete observed.specs;delete reference.specs}
  if(table==='weaponInfo')for(const id of Object.keys(observed))delete observed[id].label;
  assert.deepEqual(observed,reference,table+':'+id);
 }
}
const probe="function example(a = {x: '}'}) { const s = `{ ${a.x} }`; /* } */ return /[{}]/.test(s); }";
const extracted=sourceIndex(probe).function('example');assert.equal(extracted,probe);
assert(html.includes('<title>银翼凌云</title>')&&html.includes('<h1>银翼凌云</h1>'));
assert(!/function (cursorViewQuaternion|rotateAircraftWorld)\b/.test(source));
const parts=JSON.parse(read('src/parts.json'));
for(const part of parts)assert(source.includes('// Source: src/'+part));
for(const field of ['AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_FIGHTER','RESEARCH_COSTS'])assert(!parts.some(p=>read('src/'+p).includes('const '+field+' = {')),field+' still has a duplicated table');
const report={result:'passed',embeddedModuleMatches:true,aircraftTablesPreserveV17CombatParameters:true,sourceParts:parts.length,parserHandlesBracesInStringsCommentsAndTemplates:true,brand:'银翼凌云'};
fs.writeFileSync(new URL('source-v19.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
