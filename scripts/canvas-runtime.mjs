import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
// Prefer the locked repository dependency; retain the explicit authoring override.
export const canvasRuntime=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'@napi-rs/canvas')
  :'@napi-rs/canvas');
