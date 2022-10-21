module.exports = {
    norpc: true,
    testCommand: "npm run test",
    compileCommand: "npm run compile",
    skipFiles: [
      './interfaces',
      './oz',
      './test',
      './utils'
    ],
    mocha: {
      fgrep: "[skip-on-coverage]",
      invert: true,
    },
  };