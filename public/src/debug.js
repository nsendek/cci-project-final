import { detectLandmarksForVideo } from './pose_handler.js';
import { EventBus, getPoseLimbs } from './util.js';

export const sketch = (p) => {
  let video;
  let poses = [];
  let averagePoses = [];

  let aspectRatio = 16 / 9;
  let relevantIndices = [];
  let videoHeight = 240;

  p.setup = () => {
    const canvas = p.createCanvas(videoHeight * aspectRatio, videoHeight);
    canvas.elt.addEventListener('click', () => {
      console.log(poses);
    });
    if (config.videoUrl) {
      useVideoFile();
    } else {
      useWebcam();
    }

    const limbs = getPoseLimbs();
    limbs.forEach(bones => {
      bones.forEach(poseIndex => {
        if (!limbs.includes(poseIndex)) {
          relevantIndices.push(poseIndex);
        }
      });
    });
  }

  function useWebcam() {
    video = p.createCapture(p.VIDEO);
    video.size(640, 480);
    video.hide();

    video.elt.addEventListener("loadeddata", startDetecting);
  }

  function useVideoFile() {
    video = p.createVideo(config.videoUrl, playVideo);
    video.elt.addEventListener("loadeddata", startDetecting);
  }

  function playVideo() {
    video.volume(0); // Can't autoplay unless video's muted?
    video.loop();
    video.hide();
  }

  function startDetecting() {
    detectLandmarksForVideo(video.elt);

    EventBus.getInstance().on('poses', (response) => {
      averagePoses = response;
    });

    EventBus.getInstance().on('exactPoses', (response) => {
      poses = response;
    });
  }

  p.draw = () => {
    p.clear();    
    p.image(video, 0, 0, p.width, p.height);
    p.filter(p.GRAY);

    averagePoses.forEach((pose, k) => {
      if (!pose) return;
      p.push();
      if (config.drawCenterPointInDebug) {
        setFillOrStroke(k);
        triangle(pose.center.x * p.width, pose.center.y * p.height, 10);
      }
      relevantIndices.forEach(i => {
        let point = pose.landmarks[i];
        if (!point) return;
        setFillOrStroke(k);
        p.circle(point.x * p.width, point.y * p.height, 5);
      })
      p.pop();
    });

    poses.forEach((pose, k) => {
      if (!pose || !pose.landmarks) {
        return;
      }
      p.push();
      if (pose.bbox && config.drawPoseBoundingBox) {
        p.stroke('white');
        p.noFill();
        const [min, max] = pose.bbox;
        const xDiff = max.x - min.x;
        const yDiff = max.y - min.y;
        p.rect(min.x * p.width, min.y * p.height, xDiff * p.width, yDiff * p.height)
      }
      setFillOrStroke(k, true);
      relevantIndices.forEach(i => {
        let point = pose.landmarks[i];
        if (!point) return;
        p.circle(point.x * p.width, point.y * p.height, 10);
      })
      p.pop();
    });
  }

  function triangle(x, y, side) {
    const theta = Math.PI / 3;
    const x1 = side * p.cos(0);
    const y1 = side * p.sin(0);
    const x2 = side * p.cos(2 * theta);
    const y2 = side * p.sin(2 * theta);
    const x3 = side * p.cos(4 * theta);
    const y3 = side * p.sin(4 * theta);

    p.push()
    p.translate(x, y);
    p.rotate(-Math.PI / 2);
    p.triangle(x1, y1, x2, y2, x3, y3);
    p.pop();
  }

  function setFillOrStroke(poseId, isStroke) {
    const colorFn = (...args) => {
      if (isStroke) {
        p.stroke(...args);
        p.noFill();
      } else {
        p.fill(...args);
        p.noStroke();
      }
    };
    switch (poseId) {
      case 0:
        colorFn(255, 0, 0);
        break;
      case 1:
        colorFn(0, 255, 0);
        break;
      case 2:
        colorFn(0, 0, 255);
        break;
      default:
    }
  }

  let paused = false;
  p.keyPressed = () => {
    if (p.keyCode == 32) {
      if (paused) video.play();
      else video.pause();
      paused = !paused;
    }
  }
}