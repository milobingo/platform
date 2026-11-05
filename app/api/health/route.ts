export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  const revision=process.env.RELEASE_SHA;
  return Response.json({
    status:'ok',
    revision:revision&&/^[a-f0-9]{40}$/.test(revision)?revision:null,
    releaseId:process.env.RELEASE_ID||null,
    configVersion:process.env.CONFIG_VERSION||null,
    checks:['http'],
  },{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
