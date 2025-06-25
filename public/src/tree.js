import * as THREE from 'three';
import {
  EventBus,
  getQuaternionForAlignmentVector,
  getPoseLimbs,
  getModifiers
} from "./util.js";
import { getAveragePose } from './pose_handler.js'

/**
 * Store skinned mesh for whatever scale we're working with so that we don't duplicate work.
 */
const SKINNED_MESH_MEMO = {};
window.SKINNED_MESH_MEMO = SKINNED_MESH_MEMO;

// const POSE_TREE_MATERIAL = new THREE.MeshPhongMaterial({
//   color: 0xed0786,
//   emissive: 0x000000,
//   emissiveIntensity: 0.05,
//   side: THREE.DoubleSide,
//   flatShading: config.flatShading,
// });

const POSE_TREE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xed0786,
  side: THREE.DoubleSide,
  flatShading: config.flatShading,
  skinning: true
});

const STARTING_SEGMENT_LENGTH = 1;


class Tree {
  getRoot() {
    throw new Error('getRoot() must be implemented by subclass');
  }

  align() {
    throw new Error('align() must be implemented by subclass');
  }

  update() {
    throw new Error('update() must be implemented by subclass');
  }
}

export class WorldTree extends Tree {
  startingTreeSegmentHeight = 100; // maybe 300?
  finalTreeSegmentHeight = 500;

  boneCount = config.poseType === 'HAND' ? 5 : 4;

  trees = [];

  constructor() {
    super();
    const bones = [new SmartBone()];
    for (let i = 1; i < this.boneCount; i++) {
      const bone = new SmartBone();
      bones[bones.length - 1].add(bone);
      bones.push(bone);
      bone.position.y = STARTING_SEGMENT_LENGTH;
    }

    const skeleton = new THREE.Skeleton(bones);
    const rootBone = bones[0];
    const mesh = getMemoizedSkinnedMesh(0.75 / config.branchWidthScale);
    mesh.add(rootBone);
    mesh.bind(skeleton);

    // After binding move bones into place
    for (let i = 1; i < this.boneCount; i++) {
      bones[i].position.y = 400;
    }

    this.bones = bones;
    this.mesh = mesh;

    // Detected poses are ordered left to right basically. 
    // Put center most pose at top of tree?
    this.trees[1] = new PoseTree(this.bones[3], 1, config.alignAllPosesUp);

    // put edge poses on left and right of tree
    this.trees[0] = new PoseTree(this.bones[2], 0, config.alignAllPosesUp);
    this.trees[2] = new PoseTree(this.bones[1], 2, config.alignAllPosesUp);

    this.alignTrees();

    EventBus.getInstance().on('poses', (poses) => {
      this.pose = getAveragePose(poses);
    });

    if (config.hideSkeleton) {
      return;
    }
    const helper = new THREE.SkeletonHelper(this.bones[0])
    scene.add(helper);
  }

  alignTrees() {
    const leftSideTree = this.trees[0]; // Angle it towards left.
    const rightSideTree = this.trees[2]; // Angle it towards right.

    alignPoseTreeToVector(leftSideTree, new THREE.Vector3(-1, 3, 1), new THREE.Vector3(0, 0, 1))
    alignPoseTreeToVector(rightSideTree, new THREE.Vector3(1, 3, 1), new THREE.Vector3(0, 0, -1))
  }

  update() {
    if (this.pose) this.align();

    // 0 < t < 1
    const t = Math.min(performance.now(), config.epoch) / config.epoch;
    if (t == 1) {
      return;
    }
    this.growTrunk(t);
  }

  /**
   * Updates the height of the tree so it grows.
   * @param {number} t 
   */
  growTrunk(t) {
    const segmentHeightDelta = (this.finalTreeSegmentHeight - this.startingTreeSegmentHeight) * t;
    for (let i = 1; i < this.boneCount; i++) {
      this.bones[i].position.y = this.startingTreeSegmentHeight + segmentHeightDelta;
    }
  }

