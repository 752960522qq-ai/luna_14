const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules')+'/playwright');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const bridge=`
const qaRoots={};
function qaSourceSignature(source){const rows=[];source.traverse(n=>rows.push([n.name,...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]));return JSON.stringify(rows)}
function qaSummary(root){
 const box=aircraftLocalBounds(root,[root]),gear=root.userData.landingGear;
 return{type:root.userData.type,context:root.userData.modelContext,attached:!!root.userData.modelAttached,error:!!root.userData.modelError,length:root.userData.lengthMeters,modelSize:box.getSize(new THREE.Vector3()).multiplyScalar(10).toArray(),propAxis:root.userData.propeller?.spinAxis.toArray(),propeller:!!root.userData.propeller,gear:gear?{state:gear.state,assemblies:gear.assemblies.map(g=>({name:g.name,parts:g.parts,before:g.wheelBefore,after:g.wheelAfter,angle:g.foldAngleDegrees}))}:null}
}
window.__aircraftQA={
 ready:()=>Promise.all([...audioLoads.values()]),
 profile:()=>({unlocked:[...unlockedPlanes],selected:selectedAircraft}),
 make:async(type,preview=false)=>{
  const source=await loadPlaneModel(type),signature=qaSourceSignature(source),root=aircraft(false,type,{preview});
  await loadPlaneModel(type);await Promise.resolve();
  const after=qaSourceSignature(source);qaRoots[type+(preview?'Preview':'Combat')]=root;
  return{...qaSummary(root),sourceUnchanged:signature===after,sourceSignature:after}
 },
 fight:()=>({playing,type:playerPlane,hp,ammo:{...playerAmmo},engine:engineAudioType,root:qaSummary(player),enemy:qaSummary(enemy),cameraLocal:camera.position.clone().sub(player.position).applyQuaternion(player.quaternion.clone().invert()).multiplyScalar(10).toArray()}),
 fire:()=>{fireWeapons(player,false,1/60,true);return{ammo:{...playerAmmo},bullets:bullets.map(b=>({weapon:b.weapon,speed:b.speed*10,damage:b.damage}))}},
 camera:()=>{resetCameraTracking();updateChaseCamera(0)},
 propeller:()=>{const source=qaRoots.f3f2Combat,pivot=source.userData.propeller.pivot;source.userData.engineRunning=true;source.userData.throttle=1;source.userData.propRpm=0;updatePropeller(source,1);const running={rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible,quaternion:pivot.quaternion.toArray()};updatePropeller(source,3);const highRpm={rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible};source.userData.engineRunning=false;updatePropeller(source,5);return{running,highRpm,stopped:{rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible}}},
 view:(type,preview,side)=>{
  const active=qaRoots[type+(preview?'Preview':'Combat')],viewScene=new THREE.Scene();viewScene.background=new THREE.Color(0x253846);viewScene.add(new THREE.HemisphereLight(0xffffff,0x7d858c,2.2));const sun=new THREE.DirectionalLight(0xfff3de,2.8);sun.position.set(2,3,-4);viewScene.add(sun);viewScene.add(active);
  const c=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.001,30);c.position.fromArray(side==='side'?[1.3,.12,0]:side==='bottom'?[.7,-.65,.9]:[.8,.42,-1]);c.lookAt(0,0,0);renderer.render(viewScene,c)
 }
};`;
async function main(){
 const server=http.createServer((req,res)=>{const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(assets+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}const type={'.js':'text/javascript','.html':'text/html','.wav':'audio/wav','.mp3':'audio/mpeg','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.SKY_DUEL_CHROME||path.resolve(root,'../tools-audio-build/chrome-headless-shell-linux64/chrome-headless-shell'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:760}}),errors=[],httpErrors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.__nextFrame=cb;return 1};localStorage.setItem('sky-duel-profile-v1',JSON.stringify({unlocked:['f86','mig15','meteor','b29','i15bis','bf109b1','p36a'],selected:'p36a'}))});
  await page.route('**/index.html',r=>r.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(assets,'index.html'),'utf8').replace('</script>',bridge+'\n</script>')}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.__aircraftQA,null,{polling:100});await page.evaluate(()=>window.__aircraftQA.ready());
  const profile=await page.evaluate(()=>window.__aircraftQA.profile());assert(profile.unlocked.includes('f3f2'));assert.equal(profile.selected,'p36a');
  const models=[];
  for(const type of ['f3f2','p36a']){
   const preview=await page.evaluate(type=>window.__aircraftQA.make(type,true),type),combat=await page.evaluate(type=>window.__aircraftQA.make(type,false),type);
   assert(preview.attached&&!preview.error);assert(combat.attached&&!combat.error);assert(preview.sourceUnchanged&&combat.sourceUnchanged);assert.equal(preview.sourceSignature,combat.sourceSignature);delete preview.sourceSignature;delete combat.sourceSignature;
   assert.equal(preview.gear,null);assert.equal(combat.gear.state,'stowed');assert.equal(combat.gear.assemblies.length,3);
   for(const assembly of combat.gear.assemblies){assert.equal(assembly.angle,-90);assert(assembly.after[1]>assembly.before[1],JSON.stringify(assembly));assert(assembly.after[2]>assembly.before[2],JSON.stringify(assembly))}
   if(type==='f3f2'){assert.equal(preview.length,7.06);assert(Math.abs(preview.modelSize[2]-7.06)<.001);assert(preview.propeller);assert.deepEqual(preview.propAxis,[0,0,-1])}
   models.push({preview,combat});
  }
  await page.locator('#openResearch').click({force:true});assert(await page.locator('[data-tree-plane="f3f2"]').count()>=1);assert.equal(await page.locator('#ownedCount').innerText(),'08');
  await page.locator('#researchHome').click({force:true});await page.locator('#openHangar').click({force:true});await page.locator('[data-hangar-select="f3f2"]').click({force:true});await page.locator('#hangarHome').click({force:true});
  await page.locator('#start').click({force:true});await page.evaluate(()=>{Math.random=()=>.01});await page.locator('#chooseAIBattle').click({force:true});
  await page.waitForFunction(()=>window.__aircraftQA.fight().root.attached&&window.__aircraftQA.fight().enemy.attached,null,{polling:100});await page.evaluate(()=>window.__aircraftQA.camera());
  const fight=await page.evaluate(()=>window.__aircraftQA.fight());assert(fight.playing);assert.equal(fight.type,'f3f2');assert.equal(fight.hp,360);assert.equal(fight.engine,'prop');assert.equal(fight.ammo.m2,200);assert.equal(fight.ammo.mg762,500);assert(Math.abs(fight.cameraLocal[1]-2.3)<1e-8);assert(Math.abs(fight.cameraLocal[2]-(7.06/2+2.3))<1e-8);
  const fired=await page.evaluate(()=>window.__aircraftQA.fire());assert.equal(fired.ammo.m2,199);assert.equal(fired.ammo.mg762,499);assert.deepEqual(fired.bullets.map(b=>[b.weapon,b.speed,b.damage]),[['m2',860,34],['mg762',810,13]]);
  await page.evaluate(()=>window.showPause());await page.locator('#returnHome').click({force:true});await page.locator('#openEncyclopedia').click({force:true});await page.locator('[data-preview-plane="f3f2"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'F3F-2');assert((await page.locator('#catalogSpecs').innerText()).includes('16.5 s'));await page.locator('[data-preview-plane="p36a"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'P-36A');
  const propeller=await page.evaluate(()=>window.__aircraftQA.propeller());assert(propeller.running.rpm>0);assert(propeller.highRpm.blur);assert.equal(propeller.highRpm.rpm,1900);assert.equal(propeller.stopped.rpm,0);assert.equal(propeller.stopped.blur,false);
  await page.addStyleTag({content:'.screen,#hud,#campaignHud,#toast{display:none!important}'});
  for(const type of ['f3f2','p36a'])for(const preview of [false,true])for(const side of ['side','bottom']){await page.evaluate(([type,preview,side])=>window.__aircraftQA.view(type,preview,side),[type,preview,side]);await page.locator('#scene canvas').screenshot({path:path.join(__dirname,`${type}-${preview?'catalog':'combat'}-${side}-v13.png`)})}
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  const report={result:'passed',method:'Actual generated v13 page with native GLTF/Draco decoding, Web Audio, SwiftShader WebGL and UI interactions; controlled animation frames. No Android device.',browser:browser.version(),checks:['Existing v12 profile receives F3F-2 and retains its selected aircraft','Research/hangar/catalog expose eight aircraft','Both aircraft have rearward/upward combat gear and untouched catalog source transforms','F3F-2 model length and forward propeller axis match game axes','F3F-2 sortie has 360 HP, 200/500 ammunition, propeller engine and 2.3 m chase height/offset','Two actual projectiles have the supplied speed and damage','F3F-2 propeller starts and stops with RPM'],profile,models,fight,fired,propeller,pageErrors:errors,httpErrors};
  fs.writeFileSync(path.join(__dirname,'browser-aircraft-v13.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
