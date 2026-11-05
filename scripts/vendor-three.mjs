import {mkdir,copyFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const files={
  'build/three.module.js':'three.module.js',
  'build/three.core.js':'three.core.js',
  'examples/jsm/loaders/GLTFLoader.js':'addons/loaders/GLTFLoader.js',
  'examples/jsm/controls/OrbitControls.js':'addons/controls/OrbitControls.js',
  'examples/jsm/environments/RoomEnvironment.js':'addons/environments/RoomEnvironment.js',
  'examples/jsm/utils/BufferGeometryUtils.js':'addons/utils/BufferGeometryUtils.js',
  'examples/jsm/objects/Reflector.js':'addons/objects/Reflector.js',
  'examples/jsm/postprocessing/EffectComposer.js':'addons/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/Pass.js':'addons/postprocessing/Pass.js',
  'examples/jsm/postprocessing/MaskPass.js':'addons/postprocessing/MaskPass.js',
  'examples/jsm/postprocessing/RenderPass.js':'addons/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/ShaderPass.js':'addons/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js':'addons/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js':'addons/postprocessing/OutputPass.js',
  'examples/jsm/shaders/CopyShader.js':'addons/shaders/CopyShader.js',
  'examples/jsm/shaders/LuminosityHighPassShader.js':'addons/shaders/LuminosityHighPassShader.js',
  'examples/jsm/shaders/OutputShader.js':'addons/shaders/OutputShader.js',
  'examples/jsm/shaders/FXAAShader.js':'addons/shaders/FXAAShader.js',
  'LICENSE':'LICENSE'
};
for(const [source,target]of Object.entries(files)){const dest=resolve('public/vendor/three',target);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve('node_modules/three',source),dest);}
console.log('Three.js runtime copied to the static site.');
