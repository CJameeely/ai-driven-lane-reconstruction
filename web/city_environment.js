import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural Shanghai lilong context for the fixed CITY OVERVIEW shot.
// The approved reconstruction remains untouched in growth.js; this module only
// supplies a legible, low-poly urban fabric around it.
const mat=(color,roughness=.9,emissive=null)=>new THREE.MeshStandardMaterial({color,roughness,metalness:0,emissive:emissive??color,emissiveIntensity:emissive==null?.28:.18});
const M={
  wall:[mat(0x3e4e59),mat(0x465762),mat(0x50616c),mat(0x394a55)],
  roof:[mat(0x526875),mat(0x5b707c),mat(0x455c69)], trim:mat(0x7f929d),
  glass:mat(0x7f9caf,.35,0x314b5b), door:mat(0x26343d), road:mat(0x172127),
  walk:mat(0x344149), curb:mat(0x7b8991), lane:mat(0x233139), metal:mat(0x617580),
  tree:mat(0x263d3c), trunk:mat(0x293033), car:[mat(0x435766),mat(0x59636a),mat(0x263944)]
};
let cityQuality='medium';
const box=(w,h,d,m,x,y,z)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y+h/2,z);o.castShadow=o.receiveShadow=true;return o};
function compactGroup(group){group.updateMatrixWorld(false);const buckets=new Map(),keep=[];for(const o of [...group.children]){if(!o.isMesh){keep.push(o);continue}o.updateMatrix();const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrix);const k=o.material.uuid;if(!buckets.has(k))buckets.set(k,{material:o.material,geometries:[]});buckets.get(k).geometries.push(g);o.geometry.dispose()}group.clear();for(const o of keep)group.add(o);for(const {material,geometries} of buckets.values()){const g=geometries.length===1?geometries[0]:mergeGeometries(geometries,false);if(g){const o=new THREE.Mesh(g,material);o.castShadow=false;o.receiveShadow=false;o.frustumCulled=true;group.add(o)}geometries.forEach(x=>{if(x!==g)x.dispose()})}}
function roof(w,d,eave,rise,m,x,y,z,alongX=true){
  const shape=new THREE.Shape();shape.moveTo(-d/2,0);shape.lineTo(0,rise);shape.lineTo(d/2,0);shape.lineTo(d/2-.08,-.12);shape.lineTo(0,rise-.12);shape.lineTo(-d/2+.08,-.12);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:w,bevelEnabled:false});g.translate(-w/2,0,0);g.rotateY(Math.PI/2); // ridge along local z
  if(alongX)g.rotateY(Math.PI/2);const o=new THREE.Mesh(g,m);o.position.set(x,y+eave,z);o.castShadow=o.receiveShadow=true;return o;
}
function house(parent,{x,z,w=6,d=12,f=2,dir=0,variant=0}){
  const g=new THREE.Group(),h=f*3.05,w0=dir?w:d,d0=dir?d:w,wall=M.wall[variant%M.wall.length];g.name=`CITY_HOUSE_${variant}`;g.userData.contextBuilding=true;g.position.set(x,0,z);parent.add(g);
  g.add(box(w0,h,d0,wall,0,0,0));g.add(roof(w0,d0,h,.9+(variant%3)*.18,M.roof[variant%M.roof.length],0,0,0,dir===0));
  g.add(box(w0+.22,.16,d0+.22,M.trim,0,h-.28,0));g.add(box(w0+.1,.12,d0+.1,M.trim,0,3.02,0));
  const front=dir===0?-d0/2-.012:-w0/2-.012,bays=Math.max(1,Math.round((dir===0?w0:d0)/2.6));
  for(let floor=0;floor<f;floor++)for(let b=0;b<bays;b++){
    if(cityQuality==='low'||(cityQuality==='medium'&&(b+floor)%2))continue;
    const u=(b+.5)/bays-.5,yy=.72+floor*3.05;
    if(dir===0){const xx=u*w0;g.add(box(.95,1.42,.045,M.glass,xx,yy,front));g.add(box(1.12,.09,.13,M.trim,xx,yy+1.5,front-.02));}
    else{const zz=u*d0;g.add(box(.045,1.42,.95,M.glass,front,yy,zz));g.add(box(.13,.09,1.12,M.trim,front-.02,yy+1.5,zz));}
  }
  if(dir===0)g.add(box(1.05,2.18,.07,M.door,-w0*.29,0,front-.03));else g.add(box(.07,2.18,1.05,M.door,front-.03,0,-d0*.29));
  compactGroup(g);
}
function lamp(parent,x,z){const g=new THREE.Group();g.position.set(x,0,z);g.add(box(.09,4.5,.09,M.metal,0,0,0));const bulb=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),new THREE.MeshBasicMaterial({color:0x9db0c4}));bulb.position.y=4.55;g.add(bulb);compactGroup(g);parent.add(g)}
function tree(parent,x,z,s=1){const g=new THREE.Group();g.position.set(x,0,z);g.add(box(.22,2.5,.22,M.trunk,0,0,0));for(const [a,b,c] of [[0,3,0],[.55,2.8,.18],[-.5,2.7,-.1]]){const q=new THREE.Mesh(new THREE.IcosahedronGeometry(.85*s,1),M.tree);q.position.set(a*s,b*s,c*s);g.add(q)}compactGroup(g);parent.add(g)}
function car(parent,x,z,rot=0,k=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;g.add(box(1.65,.68,3.7,M.car[k%3],0,.18,0));g.add(box(1.45,.55,1.85,M.glass,0,.84,-.15));compactGroup(g);parent.add(g)}

