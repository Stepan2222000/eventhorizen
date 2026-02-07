module.exports = {
  apps: [{
    name: "eventhorizen",
    script: "./dist/index.js",
    cwd: "/root/eventhorizen",
    env: {
      NODE_ENV: "production",
      PORT: 3001
    }
  }]
};
