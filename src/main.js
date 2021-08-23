const fs = require("fs");
const path = require("path");
const { initConnection, connectionCreateRecording, connectionUploadRecording, closeConnection } = require("./upload");
const { spawn } = require("child_process");

function getDirectory(opts) {
  const home = process.env.HOME || process.env.USERPROFILE;
  return opts.directory || process.env.RECORD_REPLAY_DIRECTORY || path.join(home, ".replay");
}

function getRecordingsFile(dir) {
  return path.join(dir, "recordings.log");
}

function readRecordingFile(dir) {
  const file = getRecordingsFile(dir);
  if (!fs.existsSync(file)) {
    return [];
  }

  return fs.readFileSync(file, "utf8").split("\n");
}

function writeRecordingFile(dir, lines) {
  fs.writeFileSync(getRecordingsFile(dir), lines.join("\n"));
}

function getBuildRuntime(buildId) {
  const match = /.*?-(.*?)-/.exec(buildId);
  return match ? match[1] : "unknown";
}

function readRecordings(dir, includeHidden) {
  const recordings = [];
  const lines = readRecordingFile(dir);
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      // Ignore lines that aren't valid JSON.
      continue;
    }

    switch (obj.kind) {
      case "createRecording": {
        const { id, timestamp, buildId } = obj;
        recordings.push({
          id,
          createTime: (new Date(timestamp)).toString(),
          buildId,
          runtime: getBuildRuntime(buildId),
          metadata: {},

          // We use an unknown status after the createRecording event because
          // there should always be later events describing what happened to the
          // recording.
          status: "unknown",
        });
        break;
      }
      case "addMetadata": {
        const { id, metadata } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          Object.assign(recording.metadata, metadata);
        }
        break;
      }
      case "writeStarted": {
        const { id, path } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "startedWrite";
          recording.path = path;
        }
        break;
      }
      case "writeFinished": {
        const { id } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "onDisk";
        }
        break;
      }
      case "uploadStarted": {
        const { id, server, recordingId } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "startedUpload";
          recording.server = server;
          recording.recordingId = recordingId;
        }
        break;
      }
      case "uploadFinished": {
        const { id } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "uploaded";
        }
        break;
      }
      case "recordingUnusable": {
        const { id, reason } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "unusable";
          recording.unusableReason = reason;
        }
        break;
      }
      case "crashed": {
        const { id } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "crashed";
        }
        break;
      }
    }
  }

  if (includeHidden) {
    return recordings;
  }

  // There can be a fair number of recordings from gecko/chromium content
  // processes which never loaded any interesting content. These are ignored by
  // most callers. Note that we're unable to avoid generating these entries in
  // the first place because the recordings log is append-only and we don't know
  // when a recording process starts if it will ever do anything interesting.
  return recordings.filter(r => !(r.unusableReason || "").includes("No interesting content"));
}

// Convert a recording into a format for listing.
function listRecording(recording) {
  // Remove properties we only use internally.
  return { ...recording, buildId: undefined };
}

function listAllRecordings(opts = {}) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  return recordings.map(listRecording);
}

function uploadSkipReason(recording) {
  if (!["onDisk", "startedWrite", "startedUpload"].includes(recording.status)) {
    return `wrong recording status ${recording.status}`;
  }
  if (!recording.path) {
    return "recording not saved to disk";
  }
  return null;
}

function getServer(opts) {
  return opts.server || "wss://dispatch.replay.io";
}

function addRecordingEvent(dir, kind, id, tags = {}) {
  const lines = readRecordingFile(dir);
  lines.push(JSON.stringify({
    kind,
    id,
    timestamp: Date.now(),
    ...tags,
  }));
  writeRecordingFile(dir, lines);
}

function maybeLog(verbose, str) {
  if (verbose) {
    console.log(str);
  }
}