  /**
   * @param {number} t 
   */
  align(t) {
    const leftLeg = getPoseLimbs()[3];
    const rightLeg = getPoseLimbs()[3];

    const prevX = new THREE.Vector3(1, 0, 0);
    // Since each bone is slerping its quat, we have to track 
    // the expected location of each bone as we go.
    const propogatingQuat = new THREE.Quaternion().identity();

    for (let i = 0; i < leftLeg.length - 1; i++) {
      const bone = this.bones[i];

      bone.updateMatrixWorld();

      const leftLegBoneWorldPosition = this.getWorldPosition(leftLeg[i]);
      const leftLegchildWorldPosition = this.getWorldPosition(leftLeg[i+1]);

      const rightLegBoneWorldPosition = this.getWorldPosition(rightLeg[i]);
      const rightLegchildWorldPosition = this.getWorldPosition(rightLeg[i+1]);

      const leftWorldOffset = new THREE.Vector3().subVectors(leftLegchildWorldPosition, leftLegBoneWorldPosition);
      const rightWorldOffset = new THREE.Vector3().subVectors(rightLegchildWorldPosition, rightLegBoneWorldPosition);

      const averageOffset = new THREE.Vector3().addVectors(leftWorldOffset, rightWorldOffset).multiplyScalar(0.5);
      const yAxis = averageOffset.clone().normalize(); // target up axis in world space.

      let xAxis = prevX.clone().projectOnPlane(yAxis).normalize();
      if (xAxis.lengthSq() < 1e-6) {
        prevX.add(new THREE.Vector3(0.1, 0.2, 0.3)).normalize();
        xAxis = prevX.clone().projectOnPlane(yAxis).normalize();
      }

      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

      // Building basis this way so that everything aligns and no twisting
      // orientation across bones
      const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const rotationQuat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

      if (i == 0) {
        const parentWorldQuat = new THREE.Quaternion();
        bone.parent.getWorldQuaternion(parentWorldQuat);
        propogatingQuat.multiply(parentWorldQuat);
        rotationQuat.premultiply(parentWorldQuat.invert());
        propogatingQuat.multiply(rotationQuat);
      } else {
        rotationQuat.premultiply(propogatingQuat.clone().invert());
        propogatingQuat.multiply(rotationQuat); // Stack onto combined quat.
      }

      bone.setTargetQuaternion(rotationQuat);

      prevX.copy(xAxis);
    }
  }

  getWorldPosition(boneId) {
    if (!this.pose) {
      return;
    }
    const worldPosition = this.pose.worldLandmarks[boneId].clone();
    worldPosition.applyQuaternion(
      getQuaternionForAlignmentVector(this.pose.alignmentVector)
    );
    return worldPosition;
  }
}

/**
 * Class that merges a ThreeJS Bone + Skeleton objects with ML5's pose detector
 * data and gravitates towards them.
 */
export class PoseTree extends Tree {
  // Static property to track instances
  static instances = [];

  static getInstances() {
    return PoseTree.instances;
  }

  root = new THREE.Group();
  limbs = [];
  targetPose = null;

  branchWidthScale = 1;
  branchLengthScale = 1;

  lastUpdateTime = -1;

  /**
   * @param {THREE.Object3D} [parent] 
   * @param {number} [poseId=0] 
   * @param {boolean} [shouldAlign=false] - If true then when setting the new targetPose,
   *  we will align the points along the local up axis (+Y).
   */
  constructor(parent, poseId = 0, shouldAlign = false) {
    super();
    this.poseId = poseId;
    this.shouldAlign = shouldAlign;

    getPoseLimbs().forEach(limb => {
      // Init limb chain with first bone.
      const chainRoot = new SmartBone(this, limb[0]);
      this.root.add(chainRoot);
      const boneChain = [chainRoot];

      for (let i = 1; i < limb.length; i++) {
        const childId = limb[i];

        const bone = new SmartBone(this, childId);
        bone.position.y = STARTING_SEGMENT_LENGTH;

        boneChain[i - 1].add(bone);
        boneChain.push(bone);
      }

      this.limbs.push(boneChain);
    });

    // Need to access this data often.
    EventBus.getInstance().on('poses', (poses) => {
      const pose = poses[this.poseId];
      if (!pose) {
        return;
      }
      this.setTarget(pose);
    });

    PoseTree.instances.push(this);

    // Add tree root to the parent, if the parent is a part of another poseTree,
    // scale down the scale of this tree, accordingly.
    parent.add(this.getRoot());

    if (parent.parentTree) {
      this.stepDownScales(parent.parentTree);
    }

    skinPoseTree(this);

    setTimeout(() => {
      if (window.POSE_COUNT > 300) {
        return;
      }
      // spawn another tree at the 3rd bone
      this.limbs.forEach(bones => {
        // spawnTreeAtBone(bones[1], 0);
        spawnTreeAtBone(bones[1], randomPoseId());
      })
    }, config.epoch / 3);
  }

  stepDownScales(poseTree) {
    this.branchWidthScale = poseTree.branchWidthScale * config.branchWidthScale;
    this.branchLengthScale = poseTree.branchLengthScale * config.branchLengthScale;
  }

  getValueScalar() {
    return (config.poseType == 'HAND') ? 2500 : 1000;
  }

  setTarget(targetPose) {
    this.targetPose = targetPose;
  }

