import {brandProfile,validBrand} from './show-brands.js';
import {PresentationStore} from './presentation-store.js';
import {defaultProfile,showPresentation} from './presentation-model.js';
export class PresentationError extends Error {constructor(message,status=400,code='presentation'){super(message);this.status=status;this.code=code;}}
export async function presentationContext(env,user,body,{source=false}={}){
 let game=null,profile=defaultProfile();
 if(body.gameId){const row=await env.DB?.prepare('SELECT owner_id,document FROM bingo_games WHERE id=?').bind(body.gameId).first();if(!row||row.owner_id!==user)throw new PresentationError('Dit spel hoort niet bij jouw regie.',403,'forbidden');game=JSON.parse(row.document);profile=showPresentation(game).profile;if(game.status==='draft'){const saved=await new PresentationStore(env.DB).read(user);profile=saved.document.profiles.find(p=>p.id===(body.profileId||game.presentationSelection?.profileId||saved.document.defaultProfileId))||profile;}
  if(body.automatic&&(game.status!=='running'||!body.regieId||game.state.control?.id!==body.regieId||game.state.control.until<=Date.now()))throw new PresentationError('Automatische reacties wachten op het actieve regievenster.',409,'control_busy');
 }else if(body.profileId){if(!env.DB?.prepare)throw new PresentationError('Profielen zijn niet beschikbaar.',503);const saved=await new PresentationStore(env.DB).read(user);profile=saved.document.profiles.find(p=>p.id===body.profileId);if(!profile)throw new PresentationError('Dit profiel bestaat niet.',404);}
 let message=null;
 if(source||body.messageId){if(!game||typeof body.messageId!=='string')throw new PresentationError('Kies een bericht uit de chat.');
  const row=await env.DB.prepare('SELECT m.id,m.body,m.name,m.member_id,m.created_at,m.deleted_at,c.muted_until,c.account_id,c.role,f.document AS family FROM bingo_chat_messages m JOIN bingo_chat_members c ON c.id=m.member_id LEFT JOIN bingo_families f ON f.account_id=c.account_id WHERE m.game_id=? AND m.id=?').bind(game.id,body.messageId).first();
  const family=row?.family?JSON.parse(row.family):{};
  if(!row||row.deleted_at||row.muted_until>Date.now()||family.blocked||family.blockedGames?.[game.id]||row.role==='host'||row.account_id===user||!game.books.some(b=>b.admitted&&b.accountId===row.account_id)&&row.role!=='moderator')throw new PresentationError('Dit bericht is verwijderd of niet meer geschikt voor de uitzending.',409,'source_unavailable');
  message={id:row.id,name:row.name,text:row.body,memberId:row.member_id,at:row.created_at};
 }
 profile=brandProfile(profile,game||{brandId:body.brandId?validBrand(body.brandId):profile.brandId});
 return {game,profile,message};
}
