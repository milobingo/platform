// Shared by the editor and server. This only parses a link; it never fetches
// bunq, opens a payment page or changes an order's payment state.
const failure=(code,message)=>Object.assign(new Error(message),{code});
function unwrap(value){
 let token=value;
 // Closing brackets and sentence punctuation after an outer bracket are not
 // part of a link. Balanced brackets in query values remain intact.
 for(;;){
  const before=token;
  const withoutSentence=token.replace(/[.,;:!?]+$/u,'');
  const last=withoutSentence.at(-1),open={')':'(',']':'[','}':'{'}[last];
  if(open&&withoutSentence.split(last).length>withoutSentence.split(open).length)token=withoutSentence.slice(0,-1);
  else break;
  if(token===before)break;
 }
 // A code cannot contain sentence punctuation. Query/fragment values can;
 // preserve those verbatim, including encoded punctuation and case.
 if(!/[?#]/u.test(token))token=token.replace(/[.,;:!?]+$/u,'');
 return token;
}
function oneLink(candidate){
 const token=unwrap(candidate),authority=/^https:\/\/([^/?#]+)/iu.exec(token);
 if(!authority||!/^bunq\.me(?::443)?$/iu.test(authority[1]))throw failure('bunq_host','Gebruik alleen een HTTPS-link van exact bunq.me, zonder inloggegevens of afwijkende poort.');
 let url;try{url=new URL(token);}catch{throw failure('bunq_invalid','De bunq-betaallink is geen geldige URL.');}
 if(url.protocol!=='https:'||url.hostname!=='bunq.me'||url.username||url.password||url.port)throw failure('bunq_host','Gebruik alleen een HTTPS-link van exact bunq.me, zonder inloggegevens of afwijkende poort.');
 const rawPath=token.slice(authority[0].length).split(/[?#]/u,1)[0],match=/^\/o\/([^/]+)$/u.exec(rawPath);
 let code;try{code=match&&decodeURIComponent(match[1]);}catch{}
 if(!code||!/^[-_A-Za-z0-9]+$/u.test(code)||code.length>512)throw failure('bunq_code','De bunq-betaallink moet een niet-lege linkcode hebben: https://bunq.me/o/linkcode.');
 return url.href;
}
export function normalizeBunqPaymentLink(value){
 if(typeof value!=='string'||!value.trim())throw failure('bunq_missing','Plak een bunq-betaallink of de volledige deeltekst uit bunq.');
 if(value.length>8000)throw failure('bunq_length','De geplakte tekst is te lang. Plak alleen de bunq-betaallink.');
 const candidates=[...value.matchAll(/https?:\/\/[^\s<>"'`“”‘’]+/giu)].map(match=>match[0]);
 if(!candidates.length)throw failure('bunq_missing','Geen bunq-betaallink gevonden. Plak een HTTPS-link zoals https://bunq.me/o/linkcode.');
 const links=new Set(candidates.map(oneLink));
 if(links.size!==1)throw failure('bunq_multiple','Er staan meerdere verschillende bunq-betaallinks in de tekst. Plak de ene link voor deze bestelling.');
 return [...links][0];
}
