import { PoseLandmarker, FilesetResolver, HandLandmarker } from 'mediapipe';
import { Vector3, Vector2 } from 'three';
import { EventBus } from './util.js';

/**
* This is how I'm processing and sending Pose data from the Mediapipe to World Tree. 
* Eventbus emits a 'pose' event that contains up to 3 poses objects containing:
* @typedef {Object} Pose
* @property {number|undefined} id (optional)
* @property {Vector3[]} landmarks - 2D coordinates to draw on a debug canvas
* @property {Vector3[]} worldLandmarks - 3D coordinates to use in 3D environemnts.
* @property {Vector3} alignmentVector - Average Alignment of all the 3D points from the pose root.
* @property {Vector2} center - Center point of the pose in 2D landmark space (optional).
* @property {Vector2[]} bbox - 2D Array of the bounding box of the pose in 2D landmark space.
*/

const POSE_SIZE = config.poseType == 'HAND' ? 21 : 33;

let video;
let lastUpdateTime = -1;
let lastVideoTime = -1;
let landmarker;
let count = 0;


/** @type {Pose[]} */
let sumPoses = [];

/** @type {Pose[][]} */
let poseBuffers = [];

export async function detectLandmarksForVideo(inputVideoEl) {
  video = inputVideoEl;

  if (!landmarker) {
    await createLandmarker();
  }

  await emitDefaultData();

  // Start detection loop.
  detectionLoop();
}

async function getPoseData(path) {
  const response = await fetch(path);
  const data = await response.json();
  return data;
}

async function emitDefaultData() {
  if (config.poseType != 'BODY') {
    return;
  }
  const p1 = getBlankPose(await getPoseData('/data/pose1.json'));
  const p2 = getBlankPose(await getPoseData('/data/pose2.json'));
  const p3 = getBlankPose(await getPoseData('/data/pose3.json'));

  poseBuffers = [[p1], [p2], [p3]];
  addPose(getSumPose(0), p1);
  addPose(getSumPose(1), p2);
  addPose(getSumPose(2), p3);

  EventBus.getInstance().emit('poses', getAveragePoses());
}

function detectionLoop() {
  if (!landmarker) {
    return;
  }
  const currentTime = performance.now();
  if ((currentTime - lastUpdateTime) >= config.updateTimeDelta) {
    lastUpdateTime = currentTime;
    // Also check video time as so updates stop when paused or buffering.
    if (video.currentTime !== lastVideoTime) {
      detectLandmarks(processResults);
      lastVideoTime = video.currentTime;
    }
  }
  // Do a little recursing.
  requestAnimationFrame(detectionLoop);
}

function detectLandmarks(callback) {
  if (config.noDetection) {
    return;
  }
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
  if (!numPoses) {
    return;
  }

  let filteredPoses = []
  for (let i = 0; i < numPoses; i++) {
    const [
      worldLandmarks,
      alignmentVector
    ] = formatWorldLandmarks(results.worldLandmarks[i]);

    const [
      landmarks,
      center,
      bbox
    ] = formatLandmarks(results.landmarks[i]);

    /** @type {Pose} */
    const pose = {
      id: count,
      landmarks,
      worldLandmarks,
      alignmentVector,
      center,
      bbox
    };

    if (!isProminentPose(pose)) {
      continue;
    }

    if (!isDistinctPose(filteredPoses, pose)) {
      continue;
    }

    filteredPoses.push(pose);
    count++;
  }

  /// TODO either match index with 
  const currentPoses = [];

  // after filtering for distinct and prominent poses
  // we match them to best match 
  filteredPoses.forEach(pose => {
    const index = Math.floor(pose.center.x * 10 / 3);
    currentPoses[index] = pose;

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
  });

  EventBus.getInstance().emit('exactPoses', currentPoses);
  EventBus.getInstance().emit('poses', getAveragePoses());
}

/**
 * Returns false if the current pose's center X value is too close
 * to other accepted poses. Threshold is 0.25 of image width.
 * @param {Pose[]} previousPoses 
 * @param {Pose} pose 
 * @returns {boolean}
 */
function isDistinctPose(previousPoses, pose) {
  if (!previousPoses.length) {
    return true;
  }
  let isDistinct = true;
  previousPoses.forEach(currentPose => {
    if (!currentPose) return;
    const xDiff = Math.abs(currentPose.center.x - pose.center.x);
    if (xDiff <= config.distinctPoseThreshold) {
      isDistinct = false;
    }
  })
  return isDistinct;
}

/**
 * Returns true is pose bbox is large enough, relative 
 * to the image frame, to warrant using.
 * @param {Pose} pose 
 */
function isProminentPose(pose) {
  const yRange = pose.bbox[1].y - pose.bbox[0].y;
  return yRange > config.prominentPoseThreshold;
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
 * @param {{x:number; y:number; z:number;} | undefined}  point 
 * @returns {Vector3}
 */
function createVector3FromObject(point) {
  return new Vector3(point.x, point.y, point.z);
}

/**
 * @param {{x:number; y:number;} | undefined}  point 
 * @returns {Vector2}
 */
function createVector2FromObject(point) {
  if (!point) {
    new Vector2(0, 0);
  }
  return new Vector2(point.x, point.y);
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

  const rootVector = createVector3FromObject(worldLandmarks[0]);
  formatWorldLandmark(rootVector);

  const vectors = [rootVector]
  const alignmentVector = new Vector3(0, 0, 0);

  for (let i = 1; i < worldLandmarks.length; i++) {
    const worldLandmark = createVector3FromObject(worldLandmarks[i]);
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
 * @returns {[Vector3[], Vector3, Vector2[]]}
 */
function formatLandmarks(landmarks) {
  const vectors = []
  const centerPoint = new Vector2(0, 0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < landmarks.length; i++) {
    const landmark = createVector3FromObject(landmarks[i]);
    vectors.push(landmark);
    centerPoint.add(landmark);

    if (landmark.x < minX) {
      minX = landmark.x;
    } else if (landmark.x > maxX) {
      maxX = landmark.x;
    }
    if (landmark.y < minY) {
      minY = landmark.y;
    } else if (landmark.y > maxY) {
      maxY = landmark.y;
    }
  }

  centerPoint.multiplyScalar(1.0 / landmarks.length);
  return [
    vectors,
    centerPoint,
    [new Vector2(minX, minY), new Vector2(maxX, maxY)]
  ];
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
 * @param {Object | undefined} data
 * @returns {Pose}
 */
function getBlankPose(data) {
  const landmarks = [];
  const worldLandmarks = [];

  for (let j = 0; j < POSE_SIZE; j++) {
    const landmark = data
      ? createVector3FromObject(data.landmarks[j])
      : new Vector3(0, 0, 0);

    const worldLandmark = data
      ? createVector3FromObject(data.worldLandmarks[j])
      : new Vector3(0, 0, 0);

    landmarks.push(landmark);
    worldLandmarks.push(worldLandmark);
  }

  return {
    landmarks,
    worldLandmarks,
    alignmentVector: data
      ? createVector3FromObject(data.alignmentVector)
      : new Vector3(0, 0, 0),
    center: data
      ? createVector2FromObject(data.center)
      : new Vector2(0, 0)
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