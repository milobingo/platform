export const readCookie=(request,name)=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
// Set only by the server adapter after session verification. Incoming headers,
// email addresses and user-editable metadata never grant a role.
export function platformIdentity(request,env={}){
 const identity=env.AUTH_IDENTITY;
 return identity?.user?{user:identity.user,email:identity.email||'',admin:identity.admin===true,role:identity.admin===true?'regie':'player',method:identity.method||'supabase'}:{user:null,email:'',admin:false,role:null,method:'anonymous'};
}
export async function playerIdentity(request,env){
 return platformIdentity(request,env);
}
export function birthAge(value,now=new Date()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Object.assign(new Error('Vul een geldige geboortedatum in.'),{status:400,code:'birth_date'});
 const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)throw Object.assign(new Error('Vul een geldige geboortedatum in.'),{status:400,code:'birth_date'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const age=Number(today.slice(0,4))-Number(value.slice(0,4))-(today.slice(5)<value.slice(5)?1:0);
 if(value>today||age<0||age>120)throw Object.assign(new Error('Controleer de geboortedatum.'),{status:400,code:'birth_date'});return age;
}
export const refreshAges=family=>({...family,profiles:family.profiles.map(p=>({...p,age:p.dateOfBirth?birthAge(p.dateOfBirth):p.age}))});
