// The family can receive a call while another dialog is open. Keep background
// scrolling locked until the last family dialog closes.
let depth=0,previous='';
export function lockFamilyDialogScroll(){
 if(depth++===0){previous=document.body.style.overflow;document.body.style.overflow='hidden';}
 let released=false;return()=>{if(released)return;released=true;if(--depth===0)document.body.style.overflow=previous;};
}
