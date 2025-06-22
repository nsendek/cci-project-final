import { PoseLandmarker, FilesetResolver, HandLandmarker } from 'mediapipe';
import { Vector3 } from 'three';
import { EventBus } from './util.js';

/**
* This is how I'm processing and sending Pose data from the Mediapipe to World Tree. 
* Eventbus emits a 'pose' event that contains up to 3 poses objects containing:
* @typedef {Object} Pose
* @property {number|undefined} id (optional)
* @property {Vector3[]} landmarks - 2D coordinates to draw on a debug canvas
* @property {Vector3[]} worldLandmarks - 3D coordinates to use in 3D environemnts.
* @property {Vector3} alignmentVector - Average Alignment of all the 3D points from the pose root.
* @property {Vector3} center - Center point of the pose in 2D landmark space (optional).
*/

const POSE_SIZE = config.poseType == 'HAND' ? 21 : 33;

let video;
let lastVideoTime = -1;
let landmarker;
let count = 0;

/** @type {Pose[]} */
let currentPoses = [];

/** @type {Pose[]} */
let sumPoses = [];

/** @type {Pose[][]} */
let poseBuffers = [];

export async function detectLandmarksForVideo(inputVideoEl) {
  video = inputVideoEl;

  if (!landmarker) {
    await createLandmarker();
  }

  // Start detection loop.
  detectionLoop();
}

function detectionLoop() {
  if (!landmarker) {
    return;
  }
  if (video.currentTime !== lastVideoTime) {
    detectLandmarks(processResults);
    lastVideoTime = video.currentTime;
  }
  // Do a little recursing.
  requestAnimationFrame(detectionLoop);
}

function detectLandmarks(callback) {
  if (config.poseType == 'HAND') {
    callback(landmarker.detectForVideo(video, performance.now()))
  } else {
    landmarker.detectForVideo(video, performance.now(), callback);
  }
}

/**
 * Convert Mediapipe results to 
 * @param {Object} results 
 * @returns 
 */
function processResults(results) {
  if (!results || !results.landmarks) {
    return;
  }
  const numPoses = results.landmarks.length;

  currentPoses = [];
  for (let i = 0; i < numPoses; i++) {
    const [
      worldLandmarks,
      alignmentVector
    ] = formatWorldLandmarks(results.worldLandmarks[i]);

    const [
      landmarks,
      center
    ] = formatLandmarks(results.landmarks[i]);

    /** @type {Pose} */
    const pose = {
      id: count,
      landmarks,
      worldLandmarks,
      alignmentVector,
      center
    };

    if (!isDistinctPose(currentPoses, pose)) {
      continue;
    }

    currentPoses.push(pose);

    const index = currentPoses.length - 1;
    const buffer = getPoseBuffer(index);
    buffer.push(pose);

    let substractedPose;

    if (buffer.length > config.poseBufferSize) {
      substractedPose = buffer.shift();
    }
    const sumPose = getSumPose(index);

    addPose(sumPose, pose);
    if (substractedPose) {
      subtractPose(sumPose, substractedPose);
    }

    count++;
  }

  EventBus.getInstance().emit('exactPoses', currentPoses);
  EventBus.getInstance().emit('poses', getAveragePoses());
}

/**
 * Returns false if the current pose's center X value is too close
 * to other accepted poses. Threshold is 0.25 of image width.
 * @param {Pose[]} currentPoses 
 * @param {Pose} pose 
 * @returns {boolean}
 */
