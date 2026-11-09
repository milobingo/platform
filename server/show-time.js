export const SHOW_TIME_ZONE='Europe/Amsterdam';
const invalid=(message,code='show_time_invalid')=>Object.assign(new Error(message),{status:400,code});
const localPattern=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:SHOW_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const wall=value=>formatter.format(new Date(value)).replace(' ','T');
export function normalizeShowTime(value,{timeZone}={}){
 if(typeof value!=='string')throw invalid('Kies een geldige datum en tijd.');
 const local=localPattern.exec(value);
 if(!local){
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid('Geef een tijdstip met UTC-offset of expliciet Europe/Amsterdam op.');
  const calendar=new Date(value.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(+calendar)||calendar.toISOString().slice(0,10)!==value.slice(0,10))throw invalid('Deze kalenderdatum bestaat niet.');
  return {date:new Date(value).toISOString(),timeZone:SHOW_TIME_ZONE};
 }
 if(timeZone!==SHOW_TIME_ZONE)throw invalid('Een lokale showtijd vereist expliciet Europe/Amsterdam.','show_time_zone_required');
 const [y,m,d,h,min,s]=local.slice(1,7).map(Number),ms=Number((local[7]||'').padEnd(3,'0')||0),base=Date.UTC(y,m-1,d,h,min,s||0,ms);
 const expected=`${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6]||'00'}`;
 const probe=new Date(base);if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==m-1||probe.getUTCDate()!==d||h>23||min>59||(s||0)>59)throw invalid('Deze kalenderdatum of tijd bestaat niet.');
 const matches=[];for(let offset=-180;offset<=180;offset+=30){const candidate=base-offset*60000;if(wall(candidate)===expected)matches.push(candidate);}
 if(matches.length===0)throw invalid('Deze Amsterdamse tijd bestaat niet door de zomertijd. Kies een ander tijdstip.','show_time_gap');
 if(matches.length!==1)throw invalid('Deze Amsterdamse tijd komt tweemaal voor. Geef expliciet de juiste UTC-offset op.','show_time_ambiguous');
 return {date:new Date(matches[0]).toISOString(),timeZone:SHOW_TIME_ZONE};
}
export function showTimeParts(value){
 const local=typeof value==='string'&&localPattern.exec(value);
 if(local)return {date:new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeZone:'UTC'}).format(new Date(local[1]+'-'+local[2]+'-'+local[3]+'T12:00:00Z')),time:local[4]+':'+local[5],reviewRequired:true};
 const date=new Date(value);if(!Number.isFinite(+date))throw invalid('De showdatum moet eerst worden gecontroleerd.');
 return {date:new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeZone:SHOW_TIME_ZONE}).format(date),time:new Intl.DateTimeFormat('nl-NL',{timeStyle:'short',timeZone:SHOW_TIME_ZONE}).format(date),reviewRequired:false};
}