  update() {
    if (!this.targetPose || this.lastUpdatedPose === this.targetPose) {
      return;
    }

    const currentTime = performance.now();
    // const delta = config.updateTimeDelta / Math.min(this.branchLengthScale, this.branchWidthScale);
    if ((currentTime - this.lastUpdateTime) > config.updateTimeDelta) {
      this.align();
      this.lastUpdateTime = currentTime;
    }
  }

  align() {
    this.getRoot().updateMatrixWorld(true);
    this.limbs.forEach((limb, ind) => {
      const prevX = new THREE.Vector3(1, 0, 0);

      // Since each bone is slerping its quat, we have to track 
      // the expected location of each bone as we go.
      const propogatingQuat = new THREE.Quaternion().identity();

      for (let i = 0; i < limb.length - 1; i++) {
        const bone = limb[i];
        const childBone = limb[i + 1];

        bone.updateMatrixWorld();

        const boneWorldPosition = this.getWorldPosition(bone.boneId);
        const childWorldPosition = this.getWorldPosition(childBone.boneId);
        const worldOffset = new THREE.Vector3().subVectors(childWorldPosition, boneWorldPosition);

        // I can use worldOffset because we know scale is never changed across bones.
        const magnitide = worldOffset.length();

        const yAxis = worldOffset.clone().normalize(); // target up axis in world space.

        let xAxis = prevX.clone().projectOnPlane(yAxis).normalize();
        if (xAxis.lengthSq() < 1e-6) {
          prevX.add(new THREE.Vector3(0.1, 0.2, 0.3)).normalize();
          xAxis = prevX.clone().projectOnPlane(yAxis).normalize();
        }

        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

        // Building basis this way so that everything aligns and no twisting
        // orientation across bones
        const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const rotationQuat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

        // I'm CRACKED at Computer Graphics.
        if (i == 0) {
          const parentWorldQuat = new THREE.Quaternion();
          bone.parent.getWorldQuaternion(parentWorldQuat);
          propogatingQuat.multiply(parentWorldQuat);
          rotationQuat.premultiply(parentWorldQuat.invert());
          propogatingQuat.multiply(rotationQuat);
        } else {
          rotationQuat.premultiply(propogatingQuat.clone().invert());
          propogatingQuat.multiply(rotationQuat); // Stack onto combined quat.
        }

        bone.setTargetQuaternion(rotationQuat);

        // Interpolate position so tree growth looks a bit smoother.
        childBone.setTargetPosition(
          new THREE.Vector3(0, magnitide * getModifiers()[ind] * this.branchLengthScale, 0)
        );
        prevX.copy(xAxis);
      }
    });
    this.lastUpdatedPose = this.targetPose;
  }

  getWorldPosition(boneId) {
    const worldPosition = this.targetPose.worldLandmarks[boneId].clone();
    if (this.shouldAlign) {
      worldPosition.applyQuaternion(
        getQuaternionForAlignmentVector(this.targetPose.alignmentVector)
      );
    }
    worldPosition.multiplyScalar(this.getValueScalar());
    worldPosition.applyMatrix4(this.getRoot().matrixWorld);

    return worldPosition;
  }

  getRoot() {
    return this.root;
  }

  getLimbs() {
    return this.limbs;
  }

  getEnds() {
    return this.limbs.map(bones => bones[bones.length - 1]);
  }
}

export function randomPoseId() {
  return Math.floor(Math.random() * config.maxPoses);
}

/**
 * A version of the bone class that constantly interpolates 
 * to a target postion and quaternion. Not every bone will be this
 * only bones used for pose tracking.
 */
export class SmartBone extends THREE.Bone {
  // Static property to track instances
  static instances = [];

  boneId = 0;

  static getInstances() {
    return SmartBone.instances;
  }

  /**
   * @param {Tree|undefined} tree 
   * @param {number|undefined} boneId 
   */
  constructor(tree, boneId) {
    super();
    this.parentTree /** @type {Tree} */ = tree;
    this.boneId = boneId;
    SmartBone.instances.push(this);

    if (config.debugMode && !config.hideAxes) {
      const axis = new THREE.AxesHelper(10);
      axis.setColors(0xff0000, 0x00ff00, 0x0000ff); // RGB
      this.add(axis);
    }
  }

  setTargetPosition(position) {
    this.targetPosition = position;
  }

  setTargetQuaternion(quaternion) {
    this.targetQuaternion = quaternion;
  }

  /**
   * Update bone closer towards its target position and rotation.
   */
  update() {
    let updateDone = false;
    if (this.targetPosition) {
      this.position.lerp(this.targetPosition, config.lerpFactor);
    }
    if (this.targetQuaternion) {
      this.quaternion.slerp(this.targetQuaternion, config.lerpFactor);
    }
    return updateDone;
  }
}

