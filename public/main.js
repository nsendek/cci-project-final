import { debugSketch , prodSketch} from "./src/p5.js"
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PoseTree, SmartBone, randomPoseId, WorldTree } from './src/tree.js'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import Stats from 'three/addons/libs/stats.module.js';

let camera, renderer, controls, gui, stats, socket;

const sceneLights = [];
const sceneWalls = [];

const SOCKET_URL = window.location.host;
const ROOM_SIZE = 2500;

/** @type {WorldTree} */
let worldTree;

let poseCount = 0;
window.POSE_COUNT = 0;

main();

function main() {
  if (!config.disableRecordPoseData) {
    console.log("RECORDING DATA")
  }
  if (config.debugMode) {
    window.THREE = THREE; // so i can test stuff out in console.
  }

  init();
  render();
}

function init() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer();

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  document.getElementById('main').appendChild(renderer.domElement);
  document.body.style.touchAction = 'none';

  window.addEventListener('resize', onWindowResize);

  setupCamera();
  setupEnviroment();
  setupLights();
  setupTree();
  setupDebug();
  setupP5();
  setupSocket();
}

function render() {

  if (controls) {
    controls.update();
  }

  worldTree.update();

  PoseTree.getInstances().forEach(instance => {
    instance.update();
  });

  // let count = 0;
  SmartBone.getInstances().forEach(instance => {
    // if (instance.update()) count++;
    instance.update();
  });

  renderer.render(scene, camera);

  if (stats) stats.update();

  // Do a little recursing.
  requestAnimationFrame(render);
}

function setupSocket() {
  socket = io.connect(SOCKET_URL);
  socket.on('connect', () => {
    window.socket = socket;
  });
}

function setupCamera() {
  camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 1, 10000);

  if (config.debugMode && !config.disableOrbitControls) {
    camera.position.z = ROOM_SIZE / 2;
    camera.updateProjectionMatrix();
  } else {
    const position = new THREE.Vector3().fromArray(config.cameraOrientation.position);
    const direction = new THREE.Vector3().fromArray(config.cameraOrientation.direction);

    camera.position.copy(position);
    camera.lookAt(position.clone().add(direction));
    camera.updateProjectionMatrix();
  }
}

function setupP5() {
  if (config.debugMode) {
    new p5(debugSketch)
  } else {
    new p5(prodSketch)
  }
}

function setupDebug() {
  if (!config.disableOrbitControls && config.debugMode) {
    controls = new OrbitControls(camera, renderer.domElement);
  }

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

  if (controls) {
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
  }

  gui = new GUI();

  worldTree.trees.forEach((tree, i) => {
    const folder = gui.addFolder(`Tree ${i}`);
    const treeRoot = tree.getRoot();

    folder.add(treeRoot.rotation, 'x', - Math.PI, Math.PI);
    folder.add(treeRoot.rotation, 'y', - Math.PI, Math.PI);
    folder.add(treeRoot.rotation, 'z', - Math.PI, Math.PI);
    folder.controllers[0].name('rotation.x');
    folder.controllers[1].name('rotation.y');
    folder.controllers[2].name('rotation.z');
  });

  if (worldTree) {
    worldTree.bones.forEach((bone, i) => {
      const folder = gui.addFolder(`World Tree Bone ${i}`);
      folder.add(bone.rotation, 'x', - Math.PI / 2, Math.PI / 2);
      folder.add(bone.rotation, 'y', - Math.PI / 2, Math.PI / 2);
      folder.add(bone.rotation, 'z', - Math.PI / 2, Math.PI / 2);
      folder.controllers[0].name('rotation.x');
      folder.controllers[1].name('rotation.y');
      folder.controllers[2].name('rotation.z');
    })
  }
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
  scene.background = new THREE.Color(0x000000);

  if (config.hideFloor) {
    return;
  }
  const room = new THREE.Group();
  const nCells = 50;
  var geometry = new THREE.PlaneGeometry(5 * ROOM_SIZE, 5 * ROOM_SIZE);
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
  floor.rotation.x = Math.PI / 2;
  sceneWalls.push(floor);
  room.add(floor);
  scene.add(room);
}

function setupTree() {
  worldTree = new WorldTree();
  window.worldTree = worldTree;
  scene.add(worldTree.bones[0]);
  scene.add(worldTree.mesh);
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

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}
