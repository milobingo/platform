import * as THREE from 'three';

const audienceBounds=[[144,1,398,496],[654,2,886,495],[1121,2,1395,496],[140,499,394,1016],[630,498,909,1016],[1148,499,1396,1017]];
export function createAudience(atlas){
 const root=new THREE.Group();root.name='ShowtimeAudience';atlas.colorSpace=THREE.SRGBColorSpace;
 const people=[],material=new THREE.MeshBasicMaterial({map:atlas,alphaTest:.15,side:THREE.DoubleSide,toneMapped:false});
 for(const bank of [-1,1])for(let row=0;row<3;row++)for(let col=0;col<5;col++){
  const variant=(row*3+col+(bank===1?2:0))%6,[x0,y0,x1,y1]=audienceBounds[variant],height=1.29+(col%2)*.055,width=height*(x1-x0)/(y1-y0);
  const g=new THREE.PlaneGeometry(width,height),uv=g.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,(x0+uv.getX(i)*(x1-x0))/1536,1-(y1-uv.getY(i)*(y1-y0))/1024);
  const person=new THREE.Mesh(g,material),p=new THREE.Vector3(-1.55+col*.775,.22+row*.43+.025+height/2,-row*.86+.10);
  p.applyAxisAngle(new THREE.Vector3(0,1,0),-bank*(Math.PI/2-.20)).add(new THREE.Vector3(bank*5.85,0,-.50));
  person.position.copy(p);person.name=`Audience_${bank}_${row}_${col}`;person.userData.baseY=p.y;root.add(person);people.push(person);
 }
 return {root,people,update(time,camera,moving=true){for(let i=0;i<people.length;i++){const p=people[i];p.lookAt(camera.position.x,p.position.y,camera.position.z);if(moving){p.position.y=p.userData.baseY+Math.sin(time*.65+i*1.7)*.006;p.rotateZ(Math.sin(time*.38+i)*.007);}}}};
}

export function createDeskDisplay(canvasFactory=()=>document.createElement('canvas')){
 const root=new THREE.Group();root.name='DeskLED';
 const canvas=canvasFactory();canvas.width=1536;canvas.height=256;const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const curve=(x,y)=>new THREE.Vector3(-.4+x,y,-.88+(.22+.265*(1-(x/2.21)**2))*1.11+.021);
 const geometry=new THREE.PlaneGeometry(3.95,.70,64,1),p=geometry.attributes.position;
 for(let i=0;i<p.count;i++){const v=curve(p.getX(i),p.getY(i)+.635);p.setXYZ(i,v.x,v.y,v.z);}geometry.computeVertexNormals();
 const panel=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));panel.name='DeskNumberScreen';root.add(panel);
 const gold=new THREE.MeshStandardMaterial({color:'#e6ba6e',metalness:.82,roughness:.22});
 for(const y of [.27,1]){const points=Array.from({length:65},(_,i)=>curve(-1.99+i*3.98/64,y));root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,.019,8,false),gold));}
 let signature='';
 function update(drawn=[],pending=null){
  const next=drawn.join(',')+'|'+pending;if(next===signature)return;signature=next;
  const bg=ctx.createLinearGradient(0,0,1536,256);bg.addColorStop(0,'#03142e');bg.addColorStop(.6,'#123b84');bg.addColorStop(1,'#07192f');ctx.fillStyle=bg;ctx.fillRect(0,0,1536,256);
  ctx.fillStyle='#ebc376';ctx.font='700 28px Arial';ctx.fillText('VLAMPIE’S BINGO',36,52);
  ctx.fillStyle='#c2d8ff';ctx.font='21px Arial';ctx.fillText(pending!==null?'DE MOLEN DRAAIT':drawn.length?'LAATST GETROKKEN':'KLAAR VOOR DE SHOW',36,94);
  ctx.fillStyle='#ffffff';ctx.font='700 63px Arial';ctx.fillText(String(drawn.length).padStart(2,'0'),36,180);ctx.font='20px Arial';ctx.fillStyle='#c2d8ff';ctx.fillText('/ 75 BALLEN',126,176);
  const last=drawn.slice(-7);
  if(!last.length){ctx.fillStyle='#f7e7c4';ctx.font='600 38px Arial';ctx.fillText('De getrokken nummers verschijnen hier',355,151);}
  last.forEach((n,i)=>{const x=370+i*164,y=139,r=i===last.length-1?66:59,active=i===last.length-1;const fill=ctx.createRadialGradient(x-20,y-25,4,x,y,r);fill.addColorStop(0,active?'#fffbe9':'#ffffff');fill.addColorStop(1,active?'#e8b958':'#b4c6e3');ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=3;ctx.strokeStyle=active?'#fff5c5':'#f0f5ff';ctx.stroke();ctx.fillStyle='#082247';ctx.font='800 55px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n),x,y+2);ctx.textAlign='start';ctx.textBaseline='alphabetic';});
  ctx.fillStyle='#ffffff0b';for(let y=3;y<256;y+=6)ctx.fillRect(0,y,1536,1);
  texture.needsUpdate=true;
 }
 update();return {root,texture,update,canvas};
}
