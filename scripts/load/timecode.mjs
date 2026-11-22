export const CLOCK_EPOCH = Date.UTC(2020,0,1);
export function crc16(bytes) {
  let crc=0xffff;
  for(const value of bytes){crc^=value<<8;for(let bit=0;bit<8;bit++)crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;}
  return crc;
}
export function encodeFrameTime(ms) {
  let value=BigInt(Math.floor(ms-CLOCK_EPOCH));
  if(value<0n||value>0xffffffffffffn)throw new Error('Tijdcode buiten bereik.');
  const bytes=Array(6).fill(0);
  for(let i=5;i>=0;i--){bytes[i]=Number(value&255n);value>>=8n;}
  const checksum=crc16(bytes);
  return [...bytes,checksum>>8,checksum&255].flatMap(byte=>Array.from({length:8},(_,i)=>(byte>>(7-i))&1));
}
export function decodeFrameTime(bits) {
  if(bits.length!==64||bits.some(bit=>bit!==0&&bit!==1))return null;
  const bytes=Array.from({length:8},(_,i)=>bits.slice(i*8,i*8+8).reduce((n,b)=>(n<<1)|b,0));
  if(crc16(bytes.slice(0,6))!==((bytes[6]<<8)|bytes[7]))return null;
  return CLOCK_EPOCH+bytes.slice(0,6).reduce((n,b)=>n*256+b,0);
}
// Fixed 1280×720 test source: cells 16..1232, stripe y=656..704.
export function drawFrameTime(context,ms) {
  const bits=encodeFrameTime(ms);
  context.fillStyle='#888';context.fillRect(0,648,1280,72);
  bits.forEach((bit,index)=>{context.fillStyle=bit?'white':'black';context.fillRect(16+index*19,656,19,48);});
}
export function readFrameTime(context,video) {
  context.drawImage(video,0,0,1280,720);
  const pixels=context.getImageData(0,680,1280,1).data;
  const bits=Array.from({length:64},(_,i)=>{const x=(16+i*19+9)*4;return (pixels[x]+pixels[x+1]+pixels[x+2])/3>128?1:0;});
  return decodeFrameTime(bits);
}
