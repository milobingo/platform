export class FamilyLiveFeed{
 constructor(request){this.request=request;this.entries=new Map();this.epoch=0;this.accountId=null;}
 clear(){this.epoch++;this.entries.clear();this.accountId=null;}
 setAccount(accountId){if(this.accountId!==accountId){this.clear();this.accountId=accountId;}}
 async read(id,brand){
  const epoch=this.epoch,account=this.accountId,entry=this.entries.get(id),query=new URLSearchParams({player:'1',brand});
  if(entry){query.set('scope',entry.scope||'');query.set('since',String(entry.game.revision));query.set('familySince',String(entry.familyRevision));query.set('booksVersion',entry.booksVersion);query.set('configVersion',entry.configVersion||'');}
  else query.set('snapshot','1');
  const data=await this.request('/games/'+id+'/live?'+query);
  if(epoch!==this.epoch||account!==this.accountId)throw new DOMException('De gezinssessie is veranderd.','AbortError');
  if(data.unchanged&&(!entry||entry.scope!==data.scope)){this.entries.delete(id);throw Error('De livefeed vraagt een nieuwe gezinssituatie.');}
  if(data.unchanged)return {...data,game:this.entries.get(id)?.game||entry?.game};
  if(!data.game||data.game.id!==id)throw Error('De livefeed hoort niet bij de gekozen show.');
  if(!data.complete&&!entry){this.entries.delete(id);throw Error('De livefeed vraagt een nieuwe beginsituatie.');}
  const game=data.complete?data.game:{...entry.game,...data.game};
  const latest=this.entries.get(id);if(latest&&game.revision<latest.game.revision){const {family,...safe}=data;void family;return {...safe,game:latest.game};}
  this.entries.set(id,{game,scope:data.scope,booksVersion:data.booksVersion,configVersion:data.configVersion,familyRevision:data.familyRevision});
  while(this.entries.size>4)this.entries.delete(this.entries.keys().next().value);
  return {...data,game};
 }
}
