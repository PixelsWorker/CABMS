import { crc32, inflateSync } from 'node:zlib';

/** Private evidence storage seam. The Worker supplies keys and never returns them as public URLs. */
export interface PrivateEvidenceStore {
  put(key: string, body: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export type PhotoMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
type PhotoProblem = 'EVIDENCE_INVALID' | 'UPLOAD_TOO_LARGE' | 'RESOURCE_NOT_FOUND';

function photoType(bytes: Uint8Array): PhotoMediaType | null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const prefix=(values:number[])=>values.every((value,i)=>bytes[i]===value);
  const tag=(offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(prefix([137,80,78,71,13,10,26,10])) {
    let data=false;
    const chunks:Uint8Array[]=[];
    for(let pos=8;pos+12<=bytes.length;) {
      const n=view.getUint32(pos), end=pos+12+n;
      if(end>bytes.length || crc32(bytes.subarray(pos+4,end-4))!==view.getUint32(end-4))return null;
      const type=tag(pos+4);
      if(pos===8 && (type!=='IHDR' || n!==13 || !view.getUint32(16) || !view.getUint32(20)))return null;
      if(type==='IDAT'){data=true;chunks.push(bytes.subarray(pos+8,end-4));}
      if(type==='IEND'){
        if(!data || n!==0 || end!==bytes.length)return null;
        // Validate the decompressed scanline layout, including all seven Adam7 passes.
        const width=view.getUint32(16), height=view.getUint32(20), depth=bytes[24], colour=bytes[25];
        const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
        const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if(!depths[colour]?.includes(depth) || bytes[26] || bytes[27] || bytes[28]>1)return null;
        const passes=bytes[28]?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
        const layout=passes.map(([x,y,dx,dy])=>{
          const cols=Math.max(0,Math.ceil((width-x)/dx)),rows=Math.max(0,Math.ceil((height-y)/dy));
          return {stride:1+Math.ceil(cols*channels[colour]*depth/8),rows:cols?rows:0};
        });
        const size=layout.reduce((total,pass)=>total+pass.stride*pass.rows,0);
        if(!size || size>32*1024*1024)return null;
        try {
          const raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:size});
          if(raw.length!==size)return null;
          let offset=0;
          for(const {stride,rows} of layout)for(let y=0;y<rows;y++,offset+=stride)if(raw[offset]>4)return null;
          return 'image/png';
        } catch{return null;}
      }
      pos=end;
    }
  }
  if(prefix([255,216,255]) && bytes.at(-2)===255 && bytes.at(-1)===217){
    let frame=false;
    for(let pos=2;pos+4<=bytes.length;) {
      if(bytes[pos++]!==255)return null;
      while(bytes[pos]===255)pos++;
      if(pos+3>bytes.length)return null;
      const marker=bytes[pos++],n=view.getUint16(pos);
      if(n<2 || pos+n>bytes.length-2)return null;
      if([192,193,194].includes(marker))frame=n>=11 && !!view.getUint16(pos+3) && !!view.getUint16(pos+5);
      if(marker===218)return frame && n>=8 && pos+n<bytes.length-2?'image/jpeg':null;
      pos+=n;
    }
  }
  if(bytes.length>=20 && tag(0)==='RIFF' && tag(8)==='WEBP' && view.getUint32(4,true)===bytes.length-8){
    let image=false,pos=12;
    for(;pos+8<=bytes.length;){
      const n=view.getUint32(pos+4,true),data=pos+8;
      if(data+n>bytes.length)return null;
      if(tag(pos)==='VP8L')image=n>5 && bytes[data]===47;
      if(tag(pos)==='VP8 ')image=n>10 && bytes[data+3]===157 && bytes[data+4]===1 && bytes[data+5]===42;
      pos=data+n+(n%2);
    }
    if(image && pos===bytes.length)return 'image/webp';
  }
  return null;
}

export function inspectPhoto(bytes: Uint8Array, mediaType: string, maxBytes: number | null):
  { error: PhotoProblem } | { mediaType: PhotoMediaType } {
  if (maxBytes === null || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) return {error:'EVIDENCE_INVALID'};
  if (bytes.length > maxBytes) return {error:'UPLOAD_TOO_LARGE'};
  const detected = photoType(bytes);
  return detected && detected === mediaType ? {mediaType:detected} : {error:'EVIDENCE_INVALID'};
}

export async function stagePhoto(store: PrivateEvidenceStore, key: string, bytes: Uint8Array,
  mediaType: string, maxBytes: number | null) {
  const checked = inspectPhoto(bytes,mediaType,maxBytes);
  if ('error' in checked) return checked;
  await store.put(key,bytes);
  return {staged:true as const};
}

/** Re-read actual stored bytes, then copy verified bytes to a fresh server-generated key. */
export async function finalizePhoto(store: PrivateEvidenceStore, stagedKey: string, finalKey: string,
  mediaType: string, maxBytes: number | null, expectedDigest?:string) {
  if (maxBytes === null || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || stagedKey === finalKey) {
    return {error:'EVIDENCE_INVALID' as const};
  }
  const object = await store.get(stagedKey);
  if (!object) return {error:'RESOURCE_NOT_FOUND' as const};
  if (object.size !== undefined && object.size > maxBytes) return {error:'UPLOAD_TOO_LARGE' as const};
  const buffer = await object.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const checked = inspectPhoto(bytes,mediaType,maxBytes);
  if ('error' in checked) return checked;
  const sha256 = await photoDigest(bytes);
  if (expectedDigest !== undefined && expectedDigest !== sha256) return {error:'EVIDENCE_INVALID' as const};
  await store.put(finalKey,bytes);
  const saved = await store.get(finalKey);
  if (!saved || await photoDigest(new Uint8Array(await saved.arrayBuffer())) !== sha256) throw new Error('Object write could not be verified');
  return {byteLength:bytes.length,mediaType:checked.mediaType,sha256};
}

export async function photoDigest(bytes:Uint8Array) {
  const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
