const ProtocolClient = require("./client");
const { defer } = require("./utils");

let gClient;

async function initConnection(server, accessToken) {
  if (!gClient) {
    const { promise, resolve } = defer();
    gClient = new ProtocolClient(server, {
      async onOpen() {
        try {
          await gClient.setAccessToken(accessToken);
          resolve(true);
        } catch (err) {
          console.log(`Error authenticating with server: ${err}`);
          resolve(false);
        }
      },
      onClose() {
        console.log(`Server connection closed.`);
        resolve(false);
      },
      onError(e) {
        console.log(`Error connecting to server: ${e}`);
        resolve(false);
      },
    });
    return promise;
  }
  return true;
}

async function connectionCreateRecording(buildId) {
  const { recordingId } = await gClient.sendCommand(
    "Internal.createRecording",
    {
      buildId,
      // Ensure that if the upload fails, we will not create
      // partial recordings.
      requireFinish: true,
    }
  );
  return recordingId;
}

// Granularity for splitting up a recording into chunks for uploading.
const ChunkGranularity = 1024 * 1024;

async function connectionUploadRecording(recordingId, contents) {
  const promises = [];
  for (let i = 0; i < contents.length; i += ChunkGranularity) {
    const buf = contents.subarray(i, i + ChunkGranularity);
    promises.push(
      gClient.sendCommand(
        "Internal.addRecordingData",
        { recordingId, offset: i, length: buf.length },
        buf
      )
    );
  }
  // Explicitly mark the recording complete so the server knows that it has
  // been sent all of the recording data, and can save the recording.
  // This means if someone presses Ctrl+C, the server doesn't save a
  // partial recording.
  promises.push(gClient.sendCommand(
    "Internal.finishRecording",
    { recordingId }
  ))
  return Promise.all(promises);
}

module.exports = {
  initConnection,
  connectionCreateRecording,
  connectionUploadRecording,
};
