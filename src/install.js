// Manage installation of browsers for other NPM packages.

const { spawnSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { defer, getDirectory } = require("./utils");

async function ensurePlaywrightBrowsersInstalled(kind = "all") {
  switch (process.platform) {
    case "darwin":
      if (["all", "gecko"].includes(kind)) {
        await installReplayBrowser("macOS-replay-playwright.tar.xz", "firefox", "firefox");
      }
      break;
    case "linux":
      if (["all", "gecko"].includes(kind)) {
        await installReplayBrowser("linux-replay-playwright.tar.xz", "firefox", "firefox");
      }
      if (["all", "chromium"].includes(kind)) {
        await installReplayBrowser("linux-replay-chromium.tar.xz", "replay-chromium", "chrome-linux");
      }
      break;
  }
}

function getPlaywrightBrowserPath(kind) {
  const replayDir = getDirectory();

  switch (`${process.platform}:${kind}`) {
    case "darwin:gecko":
      return path.join(replayDir, "playwright", "firefox", "Nightly.app", "Contents", "MacOS", "firefox");
    case "linux:gecko":
      return path.join(replayDir, "playwright", "firefox", "firefox");
    case "linux:chromium":
      return path.join(replayDir, "playwright", "chrome-linux", "chrome");
  }
  return null;
}

async function installReplayBrowser(name, srcName, dstName) {
  const replayDir = getDirectory();
  const playwrightDir = path.join(replayDir, "playwright");

  if (fs.existsSync(path.join(playwrightDir, dstName))) {
    return;
  }

  const contents = await downloadReplayFile(name);

  for (const dir of [replayDir, playwrightDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
  }
  fs.writeFileSync(path.join(playwrightDir, name), contents);
  spawnSync("tar", ["xf", name], { cwd: playwrightDir });
  fs.unlinkSync(path.join(playwrightDir, name));

  if (srcName != dstName) {
    fs.renameSync(path.join(playwrightDir, srcName), path.join(playwrightDir, dstName));
  }
}

async function downloadReplayFile(downloadFile) {
  const options = {
    host: "static.replay.io",
    port: 443,
    path: `/downloads/${downloadFile}`,
  };

  for (let i = 0; i < 5; i++) {
    const waiter = defer();
    const request = https.get(options, response => {
      if (response.statusCode != 200) {
        console.log(`Download received status code ${response.statusCode}, retrying...`);
        request.destroy();
        waiter.resolve(null);
        return;
      }
      const buffers = [];
      response.on("data", data => buffers.push(data));
      response.on("end", () => waiter.resolve(buffers));
    });
    request.on("error", err => {
      console.log(`Download error ${err}, retrying...`);
      request.destroy();
      waiter.resolve(null);
    });
    const buffers = await waiter.promise;
    if (buffers) {
      return Buffer.concat(buffers);
    }
  }

  throw new Error("Download failed, giving up");
}

module.exports = { ensurePlaywrightBrowsersInstalled, getPlaywrightBrowserPath };
