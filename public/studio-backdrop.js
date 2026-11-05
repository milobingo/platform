import * as THREE from 'three';

export function curvedBackdropGeometry(){
 const geometry=new THREE.PlaneGeometry(17.2,7.2,96,1),p=geometry.attributes.position;
 for(let i=0;i<p.count;i++)p.setZ(i,-.75+.75*(p.getX(i)/8.6)**2);
 geometry.computeVertexNormals();return geometry;
}

export function createStudioBackdrop(texture){
 const group=new THREE.Group();group.name='PremiumStudioBackdrop';
 texture.colorSpace=THREE.SRGBColorSpace;
 const material=new THREE.MeshStandardMaterial({color:'#bdceff',map:texture,roughness:.88,metalness:.035,emissive:'#7294e8',emissiveMap:texture,emissiveIntensity:.42});
 const wall=new THREE.Mesh(curvedBackdropGeometry(),material);wall.name='CurvedBlueStarWall';wall.position.set(0,3.1,-4);wall.receiveShadow=true;group.add(wall);
 for(const side of [-1,1]){
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(9,7.2),material);panel.name=side<0?'LeftStudioWall':'RightStudioWall';panel.position.set(side*8.6,3.1,.5);panel.rotation.y=-side*Math.PI/2;panel.receiveShadow=true;group.add(panel);
 }
 const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(17.2,9.8),new THREE.MeshStandardMaterial({color:'#050d22',roughness:.9}));ceiling.position.set(0,6.7,.15);ceiling.rotation.x=Math.PI/2;group.add(ceiling);
 return group;
}
