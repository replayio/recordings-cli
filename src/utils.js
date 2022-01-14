
function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function maybeLog(verbose, str) {
  if (verbose) {
    console.log(str);
  }
}

module.exports = { defer, maybeLog };
