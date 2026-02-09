module.exports = {
  apps: [{
    name: "eventhorizen",
    script: "python3",
    args: "-m uvicorn py_backend.main:app --host 0.0.0.0 --port 5000",
    cwd: "/root/eventhorizen",
    env: {
      NODE_ENV: "production",
      PORT: 5000
    }
  }]
};
