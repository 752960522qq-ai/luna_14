import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from './app/src/main/assets/three.module.js';

const source = fs.readFileSync(new URL('./game.mjs', import.meta.url), 'utf8');
const functionBody = (name) => {
 const start=source.indexOf('function '+name+'(');
 if(start<0)throw Error('Missing function '+name);
 let position=source.indexOf('{',start),depth=1;
 while(depth){position++;if(source[position]==='{')depth++;else if(source[position]==='}')depth--}
 return source.slice(start,position+1);
};
const declaration = (name) => {
 const start=source.indexOf('const '+name+'=');
 if(start<0)throw Error('Missing declaration '+name);
 let position=source.indexOf('=',start)+1,depth=0,quote='',escaped=false;
 for(;position<source.length;position++){
  const char=source[position];
  if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue}
  if(char==='"'||char==="'"||char==='`'){quote=char;continue}
  if(char==='{'||char==='['||char==='(')depth++;
  if(char==='}'||char===']'||char===')')depth--;
  if(char===';'&&depth===0)return source.slice(start,position+1)
 }
 throw Error('Unclosed declaration '+name);
};
const functions=['rotateAircraftLocal','rotateAircraftWorld','softLimitRate','shapeStickVector','flightControlAuthority','shapeControl','readFlightControls','updatePlayerFlightControls','turnRateForPlane','verticalTurnRateForPlane','steerAircraftToward','advanceAircraft'];
const code=[declaration('FLIGHT_CONTROL'),declaration('AI_CONTROL'),declaration('AIRCRAFT_SPECS'),declaration('PROPELLER_SPECS'),declaration('planeInfo'),declaration('METERS_PER_UNIT'),...functions.map(functionBody)].join('\n');
const context=vm.createContext({THREE,Math,console,controlSettings:{mode:'joystick'},keys:{up:false,down:false,left:false,right:false},joystickInput:{x:0,y:0},filteredControlX:0,filteredControlY:0,player:null,playerPlane:'f86'});
vm.runInContext(code,context);
const get=(code)=>vm.runInContext(code,context);
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const makePlane=(type)=>{
 const speed=get(`planeInfo.${type}.maxSpeedKmh`)/3.6*.65,object=new THREE.Group();
 object.position.y=100;
 object.userData={type,throttle:.78,velocity:new THREE.Vector3(0,0,-speed/10),airspeed:speed,maxSpeedMps:get(`planeInfo.${type}.maxSpeedKmh`)/3.6,minFlightSpeedMps:get(`planeInfo.${type}.minLevelFlightKmh`)/3.6,bestClimbMps:get(`planeInfo.${type}.bestClimbMps`)};
 return object;
};
const simulate=(type,control,seconds=1)=>{
 context.playerPlane=type;context.player=makePlane(type);context.keys.right=control==='keyboard';context.keys.left=false;context.joystickInput.x=control==='joystick'?1:0;context.filteredControlX=0;context.filteredControlY=0;
 let rolled=0,maxTurn=0,maxActualTurn=0,maxJump=0,previousSpeed=context.player.userData.airspeed;
 for(let t=0;t<seconds-1e-8;t+=.02){
  const previousHorizontal=context.player.userData.velocity.clone().setY(0);
  get('updatePlayerFlightControls(.02)');
  rolled+=context.player.userData.bankRate*.02;
  const speed=context.player.userData.airspeed,limit=get(`turnRateForPlane('${type}',${speed})`);
  maxTurn=Math.max(maxTurn,Math.abs(context.player.userData.turnRate)/(limit||1));
  const nextHorizontal=context.player.userData.velocity.clone().setY(0);
  const actualTurn=Math.abs(Math.atan2(previousHorizontal.z*nextHorizontal.x-previousHorizontal.x*nextHorizontal.z,previousHorizontal.dot(nextHorizontal)))/.02;
  maxActualTurn=Math.max(maxActualTurn,actualTurn/(limit||1));
  maxJump=Math.max(maxJump,Math.abs(speed-previousSpeed));previousSpeed=speed;
 }
 return{object:context.player,rolled,maxTurn,maxActualTurn,maxJump};
};
const round=(value)=>Math.round(value*100)/100;
for(const type of ['i15bis','bf109b1','p36a','mig15','f86','meteor','b29']){
 const key=simulate(type,'keyboard'),stick=simulate(type,'joystick'),data=key.object.userData;
 const rightWingDown=new THREE.Vector3(1,0,0).applyQuaternion(key.object.quaternion).y;
 const noseRight=new THREE.Vector3(0,0,-1).applyQuaternion(key.object.quaternion).x;
 const keyboardSummary=[round(data.velocity.x),round(noseRight),round(rightWingDown),round(key.rolled*180/Math.PI)];
 const stickSummary=[round(stick.object.userData.velocity.x),round(new THREE.Vector3(0,0,-1).applyQuaternion(stick.object.quaternion).x),round(new THREE.Vector3(1,0,0).applyQuaternion(stick.object.quaternion).y),round(stick.rolled*180/Math.PI)];
 assert(data.velocity.x>0&&noseRight>0,`${type}: right input did not turn right`);
 assert(key.maxTurn<=1.002&&stick.maxTurn<=1.002,`${type}: turn rate cap exceeded`);
 assert(key.maxActualTurn<=1.02&&stick.maxActualTurn<=1.02,`${type}: actual velocity turn exceeded cap`);
 assert(key.maxJump<5&&stick.maxJump<5,`${type}: speed jumped unexpectedly`);
 assert(keyboardSummary.every((v,i)=>Math.abs(v-stickSummary[i])<.01),`${type}: joystick differs from keyboard`);
 console.log(type,'key/stick',keyboardSummary,'maxTurnFraction',round(key.maxTurn),'actualTurnFraction',round(key.maxActualTurn),'maxSpeedChangePerFrame',round(key.maxJump));
}
const fighter=simulate('i15bis','keyboard',4);
assert(fighter.rolled>2*Math.PI,'I-15bis cannot roll past 360 degrees');
context.keys.right=false;const before=fighter.object.quaternion.clone();
for(let i=0;i<50;i++)get('updatePlayerFlightControls(.02)');
assert(Math.abs(fighter.object.userData.bankRate)<.005,'Roll did not stop when input released');
console.log('I-15bis cumulative roll degrees',round(fighter.rolled*180/Math.PI),'roll rate after release',round(fighter.object.userData.bankRate),'quaternion',before.toArray().map(round));
const bomber=simulate('b29','keyboard',1);
assert(bomber.rolled<fighter.rolled/6,'B-29 roll is too fast');
for(const type of ['i15bis','bf109b1','p36a','mig15','f86','meteor','b29']){
 context.playerPlane=type;context.player=makePlane(type);context.keys.left=true;context.keys.right=false;context.joystickInput.x=0;context.filteredControlX=0;context.filteredControlY=0;
 for(let i=0;i<50;i++)get('updatePlayerFlightControls(.02)');
 assert(context.player.userData.velocity.x<0,`${type}: left input did not turn left`);
 assert(new THREE.Vector3(1,0,0).applyQuaternion(context.player.quaternion).y>0,`${type}: left wing was not down`);
 context.keys.left=false;
}
for(const [degrees,expectedX,expectedY] of [[60,1,0],[120,1,-1],[180,0,-1],[240,-1,-1]]){
 const plane=makePlane('mig15');plane.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,-1),degrees*Math.PI/180);
 context.player=plane;context.playerPlane='mig15';context.keys.right=false;context.joystickInput.x=0;context.filteredControlX=0;
 const beforeY=plane.userData.velocity.y;
 get('advanceAircraft(player,.02)');
 const deltaX=plane.userData.velocity.x,deltaY=plane.userData.velocity.y-beforeY;
 if(expectedX)assert(Math.sign(deltaX)===expectedX,`${degrees}deg bank turns wrong way`);
 if(expectedY)assert(Math.sign(deltaY)===expectedY,`${degrees}deg bank vertical force wrong`);
 console.log('bank',degrees,'deltaX',round(deltaX),'deltaY',round(deltaY),'yawRate',round(plane.userData.turnRate*180/Math.PI));
}
for(const type of ['i15bis','bf109b1','p36a','mig15','f86','meteor','b29']){
 const plane=makePlane(type),target=new THREE.Vector3(1,0,-3).normalize();
 for(let i=0;i<150;i++){
  context.player=plane;
  get('steerAircraftToward(player,new THREE.Vector3(1,0,-3),.02)');
  get('advanceAircraft(player,.02)');
 }
 const nose=new THREE.Vector3(0,0,-1).applyQuaternion(plane.quaternion);
 assert(nose.x>0&&plane.userData.velocity.x>0,`${type}: AI failed to bank and turn right`);
 console.log(type,'AI heading x',round(nose.x),'velocity x',round(plane.userData.velocity.x));
}
for(const [input,expectedPitch] of [['joystickDown',1],['joystickUp',-1],['keyboardDown',-1],['keyboardUp',1]]){
 context.playerPlane='mig15';context.player=makePlane('mig15');context.filteredControlX=0;context.filteredControlY=0;
 context.joystickInput.x=0;context.joystickInput.y=input==='joystickDown'?1:input==='joystickUp'?-1:0;
 context.keys.down=input==='keyboardDown';context.keys.up=input==='keyboardUp';
 for(let i=0;i<15;i++)get('updatePlayerFlightControls(.02)');
 const noseY=new THREE.Vector3(0,0,-1).applyQuaternion(context.player.quaternion).y;
 assert(Math.sign(noseY)===expectedPitch,`${input}: pitch direction incorrect`);
 console.log(input,'nose vertical component',round(noseY));
 context.keys.down=false;context.keys.up=false;
}
