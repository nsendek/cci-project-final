import { PoseLandmarker, FilesetResolver, HandLandmarker } from 'mediapipe';
import { Vector3 } from 'three';
import { EventBus } from './util.js';

/**
* How MediaPipe defines keypoints in there poses, this is different from ThreeJS
* @typedef {Object} Pose
* @property {number|undefined} id (optional)
* @property {Vector3[]} landmarks - 2D coordinates to draw on a debug canvas (optional)
* @property {Vector3[]} worldLandmarks - 3D coordinates to use in 3D environemnts.
* @property {Vector3} alignmentVector - Average Alignment of all the 3D points from the pose root.
*/

const POSE_SIZE = config.poseType == 'HAND' ? 21 : 33;

let video;
let lastVideoTime = -1;
let landmarker;
let count = 0;
let currentNumPoses = 0;
let poses;
let averagePoses;
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
  requestAnimationFrame(detectionLoop);
}

function detectLandmarks(callback) {
  if (config.poseType == 'HAND') {
    callback(landmarker.detectForVideo(video, performance.now()))
  } else {
    landmarker.detectForVideo(video, performance.now(), callback);
  }
}

function processResults(results) {
  if (!results) {
    return;
  }
  const numPoses = results.landmarks.length;
  if (!numPoses) {
    return;
  }

  if (currentNumPoses > numPoses) {
    // console.log('poses num changed')
    // Drop the not used poses. How?
    currentNumPoses = numPoses;
  }

  const out = []
  for (let i = 0; i < numPoses; i++) {
    const [
      worldLandmarks,
      alignmentVector
    ] = convertWorldLandmarksAndAlignment(results.worldLandmarks[i]);

    /** @type {Pose} */
    const pose = {
      id: count,
      landmarks: results.landmarks[i].map(createVectorFromObject), // Not needed.
      worldLandmarks: worldLandmarks,
      alignmentVector,
    };
    out.push(pose);
    if (!poseBuffers[i]) {
      poseBuffers[i] = [];
    }
    const buffer = poseBuffers[i];
    buffer.push(pose);

    if (buffer.length > config.poseBufferSize) {
      buffer.shift();
    }
    count++;
  }
  poses = out;
  averagePoses = getAveragePoses();
  EventBus.getInstance().emit('poses', averagePoses);
}

function createVectorFromObject(point) {
  return new Vector3(point.x, point.y, point.z);
}

function convertWorldLandmarksAndAlignment(landmarks) {
  const rootVector = createVectorFromObject(landmarks[0]);
  const vectors = [rootVector]
  const alignmentVector = new Vector3(0, 0, 0);

  for (let i = 1; i < landmarks.length; i++) {
    const landmark = createVectorFromObject(landmarks[i]);
    vectors.push(landmark);
    alignmentVector.add(
      new Vector3().subVectors(landmark, rootVector)
    );
  }

  alignmentVector.normalize();
  return [vectors, alignmentVector];
}

/**
 * Get the the average pose of all sampled poses. MAX 3.
 * @returns {Pose[]}
 */
function getAveragePoses() {
  return poseBuffers.map(buffer => getAverageFromPoseBuffer(buffer));
}

/**
 * @param {Pose[]} buffer - Last three samples of the same Pose that will be averaged out to a single sample.
 * @returns {Pose}
 */
function getAverageFromPoseBuffer(buffer) {
  if (buffer.length !== config.poseBufferSize) {
    return undefined;
  }
  /** @type {Pose} */
  const out = {
    landmarks: [],
    worldLandmarks: [],
    alignmentVector: new Vector3(0, 0, 0)
  };
  const bufferSizeInv = 1.0 / config.poseBufferSize;

  for (let i = 0; i < config.poseBufferSize; i++) {
    const endOfBuffer = i === (config.poseBufferSize - 1);
    const pose = buffer[i];

    out.alignmentVector.add(pose.alignmentVector);
    if (endOfBuffer) {
      out.alignmentVector.multiplyScalar(bufferSizeInv);
    }

    for (let j = 0; j < POSE_SIZE; j++) {
      if (i == 0) { // First pose sample.
        out.landmarks[j] = new Vector3(0, 0, 0);
        out.worldLandmarks[j] = new Vector3(0, 0, 0);
      }
      const landmarks = out.landmarks[j];
      const worldLandmarks = out.worldLandmarks[j];
      landmarks.add(pose.landmarks[j]);
      worldLandmarks.add(pose.worldLandmarks[j]);

      if (endOfBuffer) {
        landmarks.multiplyScalar(bufferSizeInv);
        worldLandmarks.multiplyScalar(bufferSizeInv);
      }
    }
  }
  return out;
}

async function createLandmarker() {
  // "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  const vision = await FilesetResolver.forVisionTasks(
    // "/libs/mediapipe/tasks-vision/wasm"
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );
  switch (config.poseType) {
    case 'HAND':
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: 'VIDEO',
        numHands: 3
      });
      break;
    case 'BODY':
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
          delegate: "GPU"
        },
        runningMode: 'VIDEO',
        numPoses: 3,
        minPoseDetectionConfidence: 0.9,
        minPosePresenceConfidence: 0.9,
        minTrackingConfidence: 0.9
      });
      break;
    default:
      break;
  }
};