// A dialog describes the goal the parent actually saw, rather than whatever
// a later poll happens to install. The server repeats all of these checks.
export function freezeClaimDialog(game){
 if(!game?.state?.claimContext)return null;
 return structuredClone({context:game.state.claimContext,goal:game.state.goal,books:(game.books||[]).filter(b=>b.admitted&&!b.revokedAt).map(b=>({id:b.id,name:b.name,ticket:b.ticket}))});
}
export function claimDialogCurrent(dialog,game){
 const a=dialog?.context,b=game?.state?.claimContext;
 if(!a||!b||game.status!=='running')return false;
 if(['gameId','brandId','roundId','goalId','epoch','patternVersion'].some(k=>a[k]!==b[k]))return false;
 if(a.windowStatus==='open')return a.windowId===b.windowId&&b.windowStatus==='open';
 // Another household can open the first shared window for this same goal.
 return a.windowSequence===b.windowSequence&&a.windowId===b.windowId||b.windowStatus==='open'&&b.windowSequence===a.windowSequence+1;
}
export function familyClaimState(game,bookId,serverNow){
 const window=game?.state?.window;
 if(window?.status!=='open'||serverNow>=window.endsAt)return null;
 return window.claims?.find(c=>c.bookId===bookId)||null;
}
