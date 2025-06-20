import { detectLandmarksForVideo } from './pose_handler.js';
import { EventBus } from './util.js';

export const sketch = (p) => {
  let video;
  let poses = [];
  let videoToCanvasScale = 0.75

  p.setup = () => {
    p.createCanvas(640 * videoToCanvasScale, 480 * videoToCanvasScale);
    if (config.videoUrl) {
      useVideoFile();
    } else {
      useWebcam();
    }
  }

  function useWebcam() {
    video = p.createCapture(p.VIDEO);
    video.size(640, 480);
    video.hide();

    startDetecting();
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
      poses = response;
    })
  }

  p.draw = () => {
    // Draw the webcam video
    p.background(0);

    p.image(video, 0, 0, p.width, p.height);

    // 2D landmarks
    poses.forEach((pose, k) => {
      for (let i = 0; i < pose.landmarks.length; i++) {
        let point = pose.landmarks[i];
        if (point) {
          setFill(k);
          // p.fill(255, 0, 0);
          p.noStroke();
          p.circle(point.x * p.width, point.y * p.height, 10);
        }
      }
    })

    // Averaged landmarks
    // averagePoses.forEach(pose => {
    //   if (!pose) return;
    //   for (let i = 0; i < pose.landmarks.length; i++) {
    //     let point = pose.landmarks[i];
    //     if (point) {
    //       p.fill(0, 0, 255);
    //       p.noStroke();
    //       p.circle(point.x * p.width, point.y * p.height, 10);
    //     }
    //   }
    // })
  }

  function setFill(poseId) {
    switch (poseId) {
      case 0:
        p.fill(255, 0, 0);
        break;
      case 1:
        p.fill(0, 255, 0);
        break;
      case 2:
        p.fill(0, 0, 255);
        break;
      default:
    }
  }

  p.mouseClicked = () => {
    console.log(poses);
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