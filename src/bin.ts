
import { program } from "commander";

program
  .option(
    "--server <address>",
    "Specify an alternate server for uploading recordings to."
  );

program
  .command("ls")
  .description("List information about all recordings.")
  .action(listAllRecordings);

program
  .command("upload <id>")
  .description("Upload a recording to the remote server.")
  .action(uploadRecording);

program
  .command("upload-all")
  .description("Upload all recordings to the remote server.")
  .action(uploadAllRecordings);

program
  .command("rm <id>")
  .description("Remove a specific recording.")
  .action(removeRecording);

program
  .command("rm-all")
  .description("Remove all recordings.")
  .action(removeAllRecordings);

program
  .parseAsync()
  .catch((err) => {
    console.error(err.message ?? "Unknown error");
    process.exitCode = 1;
  });

function listAllRecordings() {}
function uploadRecording() {}
function uploadAllRecordings() {}
function removeRecording() {}
function removeAllRecordings() {}
