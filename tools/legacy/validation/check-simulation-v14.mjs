import fs from 'node:fs';import assert from 'node:assert/strict';import {loadGame} from './screen-runtime.mjs';
let seed=54321;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296},h=loadGame({random}),reports=[];
for(const type of ['f3f2','mig15','b29']){
 h.run(`selectedAircraft='${type}';gameMode='airspace';reset()`);const history=[],started=performance.now();
 for(let i=0;i<60*360&&h.run('playing');i++){
  h.run('updateAirspaceStep(1/60)');
  if(i%(60*30)===0)history.push(h.run('({second:airspaceState.elapsed,owner:airspaceState.owner,progress:airspaceState.progress,counts:{...airspaceState.counts},scores:{...airspaceState.scores},blue:airspaceLiveUnits("blue").length,red:airspaceLiveUnits("red").length,ammunitionSpent:airspaceUnits.some(u=>airspaceAmmoFraction(u)<1),closest:Math.min(...airspaceLiveUnits().map(u=>u.root.position.distanceTo(airspaceState.point)*10))})'));
 }
 const last=h.run('({ended,winner:airspaceState.winner,finite:airspaceUnits.every(u=>u.root.position.toArray().every(Number.isFinite)&&u.root.quaternion.toArray().every(Number.isFinite)&&Number.isFinite(u.root.userData.airspeed)),scores:{...airspaceState.scores},elapsed:airspaceState.elapsed,roster:airspaceUnits.length,maxOutside:Math.max(0,...airspaceLiveUnits().filter(u=>!u.isPlayer).map(u=>outsideTerrainMeters(u.root.position)))})');
 assert(last.finite,type);assert.equal(last.roster,16);assert(last.maxOutside<=100+1e-6);assert(history.some(row=>row.closest<300));assert(history.some(row=>row.ammunitionSpent)||h.run('airspaceUnits.some(u=>airspaceAmmoFraction(u)<1)'));
 reports.push({type,wallSeconds:(performance.now()-started)/1000,history,last});console.log(JSON.stringify({type,...last}));
}
// Navigation-only run isolates the heavy aircraft's turn and altitude control.
h.run("selectedAircraft='b29';gameMode='airspace';reset();fireAirspaceBomberTurrets=()=>{};fireWeapons=()=>{}");
for(let i=0;i<180*60&&h.run('playing');i++)h.run('updateAirspaceStep(1/60)');
assert(h.run('airspaceUnits.filter(u=>!u.isPlayer).every(u=>!u.dead&&u.root.position.y>terrainHeightAt(u.root.position.x,u.root.position.z))'));
assert(h.run('airspaceUnits.filter(u=>!u.isPlayer).every(u=>Math.abs(u.root.position.y-airspaceState.point.y)<60)'));
fs.writeFileSync(new URL('simulation-v14.json',import.meta.url),JSON.stringify({result:'passed',method:'Shared physical simulation at 60 Hz, seeded 8v8 matches for up to six simulated minutes; additional B-29 navigation-only test.',reports,heavyAircraftNavigation:'15 AI survive three minutes; altitude variation remains bounded within 600 m of the objective flight level'},null,2));
