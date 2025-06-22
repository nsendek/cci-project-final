import { detectLandmarksForVideo } from './pose_handler.js';
import { EventBus , getPoseLimbs} from './util.js';

export const sketch = (p) => {
  let video;
  let poses = [];
  let averagePoses = [];
  let videoToCanvasScale = 0.75
  let relevantIndices = [];
  p.setup = () => {
    const canvas = p.createCanvas(640 * videoToCanvasScale, 480 * videoToCanvasScale);
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

    poses.forEach((pose, k) => {
      if (!pose || !pose.landmarks) {
        return;
      } 
      relevantIndices.forEach(i => {
        let point = pose.landmarks[i];
        if (point) {
          setFillOrStroke(k, true);
          p.noFill();
          p.circle(point.x * p.width, point.y * p.height, 10);
        }
      })
    })

    averagePoses.forEach((pose, k) => {
      if (!pose) return;
      relevantIndices.forEach(i => {
        let point = pose.landmarks[i];
        if (point) {
          setFillOrStroke(k);
          p.noStroke();
          p.circle(point.x * p.width, point.y * p.height, 5);
        }
      })
    })
  }

  function setFillOrStroke(poseId, isStroke) {
    const colorFn = (...args) => {
      isStroke ? p.stroke(...args) : p.fill(...args);
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