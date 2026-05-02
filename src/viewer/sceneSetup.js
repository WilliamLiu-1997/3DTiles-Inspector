import {
  AmbientLight,
  Color,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
} from '@sparkjsdev/spark';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { CameraController } from './cameraController.js';
import { createCropBoxLineGeometry } from './cropBox.js';

export function createViewerScene({
  basisTranscoderPath,
  container,
  dracoDecoderPath,
}) {
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
    reversedDepthBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);

  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(basisTranscoderPath);
  ktx2Loader.detectSupport(renderer);

  const scene = new Scene();
  scene.background = new Color(0xffffff);

  const terrainLight = new AmbientLight(0xffffff, Math.PI);
  terrainLight.visible = false;
  scene.add(terrainLight);

  const camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    2e7,
  );
  camera.position.set(0, 0, 1.75e7);
  camera.updateMatrixWorld(true);

  const contentGroup = new Group();
  scene.add(contentGroup);

  const globeGroup = new Group();
  contentGroup.add(globeGroup);

  const editableGroup = new Group();
  contentGroup.add(editableGroup);

  const transformHandle = new Group();
  scene.add(transformHandle);

  const cropGroup = new Group();
  cropGroup.name = 'Crop Boxes';
  scene.add(cropGroup);

  const cropSplatEdit = new SplatEdit({
    name: 'Crop Box Preview Hide',
    rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
    sdfSmooth: 0,
    softEdge: 0,
  });
  scene.add(cropSplatEdit);

  return {
    camera,
    cameraController: new CameraController(renderer, contentGroup, camera),
    cropBoxLineGeometry: createCropBoxLineGeometry(),
    cropGroup,
    cropSplatEdit,
    dracoLoader,
    editableGroup,
    globeGroup,
    ktx2Loader,
    renderer,
    scene,
    terrainLight,
    transformHandle,
  };
}
