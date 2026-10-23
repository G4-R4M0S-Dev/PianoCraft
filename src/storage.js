let connection;
function database() {
  connection ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('PianoCraft',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('library');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{connection=null;reject(request.error);};
  });
  return connection;
}
export async function getStored(key,fallback=null) {
  try {const db=await database();return await new Promise((resolve,reject)=>{const request=db.transaction('library').objectStore('library').get(key);request.onsuccess=()=>resolve(request.result??fallback);request.onerror=()=>reject(request.error);});}catch{return fallback;}
}
export async function setStored(key,value) {
  const db=await database();return new Promise((resolve,reject)=>{const transaction=db.transaction('library','readwrite');transaction.objectStore('library').put(value,key);transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
}
