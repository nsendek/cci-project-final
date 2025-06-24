import { sketch as debugSketch } from "./src/debug.js"
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PoseTree, SmartBone, randomPoseId } from './src/tree.js'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import Stats from 'three/addons/libs/stats.module.js';

let camera, renderer, controls, poseTree, worldTreeRoot, gui, folder, stats;

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

  if (stats) stats.update();

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

  if (!config.hideAxes) {
    const axis = new THREE.AxesHelper(1000);
    axis.setColors(0xff0000, 0x00ff00, 0x0000ff); // RGB
    scene.add(axis);
  }

  stats = new Stats();
  document.querySelector("#stats").append(stats.dom);

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
    const posText = `Pos:(${cameraPos.x}, ${cameraPos.y}, ${cameraPos.z}) `;
    const dirText = `Dir:(${cameraDir.x}, ${cameraDir.y}, ${cameraDir.z})`;
    console.log('Camera - ', posText + dirText)
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
  sceneLights[0] = new THREE.DirectionalLight(0xffffff, 2);
  sceneLights[1] = new THREE.DirectionalLight(0x6258a3, 3);

  scene.add(new THREE.AmbientLight(0x3B3561, 3));

  const addHelper = (light) => {
    const helper = new THREE.DirectionalLightHelper(light, 50);
    scene.add(helper);
  }

  sceneLights[0].position.set(750, 750, 0);
  sceneLights[1].position.set(0, 750, 750);

  scene.add(sceneLights[0]);
  scene.add(sceneLights[1]);

  if (config.debugMode) {
    addHelper(sceneLights[0]);
    addHelper(sceneLights[1]);
  }
}

function setupEnviroment() {
  const room = new THREE.Group();
  scene.background = new THREE.Color(0x000000);

  const nCells = 50;
	var geometry = new THREE.PlaneGeometry(5*ROOM_SIZE, 5*ROOM_SIZE);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      void main() {
        float Size = ${nCells.toFixed(2)};
        vec2 Pos = floor(vUv.xy * Size);
        float PatternMask = mod(Pos.x + mod(Pos.y, 2.0), 2.0);
        gl_FragColor = PatternMask * vec4(0.75, 0.75, 0.75, 1.0);
      }
    `,
  });

  const floor = new THREE.Mesh(geometry, material);
  floor.position.y = -ROOM_SIZE / 10;
  floor.rotation.x = Math.PI / 2;
  sceneWalls.push(floor);
  room.add(floor);

  if (!config.hideFloor) scene.add(room);
}

function setupTree() {
  worldTreeRoot = new THREE.Group();
  scene.add(worldTreeRoot);

  poseTree = new PoseTree(worldTreeRoot, 0, config.alignAllPosesUp);

  // Simple
  // recurseFill(poseTree, 2);
}

function recurseFill(parentTree, level = 1, maxLevel = level) {
  if (level == 0) {
    return; // done
  }

  const ends = parentTree.getEnds();
  ends.forEach(end => {
    poseCount++;
    const shouldAlignChildren = config.poseType == 'HAND';
    // const pt = new PoseTree(end, poseCount % config.maxPoses, shouldAlignChildren);
    const pt = new PoseTree(end, randomPoseId(), shouldAlignChildren);

    recurseFill(pt, level - 1, maxLevel);
  });

  //   const limbs = parentTree.getLimbs();
  //   limbs.forEach(bones => {
  //     poseCount++;
  //     const shouldAlignChildren = config.poseType == 'HAND';

  //     // random index not including the first.
  //     const randIndex = Math.floor(1 + Math.random() * (bones.length - 1));
  //     const bone = bones[randIndex];
  //     const poseId = poseCount % config.maxPoses;
  //     console.log('poseId',poseId);
  //     const pt = new PoseTree(poseId, shouldAlignChildren);
  //     // const pt = new PoseTree(0, shouldAlignChildren);

  //     pt.stepDownScales(parentTree);
  //     bone.add(pt.getRoot());

  //     recurseFill(pt, level - 1, maxLevel);
  //   });

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
