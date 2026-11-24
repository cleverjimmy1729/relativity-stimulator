// Exercise the actual HTML's simulation against analytic results, without a browser.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, './dist/index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
js = js.replace('refreshUI();requestAnimationFrame(frame);', 'globalThis.testAPI={state,step,held,reset,syncVelocity,dopplerAt,setBeta,observerRayToLab,simultaneousPosition};');
const noop = () => {};
const ctx = new Proxy({}, {get: (t,k) => k.startsWith('create') ? () => ({addColorStop:noop}) : noop, set:()=>true});
const nodes = new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{style:{setProperty:noop},classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop,getContext:()=>ctx,getBoundingClientRect:()=>({width:300,height:100}),querySelector:()=>node(id+'span'),matches:()=>false,blur:noop,focus:noop,open:false});return nodes.get(id);}
const sandbox={console,Math,Set,Map,Object,Number,parseInt,setTimeout:()=>0,clearTimeout:noop,performance:{now:()=>0},requestAnimationFrame:noop,getComputedStyle:()=>({getPropertyValue:()=> 'monospace'}),document:{documentElement:{outerHTML:html},getElementById:node,querySelectorAll:()=>[],addEventListener:noop},window:{addEventListener:noop}};
vm.createContext(sandbox);vm.runInContext(js,sandbox);
const {state:s,held,step,reset,syncVelocity,dopplerAt,setBeta,observerRayToLab,simultaneousPosition}=sandbox.testAPI;
function near(a,b,tol=1e-8){assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);}
function advance(t){for(let i=0;i<Math.round(t*200);i++)step(1/200);}
reset(false);s.started=true;held.add('forward');advance(10);
near(s.pz,1800,1e-6);near(s.gamma,Math.sqrt(10));near(s.vz,30/Math.sqrt(10));near(s.vx,0);assert.ok(s.properTime<s.labTime);
held.clear();const speed=s.speed,pz=s.pz;held.add('left');advance(1.3);near(s.speed,speed);near(s.pz,pz);assert.ok(s.yaw < -1.4);
held.clear();advance(2);near(s.speed,speed);
reset(false);held.add('back');advance(2);assert.ok(s.vz<0);near(s.pz,-360,1e-7);
held.clear();held.add('brake');advance(4);near(s.speed,0);near(s.pz,0);advance(2);near(s.speed,0);
reset(false);setBeta(.9);near(s.gamma,1/Math.sqrt(.19));near(dopplerAt(0,0,1),Math.sqrt(19));near(dopplerAt(0,0,-1),1/Math.sqrt(19));near(dopplerAt(1,0,0),s.gamma);
near(sandbox.window.slowLightLab.longitudinalAcceleration(180,.9),3*Math.pow(.19,1.5));
// Numerical derivative of the momentum relation agrees with longitudinal inertia.
const calc=sandbox.window.slowLightLab.momentumToVelocity;
const v0=calc(0,s.pz).vz,v1=calc(0,s.pz+.0018).vz;
near((v1-v0)/.00001,180/(60*s.gamma**3),1e-6);
for(const impulse of [1e3,1e6,1e10]){const v=calc(impulse,impulse).vx;assert.ok(Math.hypot(v,v)<10);}
// Strong braking guarantees a bounded stopping time while F = dp/dt is preserved.
reset(false);setBeta(.98);held.add('brake');advance(.4);near(s.speed,5,1e-7);assert.ok(s.applied>180);advance(.42);near(s.speed,0);advance(1);near(s.speed,0);
reset(false);setBeta(.9999);held.add('brake');advance(.84);near(s.speed,0);
// Reject invalid manual beta atomically, and retain subluminal extreme inputs.
reset(false);setBeta(.75);const previousP=s.pz;
for(const bad of [-.1,1,1.01,Infinity,NaN]){assert.equal(setBeta(bad),false);near(s.pz,previousP);}
assert.equal(setBeta(.9999999999999999),true);assert.ok(s.speed<10);
// Analytic aberration relation and its inverse, including rays from behind.
reset(false);setBeta(.8);
for(const mu of [-1,-.8,0,.4,1]){const observedMu=(mu+.8)/(1+.8*mu);const observed=[Math.sqrt(Math.max(0,1-observedMu**2)),0,observedMu];const ray=observerRayToLab(observed,'optical');near(Math.hypot(...ray),1);near(ray[2],mu);}
const sideRay=observerRayToLab([1,0,0],'optical');near(sideRay[0],.6);near(sideRay[2],-.8);near(dopplerAt(...sideRay),.6);
// Simultaneous length contracts only along velocity; optical and measurement
// views deliberately differ, avoiding a second contraction of the light cone.
const contracted=simultaneousPosition([12,7,20]);near(contracted[0],12);near(contracted[1],7);near(contracted[2],12);
const measurementRay=observerRayToLab([Math.SQRT1_2,0,Math.SQRT1_2],'measurement');near(measurementRay[0]/measurementRay[2],.6);
assert.notEqual(observerRayToLab([1,0,0],'optical')[2],observerRayToLab([1,0,0],'measurement')[2]);
reset(false);s.started=true;s.demo=true;advance(43);assert.equal(s.demo,false);near(s.speed,0);assert.ok(s.labTime>42.9);
console.log('PASS: dynamics, subluminal manual beta, invalid-input atomicity, strong brake stopping time, analytic aberration, directional Doppler, simultaneous contraction, complete auto-demo.');
