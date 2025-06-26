import { detectLandmarksForVideo } from './pose_handler.js';
import { EventBus, getPoseLimbs } from './util.js';

let video;
let poses = [];
let averagePoses = [];
let aspectRatio = 16 / 9;
let paused = false;

let globalP;

export const debugSketch = (p) => {
    let relevantIndices = [];
    let videoHeight = 360;
    globalP = p;

    p.setup = () => {
        window.noise = p.noise;
        const canvas = p.createCanvas(videoHeight * aspectRatio, videoHeight);
        canvas.elt.addEventListener('click', () => {
            console.log(poses);
        });
        if (config.videoUrl) {
            useVideoFile(p);
        } else {
            useWebcam(p);
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

    p.draw = () => {
        p.clear();
        p.image(video, 0, 0, p.width, p.height);

        averagePoses.forEach((pose, k) => {
            if (k >= config.maxPoses) return;
            if (!pose) return;
            p.push();
            if (config.drawCenterPointInDebug) {
                setFillOrStroke(p, k);
                triangle(pose.center.x * p.width, pose.center.y * p.height, config.p5DotSize);
            }
            relevantIndices.forEach(i => {
                let point = pose.landmarks[i];
                if (!point) return;
                setFillOrStroke(p, k);
                p.circle(point.x * p.width, point.y * p.height, config.p5DotSize / 2);
            })
            p.pop();
        });

        poses.forEach((pose, k) => {
            if (k >= config.maxPoses) return;
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
            setFillOrStroke(p, k, true);
            relevantIndices.forEach(i => {
                let point = pose.landmarks[i];
                if (!point) return;
                p.circle(point.x * p.width, point.y * p.height, config.p5DotSize);
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

    p.keyPressed = () => {
        if (p.keyCode == 32) {
            if (paused) video.play();
            else video.pause();
            paused = !paused;
        }
    }
}

export const prodSketch = (p) => {
    let relevantIndices = [];
    const MIRROR_BODY = true;
    let thirdWidth;
    let halfThirWidth;
    let limbs;
    globalP = p;

    p.setup = () => {
        window.noise = p.noise;
        p.createCanvas(p.windowWidth, p.windowWidth / aspectRatio);
        thirdWidth = p.width / 3;
        halfThirWidth = thirdWidth / 2;
        if (config.videoUrl) {
            useVideoFile(p);
        } else {
            useWebcam(p);
        }

        limbs = getPoseLimbs();
        limbs.forEach(bones => {
            bones.forEach(poseIndex => {
                if (!limbs.includes(poseIndex)) {
                    relevantIndices.push(poseIndex);
                }
            });
        });
    }

    p.draw = () => {
        p.clear();

        averagePoses.forEach((pose, k) => {
            if (!pose || k >= config.maxPoses) {
                return;
            }

            const centerX = (2 - k) * thirdWidth + halfThirWidth;
            const centerY = pose.center.y * p.height;

            p.push();
            p.translate(centerX, centerY);
            setFillOrStroke(p, k);

            if (limbs) {

                limbs.forEach(bones => {
                    for (let i = 0; i < bones.length - 1; i++) {
                        const indexA = bones[i];
                        const indexB = bones[i + 1];

                        const pointA = pose.landmarks[indexA];
                        const pointB = pose.landmarks[indexB];

                        if (!pointA || !pointB) {
                            continue;
                        }

                        const xA = MIRROR_BODY ? -1 * (pointA.x - pose.center.x) : pointA.x - pose.center.x;
                        const yA = pointA.y - pose.center.y;

                        const xB = MIRROR_BODY ? -1 * (pointB.x - pose.center.x) : pointB.x - pose.center.x;
                        const yB = pointB.y - pose.center.y;

                        p.push();
                        setFillOrStroke(p, k, true);
                        p.strokeWeight(2);
                        p.line(xA * p.width, yA * p.height, xB * p.width, yB * p.height);
                        p.pop();
                    }
                });
            }

            relevantIndices.forEach(i => {
                const point = pose.landmarks[i];
                if (!point) return;

                const x = MIRROR_BODY ? -1 * (point.x - pose.center.x) : point.x - pose.center.x;
                const y = point.y - pose.center.y;

                p.push();
                p.circle(x * p.width, y * p.height, config.p5DotSize / 2);
                p.pop();
            })
            p.pop();
        });

        poses.forEach((pose, k) => {
            if (!pose || !pose.landmarks || k >= config.maxPoses) {
                return;
            }

            const centerX = (2 - k) * thirdWidth + halfThirWidth;
            const centerY = pose.center.y * p.height;

            p.push();
            p.translate(centerX, centerY);
            setFillOrStroke(p, k, true);

            relevantIndices.forEach(i => {
                const point = pose.landmarks[i];
                if (!point) return;
                const x = MIRROR_BODY ? -1 * (point.x - pose.center.x) : point.x - pose.center.x;
                const y = point.y - pose.center.y;

                p.push();
                // strokeWeight(2);
                p.circle(x * p.width, y * p.height, config.p5DotSize);
                p.pop();
            });
            p.pop();
        });
    }

    p.keyPressed = () => {
        if (p.keyCode == 32) {
            if (paused) video.play();
            else video.pause();
            paused = !paused;
        }
    }
}

function useWebcam(p) {
    video = p.createCapture(p.VIDEO);
    video.size(480 * aspectRatio, 480);
    video.hide();

    video.elt.addEventListener("loadeddata", startDetecting);
}

function useVideoFile(p) {
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

function setFillOrStroke(p, poseId, isStroke) {
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

// Just in case
window.reconnectCamera = () => {
    useWebcam(globalP);
}