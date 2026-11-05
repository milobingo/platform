export function enableLitDomCompatibility(document,customElements){
// linkedom's TreeWalker snapshots its initial root; Lit reassigns currentNode like a browser.
// Model that standard behavior so dynamic bindings are actually exercised here.
const define=customElements.define.bind(customElements);customElements.define=(name,ctor)=>{void ctor.observedAttributes;return define(name,ctor);};
const createElement=document.createElement.bind(document);document.createElement=(name,...args)=>{const el=createElement(name,...args);if(name==='template'){let p=el,desc;while(p&&!desc){desc=Object.getOwnPropertyDescriptor(p,'innerHTML');p=Object.getPrototypeOf(p);}Object.defineProperty(el,'innerHTML',{get(){return desc.get.call(this);},set(value){desc.set.call(this,String(value).replace(/<\?([^>]*)>/g,'<!--?$1-->'));}});}return el;};
document.createTreeWalker=(root,mask)=>{let current=root,bound=root;return {get currentNode(){return current;},set currentNode(node){current=node;bound=node;},nextNode(){let n=current;while(n){if(n.firstChild)n=n.firstChild;else{while(n&&n!==bound&&!n.nextSibling)n=n.parentNode;if(!n||n===bound)return null;n=n.nextSibling;}if(mask&(1<<(n.nodeType-1)))return current=n;}return null;}};};

}
