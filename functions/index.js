const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
// const express = require("express");

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// const { ExpressPeerServer } = require("peer");
// const app = express();
// // const server = require("http").Server(app);
// const peerServer = ExpressPeerServer(server, {
//   debug: true,
// });

// app.use("/", peerServer);
// const port = process.env.PORT || 9000;

// const app1 = express();

// const peerServer = PeerServer({ port, path: "/", proxied: true });
exports.create = functions.https.onRequest((request, response) => {
  functions.logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

// const api = functions.https.onRequest(app1);

// module.exports.api = api;
