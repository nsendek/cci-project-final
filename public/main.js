import { sketch as debugSketch } from "./src/debug.js"
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PoseTree, SmartBone, getMemoizedSkinnedMesh } from './src/tree.js'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

let camera, renderer, controls, poseTree, worldTreeRoot, gui, folder;

let lastTime = Date.now();
let currentTime = Date.now();

const sceneLights = [];
const sceneWalls = [];
const ROOM_SIZE = 2500;

let count = 0;
let poseCount = 0;
window.POSE_COUNT = 0;

main();

function main() {
  if (config.debugMode) {
    window.THREE = THREE; // so i can test stuff out in console.
  }

  init();
  render();
}

function init() {
  camera = new THREE.PerspectiveCamera(110, window.innerWidth / window.innerHeight, 1, 10000);
  camera.position.z = ROOM_SIZE / 2;
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  camera.updateProjectionMatrix();
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer();

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  document.getElementById('main').appendChild(renderer.domElement);
  document.body.style.touchAction = 'none';

  window.addEventListener('resize', onWindowResize);

  setupEnviroment();
  setupLights();
  setupTree();
  setupDebug();
  setupProd();
}

function render() {
  currentTime = Date.now();

  if (controls) {
    controls.update();
  }

  PoseTree.getInstances().forEach(instance => {
    instance.update();
  });

  // let count = 0;
  SmartBone.getInstances().forEach(instance => {
    // if (instance.update()) count++;
    instance.update();
  });

  renderer.render(scene, camera);
  lastTime = currentTime;

  // Do a little recursing.
  requestAnimationFrame(render);
}

function setupProd() {
  if (config.debugMode) {
    return;
  }
}

function setupDebug() {
  controls = new OrbitControls(camera, renderer.domElement);

  if (!config.debugMode) {
    return
  }
  new p5(debugSketch); // debugSketch

  if (!config.hideAxes) {
    const axis = new THREE.AxesHelper(1000);
    axis.setColors(0xff0000, 0x00ff00, 0x0000ff); // RGB
    scene.add(axis);
  }

  controls.addEventListener('end', (e) => {
    const formatVector = v => {
      v.x = parseFloat(v.x.toFixed(2));
      v.y = parseFloat(v.y.toFixed(2));
      v.z = parseFloat(v.z.toFixed(2));
      return v;
    }
    const cameraPos = formatVector(camera.position.clone());
    const cameraDir = formatVector(
    new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    );
    const posText = `Pos: (${cameraPos.x}, ${cameraPos.y}, ${cameraPos.z}) `;
    const dirText = `Dir: (${cameraDir.x}, ${cameraDir.y}, ${cameraDir.z})`;
    document.querySelector("#debugText").textContent = posText + dirText;
  });

  new p5(debugSketch); // debugSketch

  gui = new GUI();
  folder = gui.addFolder('Root Bone');

  folder.add(worldTreeRoot.rotation, 'x', - Math.PI, Math.PI);
  folder.add(worldTreeRoot.rotation, 'y', - Math.PI, Math.PI);
  folder.add(worldTreeRoot.rotation, 'z', - Math.PI, Math.PI);
  folder.controllers[0].name('rotation.x');
  folder.controllers[1].name('rotation.y');
  folder.controllers[2].name('rotation.z');
}

function setupLights() {
  sceneLights[0] = new THREE.DirectionalLight(0xffffff, 3);
  sceneLights[1] = new THREE.DirectionalLight(0xffffff, 3);
  sceneLights[2] = new THREE.DirectionalLight(0xffffff, 3);

  sceneLights[0].position.set(0, 750, 0);
  sceneLights[1].position.set(375, 750, 375);
  sceneLights[2].position.set(-375, -750, -375);

  scene.add(sceneLights[0]);
  scene.add(sceneLights[1]);
  scene.add(sceneLights[2]);
}

function setupEnviroment() {
  const room = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE);

  scene.background = new THREE.Color(0x000000);
  // scene.fog = new THREE.Fog( 0x888888, 10, 1500 );

  // const mat4 = new THREE.MeshPhongMaterial({ color: 0x555555, emissive: 0x072534, side: THREE.DoubleSide, flatShading: true });
  // const wall4 = new THREE.Mesh(geometry, mat4);
  // wall4.position.y = -ROOM_SIZE / 2;
  // wall4.rotation.x = Math.PI / 2;
  // sceneWalls.push(wall4);
  // room.add(wall4);

  scene.add(room);
}

function setupTree() {
  poseTree = new PoseTree(0, config.alignAllPosesUp);
  // if (poseTree.debugMode)
  worldTreeRoot = new THREE.Group();
  scene.add(worldTreeRoot)

  worldTreeRoot.add(poseTree.getRoot());

  // Simple
  recurseFill(poseTree, 2);

  if (config.debugMode && !config.hideAxes) {
    const skeletonHelper = new THREE.SkeletonHelper(poseTree.getRoot());
    scene.add(skeletonHelper);
  }

  if (config.hideMesh) {
    return;
  }
  PoseTree.getInstances().forEach(poseTree => {
    skinPoseTree(poseTree);
  });
}

function recurseFill(parentTree, level = 1, maxLevel = level) {
  if (level == 0) {
    return; // done
  }

  const ends = parentTree.getEnds();
  ends.forEach(end => {
    poseCount++;
    const shouldAlignChildren = config.poseType == 'HAND';
    // const pt = new PoseTree(poseCount % config.maxPoses, shouldAlignChildren);
    const pt = new PoseTree(0, shouldAlignChildren);

    pt.stepDownScales(parentTree);
    end.add(pt.getRoot());

    recurseFill(pt, level - 1, maxLevel);
  });

  // const limbs = parentTree.getLimbs();
  // limbs.forEach(bones => {
  //   poseCount++;
  //   const shouldAlignChildren = config.poseType == 'HAND';

  //   // random index not including the first.
  //   const randIndex = Math.floor(1 + Math.random() * (bones.length - 1));
  //   const bone = bones[randIndex];
  //   const pt = new PoseTree(poseCount % config.maxPoses, shouldAlignChildren);
  //   // const pt = new PoseTree(0, shouldAlignChildren);

  //   pt.stepDownScales(parentTree);
  //   bone.add(pt.getRoot());

  //   recurseFill(pt, level - 1, maxLevel);
  // });
}

function randomPoseId() {
  return Math.floor(Math.random() * config.maxPoses);
}

function skinPoseTree(poseTree) {
  const limbs = poseTree.getLimbs();
  limbs.forEach(bones => {
    const skeleton = new THREE.Skeleton(bones);
    const mesh = getMemoizedSkinnedMesh(poseTree.branchWidthScale);
    const rootBone = bones[0];
    const rootBoneParent = poseTree.getRoot().parent;
    mesh.add(rootBone);
    mesh.bind(skeleton);

    window.POSE_COUNT++;
    rootBoneParent.add(mesh);
  })
}

function createAngleBone() {
  const bone = createBone();
  bone.position.x = 50;
  const childBone = createBone();
  childBone.position.y = 10;
  bone.add(childBone);
  return bone;
}

function createBone() {
  const bone = new THREE.Bone();
  const axis = new THREE.AxesHelper(10);
  axis.setColors(0xff0000, 0x00ff00, 0x0000ff); // RGB
  bone.add(axis);
  return bone;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}