async function doUploadRecording(dir, server, recording, verbose, apiKey) {
  maybeLog(verbose, `Starting upload for ${recording.id}...`);
  const reason = uploadSkipReason(recording);
  if (reason) {
    maybeLog(verbose, `Upload failed: ${reason}`);
    return null;
  }
  let contents;
  try {
    contents = fs.readFileSync(recording.path);
  } catch (e) {
    maybeLog(verbose, `Upload failed: can't read recording from disk: ${e}`);
    return null;
  }
  if (!await initConnection(server, apiKey)) {
    maybeLog(verbose, `Upload failed: can't connect to server ${server}`);
    return null;
  }
  const recordingId = await connectionCreateRecording(recording.buildId);
  maybeLog(verbose, `Created remote recording ${recordingId}, uploading...`);
  addRecordingEvent(dir, "uploadStarted", recording.id, { server, recordingId });
  await connectionUploadRecording(recordingId, contents);
  addRecordingEvent(dir, "uploadFinished", recording.id);
  maybeLog(verbose, "Upload finished.");
  closeConnection();
  return recordingId;
}

async function uploadRecording(id, opts = {}) {
  const server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    maybeLog(opts.verbose, `Unknown recording ${id}`);
    return null;
  }
  return doUploadRecording(dir, server, recording, opts.verbose, opts.apiKey);
}

async function uploadAllRecordings(opts = {}) {
  const server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  let uploadedAll = true;
  for (const recording of recordings) {
    if (!uploadSkipReason(recording)) {
      if (!await doUploadRecording(dir, server, recording, opts.verbose, opts.apiKey)) {
        uploadedAll = false;
      }
    }
  }
  return uploadedAll;
}

// Get the executable name to use when opening a URL.
// It would be nice to use an existing npm package for this,
// but the obvious choice of "open" didn't actually work on linux
// when testing...
function openExecutable() {
  switch (process.platform) {
    case "darwin": return "open";
    case "linux": return "xdg-open";
    default: throw new Error("Unsupported platform");
  }
}

async function doViewRecording(dir, server, recording, verbose) {
  let recordingId;
  if (recording.status == "uploaded") {
    recordingId = recording.recordingId;
    server = recording.server;
  } else {
    recordingId = await doUploadRecording(dir, server, recording, verbose);
    if (!recordingId) {
      return false;
    }
  }
  const dispatch = server != "wss://dispatch.replay.io" ? `&dispatch=${server}` : "";
  spawn(openExecutable(), [`https://app.replay.io?id=${recordingId}${dispatch}`]);
  return true;
}

async function viewRecording(id, opts = {}) {
  let server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    maybeLog(opts.verbose, `Unknown recording ${id}`);
    return false;
  }
  return doViewRecording(dir, server, recording, opts.verbose);
}

async function viewLatestRecording(opts = {}) {
  let server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  if (!recordings.length) {
    maybeLog(opts.verbose, "No recordings to view");
    return false;
  }
  return doViewRecording(dir, server, recordings[recordings.length - 1], opts.verbose);
}

function maybeRemoveRecordingFile(recording) {
  if (recording.path) {
    try {
      fs.unlinkSync(recording.path);
    } catch (e) {}
  }
}

function removeRecording(id, opts = {}) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir, includeHidden);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    maybeLog(opts.verbose, `Unknown recording ${id}`);
    return false;
  }
  maybeRemoveRecordingFile(recording);

  const lines = readRecordingFile(dir).filter(line => {
    try {
      const obj = JSON.parse(line);
      if (obj.id == id) {
        return false;
      }
    } catch (e) {
      return false;
    }
    return true;
  });

  writeRecordingFile(dir, lines);
  return true;
}

function removeAllRecordings(opts = {}) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  recordings.forEach(maybeRemoveRecordingFile);
  fs.unlinkSync(getRecordingsFile(dir));
}

module.exports = {
  listAllRecordings,
  uploadRecording,
  uploadAllRecordings,
  viewRecording,
  viewLatestRecording,
  removeRecording,
  removeAllRecordings,
};
