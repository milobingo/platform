import {dispatchNodeRequest} from '../../../server/node-runtime.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return dispatchNodeRequest(request);}
export async function POST(request){return dispatchNodeRequest(request);}
