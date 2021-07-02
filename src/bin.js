const fs = require("fs");
const { program } = require("commander");
const { initConnection, createRecording, uploadRecording } = require("./upload");
const open = require("open");

program
  .command("ls")
  .description("List information about all recordings.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .option(
    "--include-hidden",
    "Show recordings that are normally hidden."
  )
  .action(commandListAllRecordings);

program
  .command("upload <id>")
  .description("Upload a recording to the remote server.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .option(
    "--server <address>",
    "Alternate server to upload recordings to."
  )
  .action(commandUploadRecording);

program
  .command("upload-all")
  .description("Upload all recordings to the remote server.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .option(
    "--server <address>",
    "Alternate server to upload recordings to."
  )
  .action(commandUploadAllRecordings);

program
  .command("view <id>")
  .description("Load the devtools on a recording, uploading it if needed.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .option(
    "--server <address>",
    "Alternate server to upload recordings to."
  )
  .action(commandViewRecording);

program
  .command("view-latest")
  .description("Load the devtools on the latest recording, uploading it if needed.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .option(
    "--server <address>",
    "Alternate server to upload recordings to."
  )
  .action(commandViewLatestRecording);

program
  .command("rm <id>")
  .description("Remove a specific recording.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .action(commandRemoveRecording);

program
  .command("rm-all")
  .description("Remove all recordings.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
  )
  .action(commandRemoveAllRecordings);

program
  .parseAsync()
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });

function getDirectory(opts) {
  return opts.directory || process.env.RECORD_REPLAY_DIRECTORY || `${process.env.HOME}/.replay`;
}

function getRecordingsFile(dir) {
  return `${dir}/recordings.log`;
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

function readRecordings(dir, ignoreHidden) {
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

  if (!ignoreHidden) {
    return recordings;
  }

  // There can be a fair number of recordings from gecko/chromium content
  // processes which never loaded any interesting content. These are hidden by
  // default.
  return recordings.filter(r => !(r.unusableReason || "").includes("No interesting content"));
}

// Convert a recording into a format for listing.
function listRecording(recording) {
  // Remove properties we only use internally.
  return { ...recording, buildId: undefined };
}

function commandListAllRecordings(opts) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir, !opts.includeHidden);
  const listRecordings = recordings.map(listRecording);
  console.log(JSON.stringify(listRecordings, null, 2));
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

async function maybeUploadRecording(dir, server, recording) {
  console.log(`Starting upload for ${recording.id}...`);
  const reason = uploadSkipReason(recording);
  if (reason) {
    console.log(`Upload failed: ${reason}`);
    return null;
  }
  let contents;
  try {
    contents = fs.readFileSync(recording.path);
  } catch (e) {
    console.log(`Upload failed: can't read recording from disk: ${e}`);
    return null;
  }
  if (!await initConnection(server)) {
    console.log(`Upload failed: can't connect to server ${server}`);
    return null;
  }
  const recordingId = await createRecording(recording.buildId);
  console.log(`Created remote recording ${recordingId}, uploading...`);
  addRecordingEvent(dir, "uploadStarted", recording.id, { server, recordingId });
  await uploadRecording(recordingId, contents);
  addRecordingEvent(dir, "uploadFinished", recording.id);
  console.log("Upload finished.");
  return recordingId;
}

async function commandUploadRecording(id, opts) {
  const server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    console.log(`Unknown recording ${id}`);
    process.exit(1);
  }
  const recordingId = await maybeUploadRecording(dir, server, recording);
  process.exit(recordingId ? 0 : 1);
}

async function commandUploadAllRecordings(opts) {
  const server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  let uploadedAll = true;
  for (const recording of recordings) {
    if (!uploadSkipReason(recording)) {
      const recordingId = await maybeUploadRecording(dir, server, recording);
      uploadedAll &&= !!uploaded;
    }
  }
  process.exit(uploadedAll ? 0 : 1);
}

async function viewRecording(dir, server, recording) {
  let recordingId;
  if (recording.status == "uploaded") {
    recordingId = recording.recordingId;
    server = recording.server;
  } else {
    recordingId = await maybeUploadRecording(dir, server, recording);
    if (!recordingId) {
      return false;
    }
  }
  const dispatch = server != "wss://dispatch.replay.io" ? `&dispatch=${server}` : "";
  open(`https://app.replay.io?id=${recordingId}${dispatch}`);
  return true;
}

async function commandViewRecording(id, opts) {
  let server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    console.log(`Unknown recording ${id}`);
    process.exit(1);
  }
  const viewed = await viewRecording(dir, server, recording);
  process.exit(viewed ? 0 : 1);
}

async function commandViewLatestRecording(id, opts) {
  let server = getServer(opts);
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir, /* ignoreHidden */ true);
  if (!recordings.length) {
    console.log("No recordings to view");
    process.exit(1);
  }
  const viewed = await viewRecording(dir, server, recordings[recordings.length - 1]);
  process.exit(viewed ? 0 : 1);
}

function maybeRemoveRecordingFile(recording) {
  if (recording.path) {
    try {
      fs.unlinkSync(recording.path);
    } catch (e) {}
  }
}

function commandRemoveRecording(id, opts) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  const recording = recordings.find(r => r.id == id);
  if (!recording) {
    console.log(`Unknown recording ${id}`);
    process.exit(1);
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
}

function commandRemoveAllRecordings(opts) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  recordings.forEach(maybeRemoveRecordingFile);
  fs.unlinkSync(getRecordingsFile(dir));
}