/**
 * 
 * @param {SmartBone} bone
 * @param {number} poseId
 */
export function spawnTreeAtBone(bone, poseId) {
  const newPt = new PoseTree(bone, poseId, true);
  // const parent = bone.parent;
  // if (parent instanceof SmartBone) {
  //   const parentTree = bone.parentTree;
  //   const parentWorldPos = parentTree.getWorldPosition(parent.boneId);
  //   const boneWorldPose = parentTree.getWorldPosition(bone.boneId);

  //   const magnitide = new THREE.Vector3().subVectors(boneWorldPose, parentWorldPos).length();

  //   parent.add(newPt.getRoot());
  //   newPt.getRoot().position.copy(new THREE.Vector3(0, magnitide * parentTree.branchLengthScale, 0))
  // }
}

function skinPoseTree(poseTree) {
  if (config.debugMode && !config.hideAxes) {
    const skeletonHelper = new THREE.SkeletonHelper(poseTree.getRoot());
    scene.add(skeletonHelper);
  }
  if (config.hideMesh) {
    return;
  }
  const limbs = poseTree.getLimbs();
  limbs.forEach(bones => {
    const skeleton = new THREE.Skeleton(bones);
    const mesh = getMemoizedSkinnedMesh(poseTree.branchWidthScale);
    const rootBone = bones[0];
    mesh.add(rootBone);
    mesh.bind(skeleton);

    window.POSE_COUNT++;
    poseTree.getRoot().add(mesh);
  });
}

/**
 * 
 * @param {number} scale 
 */
export function getMemoizedSkinnedMesh(scale) {
  if (SKINNED_MESH_MEMO[scale]) {
    return SKINNED_MESH_MEMO[scale].clone();
  }
  const segmentLength = STARTING_SEGMENT_LENGTH;
  // I GET TO ASSUME BONE COUNT CAUSE ALL MY LIMBS HAVE THE SAME # BONES.
  const boneCount = (config.poseType == 'HAND' ? 5 : 4);
  const startSize = config.startingTrunkSize;
  const totalLength = segmentLength * (boneCount);
  const heightSegments = 50; // More segments = smoother skinning

  const geometry = new THREE.CylinderGeometry(
    startSize * scale * config.branchWidthScale,
    startSize * scale,
    totalLength,
    16,
    heightSegments,
    false
  );
  // Shift geometry so base is at y=0 (like the root bone)
  geometry.translate(0, totalLength / 2, 0);

  // Assign skinning attributes <- Thanks ChatGPT
  const position = geometry.attributes.position;
  const skinIndices = [];
  const skinWeights = [];

  const vertex = new THREE.Vector3();
  const boneLength = totalLength / (boneCount - 1);

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const y = vertex.y;

    // Determine bone indices and blend amount
    const t = (y % boneLength) / boneLength; // 0 to 1

    const boneIndex = Math.floor(y / boneLength);
    const nextBoneIndex = Math.min(boneIndex + 1, boneCount - 1);
    const prevBoneIndex = Math.max(boneIndex - 1, 0);

    const wPrev = (1 - t) / 3;
    const wCurr = 1 - Math.abs(t - 0.5); // peak at center
    const wNext = t / 3;

    if (boneIndex === 0) {
      const total = wCurr + wNext;
      skinIndices.push(boneIndex, nextBoneIndex, 0, 0);
      skinWeights.push(wCurr / total, wNext / total, 0, 0);
    } else if (boneIndex === (boneCount - 1)) {
      skinIndices.push(prevBoneIndex, boneIndex, 0, 0);
      skinWeights.push(t, 1 - t, 0, 0);
    } else {
      const total = wPrev + wCurr + wNext;
      skinIndices.push(prevBoneIndex, boneIndex, nextBoneIndex, 0);
      skinWeights.push(wPrev / total, wCurr / total, wNext / total, 0);
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const mesh = new THREE.SkinnedMesh(geometry, POSE_TREE_MATERIAL);
  SKINNED_MESH_MEMO[scale] = mesh;

  return mesh.clone();
}

/**
 * 
 * @param {Tree} tree 
 * @param {THREE.Vector3} vector 
 */
function alignPoseTreeToVector(tree, localY, localX) {
  const treeRoot = tree.getRoot()
  const yAxis = localY.clone().normalize();
  const xAxis = localX.projectOnPlane(yAxis).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const rotationQuat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

  const parentWorldQuat = new THREE.Quaternion();
  treeRoot.parent.getWorldQuaternion(parentWorldQuat);
  rotationQuat.premultiply(parentWorldQuat.invert());

  treeRoot.quaternion.copy(rotationQuat);
}
