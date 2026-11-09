const invalid=()=>{throw Object.assign(new Error('De tijdelijke v70-herstelverbinding moet uitsluitend de bevestigde lokale scratch aanwijzen. Verbindingswaarden worden niet herhaald.'),{code:'staging_restore_target'});};

/** Validate before constructing pg.Pool. Returning explicit fields means pg
 * never reparses a connection string or applies query authority/TLS overrides. */
export function stagingRestoreTargetOptions(value){
 let url,user,password;
 try{
  if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f?#]/.test(value))invalid();
  url=new URL(value);user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);
 }catch{invalid();}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55433'||!/^\/milo_restore_test_v70_[a-z0-9_]+$/.test(url.pathname)||url.pathname.length>64||!user||!password||user.length>63||password.length>512||/[\x00-\x1f\x7f]/.test(user+password)||url.search||url.hash)invalid();
 return {host:'127.0.0.1',port:55433,user,password,database:url.pathname.slice(1),ssl:false,max:1,connectionTimeoutMillis:10000,statement_timeout:15000};
}
