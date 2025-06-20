const express = require('express')
const app = express()
const port = 3000

// Exporting the libraries I need in the frontend. I'm not using webpack so just gotta do this.
app.use('/libs/mediapipe', express.static(__dirname + '/node_modules/@mediapipe'));
app.use('/libs/p5', express.static(__dirname + '/node_modules/p5/lib/p5.min.js'));
app.use('/libs/three', express.static(__dirname + '/node_modules/three'));

app.use(express.static('public'));

app.use('/videos', express.static(__dirname + '/videos'));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})