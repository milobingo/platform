import {platformIdentity} from './player-identity.js';
import {handlePlayerAuth} from './player-auth.js';
import {handleOutput} from './output.js';
import {handleCalls} from './calls.js';
import {handleLiveCalls} from './live-calls.js';
import {handleLiveKit} from './livekit.js';
import {handleOpenAI} from './openai.js';
import {handlePlanner} from './planner.js';
import {handleBingo} from './bingo.js';
import {handleChat} from './chat.js';
import {handlePresentation} from './presentation.js';
import miloPage from './milo-page.js';
import {isStudioEntry,isFamilyEntry,normalizedEntry} from './site-entry.js';
import {handleCharacterSettings} from './character-settings.js';
import {handleMail} from './mail-api.js';
import {handlePublicRules} from './game-rules-api.js';
import {handleLiveFeed} from './live-feed.js';
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/spelregels'||url.pathname==='/api/bingo/rules')return handlePublicRules(request,env);
    if(url.pathname==='/mail/afmelden'||url.pathname.startsWith('/api/mail/'))return handleMail(request,env);
    if(isStudioEntry(url.pathname)&&!platformIdentity(request,env).admin)return Response.redirect(url.origin+'/spelen',302);
    if(/^\/api\/characters(?:\/|$)/.test(url.pathname))return handleCharacterSettings(request,env);
    if(url.pathname.startsWith('/api/player/'))return handlePlayerAuth(request,env);
    if(url.pathname==='/api/output')return handleOutput(request,env);
    if(url.pathname.startsWith('/api/live-calls'))return handleLiveCalls(request,env);
    if(url.pathname.startsWith('/api/livekit/'))return handleLiveKit(request,env);
    if(url.pathname==='/api/calls'||url.pathname==='/api/calls/settings')return handleCalls(request,env);
    if(url.pathname.startsWith('/api/openai/'))return handleOpenAI(request,env);
    if(url.pathname.startsWith('/api/presentation/'))return handlePresentation(request,env);
    if(url.pathname.startsWith('/api/planner/'))return handlePlanner(request,env);
    if(/^\/api\/bingo\/games\/[^/]+\/chat(?:\/|$)/.test(url.pathname))return handleChat(request,env);
    if(/^\/api\/bingo\/games\/[^/]+\/live$/.test(url.pathname))return handleLiveFeed(request,env);
    if(url.pathname.startsWith('/api/bingo/'))return handleBingo(request,env);
    if((isStudioEntry(url.pathname)||isFamilyEntry(url.pathname))&&['GET','HEAD'].includes(request.method)){
      const canonical=normalizedEntry(url);
      if(canonical)return new Response(null,{status:302,headers:{Location:canonical.href,'Cache-Control':'private, no-store'}});
      return new Response(request.method==='HEAD'?null:miloPage,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Milo-Workspace':'react-sterrenplein'}});
    }
    if(env.ASSETS?.fetch){
      const response=await env.ASSETS.fetch(request);
      // A cached entry can refer to chunks from an older deployment. Always fetch
      // the current entry, and never retain a missing chunk across a deployment.
      if(/^\/app\/main\.(?:js|css)$/.test(url.pathname)||url.pathname.startsWith('/app/chunks/')&&response.status>=400){
        const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
      return response;
    }
    return new Response('Niet gevonden',{status:404});
  }
};
