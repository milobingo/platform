// The probe document is local test code, fulfilled by Playwright. Its origin
// matches the real family app so signed HLS fetches exercise actual CORS rules.
export function sameOriginProbeDocument(origin,nonce){
  if(origin!=='https://milo-staging.dgwebservices.nl'||!/^[a-f0-9-]{36}$/.test(nonce||''))throw new Error('De lokale HLS-probe vereist de eigen stagingorigin en een willekeurige private documentnaam.');
  const documentUrl=`${origin}/_milo_media_probe/${nonce}`,scriptUrl=documentUrl+'.js';
  return {documentUrl,scriptUrl,html:`<!doctype html><html lang="nl"><meta charset="utf-8"><title>Afgeschermde Milo HLS-mediaproef</title><script type="module" src="${scriptUrl}"></script></html>`};
}