export function buildCityEnvironment(scene,{visible=true,quality='medium'}={}){
  cityQuality=quality;
  const city=new THREE.Group();city.name='CITY_CONTEXT';city.visible=visible;scene.add(city);
  // Main north-south road to the east, secondary streets and three extra lanes.
  city.add(box(17,.05,112,M.road,38,-.06,-25));city.add(box(112,.045,10,M.road,0,-.055,22));
  for(const x of [28,48])city.add(box(3.1,.11,112,M.walk,x,-.02,-25));
  for(const x of [29.6,46.4])city.add(box(.18,.18,112,M.curb,x,0,-25));
  for(const z of [16,28])city.add(box(112,.1,.18,M.curb,0,0,z));
  for(const z of [-5,-40,-66])city.add(box(54,.025,3.2,M.lane,-1,-.02,z));
  // Lane mouths and stone thresholds make the circulation readable from above.
  for(const z of [-5,-40,-66])for(const x of [-25,24])city.add(box(.3,.3,3.5,M.trim,x,0,z));
  // Six heterogeneous lilong clusters surrounding the protected core rectangle.
  const blocks=[
    {xs:[-45,-37,-29],zs:[8,-10],dir:0},{xs:[-45,-36,-27],zs:[-44,-61],dir:0},
    {xs:[7,15,23],zs:[7,-9],dir:0},{xs:[6,14,22],zs:[-45,-62],dir:0},
    {xs:[-43,-25,-7,11],zs:[39,50],dir:1},{xs:[-42,-24,-6,12],zs:[-82,-94],dir:1}
  ];
  // Keep a hard clearance around community_05. This prevents context houses
  // from occupying the same volume as the original walls/repair panels.
  const core={x0:-25,x1:25,z0:-39,z1:9};let n=0;
  for(const b of blocks)for(const z of b.zs)for(const x of b.xs){const v=n++,w=5.4+(v%3)*.75,d=10.5+(v%4)*.8,w0=b.dir?w:d,d0=b.dir?d:w,overlap=x+w0/2>core.x0&&x-w0/2<core.x1&&z+d0/2>core.z0&&z-d0/2<core.z1;if(overlap)continue;house(city,{x,z,w,d,f:v%7===0?3:2,dir:b.dir,variant:v});}
  // Taller but subdued perimeter masses establish metropolitan depth.
  for(const [x,z,w,d,h] of [[-52,-25,10,16,15],[-50,33,12,15,18],[18,50,15,12,16],[58,10,12,18,22],[58,-38,13,17,18],[24,-93,18,12,16],[-23,-102,15,12,18]]){
    city.add(box(w,h,d,M.wall[(n++)%4],x,0,z));city.add(box(w+.3,.22,d+.3,M.trim,x,h-.1,z));
    if(cityQuality!=='low')for(let yy=2;yy<h-1;yy+=3.1)for(let xx=-w*.35;xx<=w*.35;xx+=cityQuality==='high'?2.5:5)city.add(box(.7,1.25,.04,M.glass,x+xx,yy,z-d/2-.03));
  }
  // Street furniture kept sparse enough to preserve the architectural reading.
  for(let z=-72;z<24;z+=cityQuality==='low'?24:12){lamp(city,30,z);if(cityQuality!=='low')lamp(city,46,z+5)}
  for(const [x,z,s] of [[27,-18,1],[49,-30,.9],[27,-54,.8],[49,-68,1],[-22,27,.85],[-6,27,.9],[17,27,.8]])tree(city,x,z,s);
  car(city,35,-7,0,0);car(city,41,-32,Math.PI,1);car(city,36,-61,0,2);car(city,42,13,Math.PI,0);
  // Road markings and crosswalks.
  const mark=mat(0x647078);for(let z=-76;z<28;z+=8)city.add(box(.12,.014,3.8,mark,38,.01,z));
  for(let i=-4;i<=4;i++)city.add(box(.45,.018,5.8,mark,38+i*1.2,.015,20));
  // A cool ambient veil and perimeter rim light separate the silhouettes.
  const fill=new THREE.DirectionalLight(0xa8bdca,1.65);fill.position.set(45,55,20);city.add(fill);
  const ambient=new THREE.HemisphereLight(0xb8c8d2,0x24323b,1.35);city.add(ambient);
  const sideFill=new THREE.DirectionalLight(0x6f8da0,.85);sideFill.position.set(-55,24,-35);city.add(sideFill);
  return city;
}

export const CITY_CAMERA={position:[58,45,59],target:[-3,2.8,-27],fov:35};
