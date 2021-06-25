# recordings-cli

CLI tool for managing and uploading [Replay](https://replay.io) recordings.

## Overview

When using the Replay versions of node, playwright, or puppeteer, recordings which are created are saved to disk, by default in `$HOME/.replay`.  This CLI tool is used to manage these recordings and upload them to the record/replay web service so that they can be viewed.

## Installation

`npm i @recordreplay/recordings-cli --global`

## Usage

`replay-recordings <command>`

Possible commands are given below.  These may be used with the `--directory <dir>` option to override the default recording directory, or `--server <address>` to override the default server address.

### ls

View information about all known recordings.  Prints a JSON array with one descriptor element for each recording.  Recording descriptors have the following required properties:

* `id`: ID used to refer to this recording in other commands.
* `createTime`: Time when the recording was created.
* `runtime`: Runtime used to create the recording: either `gecko`, `chromium`, or `node`.
* `metadata`: Any information the runtime associated with this recording.  For gecko/chromium recordings this is the URI of the first page loaded, and for node recordings this is the original command line arguments.
* `status`: Status of the recording, see below for possible values.

The possible status values for a recording are as follows:

* `onDisk`: The recording was fully written out to disk.
* `uploaded`: The recording was fully uploaded to the record/replay web service.
* `startedWrite`: The recording started being written to disk but wasn't finished.  Either the recording process is still running, or the recording process was killed and didn't shut down normally.
* `startedUpload`: The recording started being uploaded but didn't finish.
* `unusable`: The recording was marked as unusable for some reason, such as a stack overflow occurring.
* `crashed`: The recording process crashed before finishing.

Depending on the status the recording descriptor can have some of the following additional properties:

* `path`: If the recording started being written to disk (including before being uploaded), the path to the recording file.
* `server`: If the recording started being uploaded, the address of the server it was uploaded to.
* `recordingId`: If the recording started being uploaded, the server-assigned ID for this recording which can be used to view it.
* `unusableReason`: If the recording is unusable, the reason it was marked unusable.

### upload <id>

Upload the recording with the given ID to the web service.

### upload-all

Upload all recordings to the web service which can be uploaded.

### rm <id>

Remove the recording with the given ID and any on disk file for it.

### rm-all

Remove all recordings and on disk recording files.
