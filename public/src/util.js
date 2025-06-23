import * as THREE from 'three';
import * as constants from './constants.js';

export class EventBus {
  // Static property to track instances
  static instance;

  static getInstance() {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  constructor() {
    this.events = {};
  }

  on(event, handler) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(handler);
    return () => {
      this.events[event] = this.events[event].filter(h => h !== handler);
    }
  }

  emit(event, payload) {
    if (!this.events[event]) return;
    this.events[event].forEach(handler => handler(payload));
  }
}

/**
 * 
 * @param {THREE.Vector3} vector 
 * @returns {THREE.QuaternionLike}
 */
export function getQuaternionForAlignmentVector(vector) {
  const originalUp = new THREE.Vector3(0, 1, 0);
  const newUp = vector.clone().normalize();

  // Calculate the axis of rotation (cross product)
  const axis = new THREE.Vector3().crossVectors(originalUp, newUp).normalize();

  // Calculate the angle of rotation (dot product)
  const angle = originalUp.angleTo(newUp);

  // Create the quaternion representing the rotation
  return new THREE.Quaternion().setFromAxisAngle(axis, angle).invert();
}

export function getPoseLimbs() {
  return config.poseType === 'HAND' ? constants.HANDPOSE_LIMBS : constants.BODYPOSE_LIMBS;
}

export function getModifiers() {
  return config.poseType === 'HAND' ? constants.HANDPOSE_MODIFIERS : constants.BODYPOSE_MODIFIERS;
}