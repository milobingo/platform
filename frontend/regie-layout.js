export const REGIE_LAYOUT_VERSION = 1;
export const DEFAULT_REGIE_PANELS = ['rundown','cameras','bingo'];
export const layoutKey = production => `mf:regie-layout:v${REGIE_LAYOUT_VERSION}:${production==='vlampie'?'vlampie':'milo'}`;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

export function normalizeLayout(value, ids) {
 const available=[...new Set(ids)],defaults=DEFAULT_REGIE_PANELS.filter(id=>available.includes(id));
 const raw=Array.isArray(value?.slots)?value.slots:defaults;
 const slots=[...new Set(raw.filter(id=>available.includes(id)))].slice(0,4);
 if(!slots.length)slots.push(...(defaults.length?defaults:available.slice(0,3)));
 const weights=slots.map((_,i)=>Number.isFinite(value?.weights?.[i])?clamp(value.weights[i],.55,2.5):1);
 return {slots,weights};
}
export function movePanel(layout,id,targetId) {
 const from=layout.slots.indexOf(id),to=layout.slots.indexOf(targetId);
 if(from<0||to<0||from===to)return layout;
 const slots=[...layout.slots];slots.splice(from,1);slots.splice(to,0,id);
 return {...layout,slots};
}
export function revealPanel(layout,id,index) {
 if(layout.slots.includes(id))return layout;
 const slots=[...layout.slots];slots[clamp(index,0,Math.max(0,slots.length-1))]=id;
 return {...layout,slots};
}
export function resizeColumns(layout,index,delta) {
 if(index<0||index>=layout.weights.length-1||!Number.isFinite(delta))return layout;
 const weights=[...layout.weights],sum=weights[index]+weights[index+1];
 weights[index]=clamp(weights[index]+delta,Math.max(.55,sum-2.5),Math.min(2.5,sum-.55));
 weights[index+1]=sum-weights[index];
 return {...layout,weights};
}
