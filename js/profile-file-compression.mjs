// File extensions stay .player/.clan. Gzip is identified by its magic bytes,
// while legacy UTF-8 JSON files continue to work without conversion.
export async function compressProfileText(text){
  const compact=JSON.stringify(JSON.parse(text));
  const plain=new Blob([compact],{type:'application/json'});
  if(typeof CompressionStream==='undefined')return plain;
  const compressed=await new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return new Blob([compressed],{type:'application/gzip'});
}

export async function readProfileText(file,{maxBytes,sizeLimitMessage}){
  if(file.size>maxBytes)throw new Error(sizeLimitMessage);
  const header=new Uint8Array(await file.slice(0,2).arrayBuffer());
  const gzip=header[0]===0x1f&&header[1]===0x8b;
  if(gzip&&typeof DecompressionStream==='undefined')throw new Error('Update your browser to import compressed profile files.');
  const stream=gzip?file.stream().pipeThrough(new DecompressionStream('gzip')):file.stream();
  const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  const chunks=[];let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){
        await reader.cancel().catch(()=>{});
        const error=new Error(sizeLimitMessage);error.code='PROFILE_SIZE_LIMIT';throw error;
      }
      chunks.push(decoder.decode(value,{stream:true}));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  }catch(error){
    if(error.code==='PROFILE_SIZE_LIMIT')throw error;
    throw new Error(gzip?'This compressed profile file is damaged or incomplete.':'This file is not valid UTF-8 profile data.');
  }finally{reader.releaseLock();}
}
