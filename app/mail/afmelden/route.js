import {dispatchNodeRequest} from '../../../server/node-runtime.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=request=>dispatchNodeRequest(request);
export const HEAD=request=>dispatchNodeRequest(request);
export const POST=request=>dispatchNodeRequest(request);
