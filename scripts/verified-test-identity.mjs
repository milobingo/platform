// Original handler regressions run below the HTTP adapter. Their requests model
// identities already verified by a provider, so translate the fixture input to
// the server-only identity binding here. Runtime tests separately prove that
// actual incoming HTTP headers cannot authenticate a user.
export function verifiedTestEnvironment(request,env={}){
 const user=request.headers.get('oai-authenticated-user-id')||null;
 const email=(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
 return {...env,AUTH_IDENTITY:user?{user,email,admin:email===String(env.VLAMPIE_ADMIN_EMAIL||'').toLowerCase(),method:'test-provider'}:null};
}