function isDistinctPose(currentPoses, pose) {
  if (!currentPoses.length) {
    return true;
  }
  for (let i = 0; i < currentPoses.length; i++) {
    const otherPose = currentPoses[i];
    const xDiff = Math.abs(otherPose.center.x - pose.center.x);
    if (xDiff <= config.distinctPoseThreshold) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the Buffer for a given index and initializes
 * it if not present.
 * 
 * @param {number} index 
 * @returns {Pose[]}
 */
function getPoseBuffer(index) {
  if (!poseBuffers[index]) {
    poseBuffers[index] = [];
  }
  return poseBuffers[index];
}

/**
 * Returns the Sum Pose for a given index and initializes
 * it if not present.
 * 
 * @param {number} index 
 * @returns {Pose}
 */
function getSumPose(index) {
  if (!sumPoses[index]) {
    sumPoses[index] = getBlankPose();
  }
  return sumPoses[index];
}

/**
 * Add all vectors in poseB to poseA (in place).
 * @param {Pose} poseA
 * @param {Pose} poseB
 */
function addPose(poseA, poseB) {
  poseA.alignmentVector.add(poseB.alignmentVector);
  poseA.center.add(poseB.center);

  for (let i = 0; i < POSE_SIZE; i++) {
    const landmarks = poseA.landmarks[i];
    const worldLandmarks = poseA.worldLandmarks[i];

    landmarks.add(poseB.landmarks[i]);
    worldLandmarks.add(poseB.worldLandmarks[i]);
  }
}

/**
 * Subtrct all vectors in poseB from poseA (in place).
 * @param {Pose} poseA
 * @param {Pose} poseB
 */
function subtractPose(poseA, poseB) {
  poseA.alignmentVector.sub(poseB.alignmentVector);
  poseA.center.sub(poseB.center);

  for (let i = 0; i < POSE_SIZE; i++) {
    const landmarks = poseA.landmarks[i];
    const worldLandmarks = poseA.worldLandmarks[i];

    landmarks.sub(poseB.landmarks[i]);
    worldLandmarks.sub(poseB.worldLandmarks[i]);
  }
}

/**
 * @param {{x:number; y:number; z:number;}}  point 
 * @returns {Vector3}
 */
function createVectorFromObject(point) {
  return new Vector3(point.x, point.y, point.z);
}

/**
 * Formats the world landmarks so they are in positive space with +Y as up axis.
 * Also calculates and returns the alignment vector based on landmarks.
 * 
 * @param {{x:number; y:number; z:number;}[]} worldLandmarks 
 * @returns {[Vector3[], Vector3]}
 */
function formatWorldLandmarks(worldLandmarks) {
  // This function preformats the world coords such that
  // its easier to work with in my scene.
  // Minor change we make to the world coordinates to the 
  // hand and body face the 'right' way
  const formatWorldLandmark = vec => {
    if (config.poseType === 'BODY') {
      vec.multiply(new THREE.Vector3(-1, 1, -1));
    } else {
      vec.multiplyScalar(-1);
    }
  }

  const rootVector = createVectorFromObject(worldLandmarks[0]);
  formatWorldLandmark(rootVector);

  const vectors = [rootVector]
  const alignmentVector = new Vector3(0, 0, 0);

  for (let i = 1; i < worldLandmarks.length; i++) {
    const worldLandmark = createVectorFromObject(worldLandmarks[i]);
    formatWorldLandmark(worldLandmark);
    vectors.push(worldLandmark);

    // We align the body using its hip points 23 -> 24, 
    // since the other points have very high variability.
    if (config.poseType == 'HAND' || (i >= 23 && i <= 24)) {
      alignmentVector.add(
        new Vector3().subVectors(worldLandmark, rootVector)
      );
    }
  }

  alignmentVector.normalize();
  return [vectors, alignmentVector];
}

/**
 * Formats the world landmarks so they are in positive space with +Y as up axis.
 * Also calculates and returns the center point in 'landmark' space.
 * 
 * @param {{x:number; y:number; z:number;}[]} landmarks 
 * @returns {[Vector3[], Vector3]}
 */
function formatLandmarks(landmarks) {
  const vectors = []
  const centerPoint = new Vector3(0, 0, 0);

  for (let i = 0; i < landmarks.length; i++) {
    const landmark = createVectorFromObject(landmarks[i]);
    vectors.push(landmark);

    centerPoint.add(landmark);
  }

  centerPoint.multiplyScalar(1.0 / landmarks.length);
  return [vectors, centerPoint];
}

/**
 * Get the the average pose of all sampled poses. MAX 3.
 * @returns {Pose[]}
 */
function getAveragePoses() {
  return sumPoses.map((sumPose, i) => {
    const bufferSizeInv = 1.0 / getPoseBuffer(i).length;
    const out = getBlankPose();

    out.alignmentVector.add(sumPose.alignmentVector).multiplyScalar(bufferSizeInv);
    out.center.add(sumPose.center).multiplyScalar(bufferSizeInv);

    for (let i = 0; i < POSE_SIZE; i++) {
      const landmark = out.landmarks[i];
      const worldLandmark = out.worldLandmarks[i];
      landmark.add(sumPose.landmarks[i]).multiplyScalar(bufferSizeInv);
      worldLandmark.add(sumPose.worldLandmarks[i]).multiplyScalar(bufferSizeInv);
    }
    return out;
  });
}

/**
 * @returns {Pose}
 */
function getBlankPose() {
  const landmarks = [];
  const worldLandmarks = [];

  for (let j = 0; j < POSE_SIZE; j++) {
    landmarks.push(new Vector3(0, 0, 0));
    worldLandmarks.push(new Vector3(0, 0, 0));
  }

  return {
    landmarks,
    worldLandmarks,
    alignmentVector: new Vector3(0, 0, 0),
    center: new Vector3(0, 0, 0)
  };
}

/**
 * Refer to https://ai.google.dev/edge/mediapipe/solutions/guide
 */
async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "/libs/mediapipe/tasks-vision/wasm"
    // "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );
  switch (config.poseType) {
    case 'HAND':
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          // modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          modelAssetPath: `/models/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: 'VIDEO',
        numHands: config.maxPoses
      });
      break;
    case 'BODY':
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          // modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
          modelAssetPath: `/models/pose_landmarker_full.task`,
          delegate: "GPU"
        },
        runningMode: 'VIDEO',
        numPoses: config.maxPoses,
        minPoseDetectionConfidence: 0.9,
        minPosePresenceConfidence: 0.9,
        minTrackingConfidence: 0.9
      });
      break;
    default:
      break;
  }
};