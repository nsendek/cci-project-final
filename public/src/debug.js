import { detectLandmarksForVideo } from './pose_handler.js';
import { EventBus } from './util.js';

export const sketch = (p) => {
  let video;
  let poses = [];
  let videoToCanvasScale = 0.75

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
      if (!pose || !pose.landmarks) {
        return;
      } 
      for (let i = 0; i < pose.landmarks.length; i++) {
        let point = pose.landmarks[i];
        if (point) {
          setFill(k);
          p.noStroke();
          p.circle(point.x * p.width, point.y * p.height, 5);
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

  let paused = false;
  p.keyPressed = () => {
    if (p.keyCode == 32) {
      if (paused) video.play();
      else video.pause();
      paused = !paused;
    }
  }
}