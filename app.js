const express = require('express')
const app = express()
const socket = require("socket.io");
const path = require('path');
const fs = require('fs');

const port = 3000
const recordsPath = './records'

// Exporting the libraries I need in the frontend. I'm not using webpack so just gotta do this.
app.use('/libs/mediapipe', express.static(__dirname + '/node_modules/@mediapipe'));
app.use('/libs/p5', express.static(__dirname + '/node_modules/p5/lib/p5.min.js'));
app.use('/libs/three', express.static(__dirname + '/node_modules/three'));
app.use('/libs/socket.io', express.static(__dirname + '/node_modules/socket.io/client-dist'));

app.use(express.static('public'));

// Assets
app.use('/videos', express.static(__dirname + '/videos'));
app.use('/models', express.static(__dirname + '/models'));
app.use('/data', express.static(__dirname + '/data'));

const server = app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
})

const io = socket(server);

let runTimestamp = Date.now();
let batchCount = 1;
let batchPoseData = []

console.log('Starting record session: ', runTimestamp);

io.sockets.on('connection', (socket) => {
    console.log("new connection: " + socket.id);
    const dir = path.join(__dirname, `records/${runTimestamp}`);

    // Ensure the /records directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    socket.on('recordPoseData', (data) => {
        batchPoseData.push(data);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Roughly every 60 seconds.
        if (batchPoseData.length === 60) {
            const filename = `batch${batchCount}.json`;
            console.log('SAVING BATCH DATA', filename);
            const filepath = path.join(dir, filename);

            // Write JSON data to file
            fs.writeFile(filepath, JSON.stringify(batchPoseData), (err) => {
                if (err) {
                    console.error('Error saving file:', err);
                }
            });

            batchPoseData = [];
            batchCount++;
        }
    });
});