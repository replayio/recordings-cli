const fs = require("fs");
const { program } = require("commander");

program
  .command("ls")
  .description("List information about all recordings.")
  .option(
    "--directory <dir>",
    "Alternate recording directory."
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
    console.error(err.message ?? "Unknown error");
    process.exitCode = 1;
  });

function getDirectory(opts) {
  return opts.directory || `${process.env.HOME}/.replay`;
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

function readRecordings(dir) {
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
        const { id, timestamp, buildId, driverVersion } = obj;
        recordings.push({
          id,
          createTime: (new Date(timestamp)).toString(),
          buildId,
          driverVersion,
          metadata: {},
          status: "created",
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
      case "writeRecording": {
        const { id, path, size } = obj;
        const recording = recordings.find(r => r.id == id);
        if (recording) {
          recording.status = "onDisk";
          recording.path = path;
          recording.size = size;
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

  return recordings;
}

function commandListAllRecordings(opts) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  console.log(JSON.stringify(recordings, null, 2));
}

function commandUploadRecording(id, opts) {}
function commandUploadAllRecordings(opts) {}

function maybeRemoveRecording(recording) {
  if (recording.status == "onDisk") {
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
  maybeRemoveRecording(recording);

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

  fs.writeFileSync(getRecordingsFile(dir), lines.join("\n"));
}

function commandRemoveAllRecordings(opts) {
  const dir = getDirectory(opts);
  const recordings = readRecordings(dir);
  recordings.forEach(maybeRemoveRecording);
  fs.unlinkSync(getRecordingsFile(dir));
}
