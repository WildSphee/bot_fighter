import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const services = [
  {
    name: "backend",
    command: npmCommand,
    args: ["run", "dev:backend"],
    env: {
      API_PORT: process.env.API_PORT ?? "8787",
      API_HOST: process.env.API_HOST ?? "0.0.0.0",
    },
  },
  {
    name: "portal",
    command: npmCommand,
    args: ["run", "dev:portal"],
    env: {
      PORT: process.env.PORT ?? "5173",
    },
  },
];

const children = new Map();
let shuttingDown = false;

for (const service of services) {
  startService(service);
}

process.on("SIGINT", () => stopAll("SIGINT", 0));
process.on("SIGTERM", () => stopAll("SIGTERM", 0));

function startService(service) {
  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...service.env,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.set(service.name, child);
  console.log(`[dev] started ${service.name}: ${service.command} ${service.args.join(" ")}`);

  pipeWithPrefix(service.name, child.stdout);
  pipeWithPrefix(service.name, child.stderr);

  child.on("exit", (code, signal) => {
    children.delete(service.name);

    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev] ${service.name} exited with ${reason}`);
    stopAll("service-exit", code === 0 ? 0 : 1);
  });
}

function pipeWithPrefix(name, stream) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.length > 0) {
        console.log(`[${name}] ${line}`);
      }
    }
  });
}

function stopAll(reason, exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[dev] stopping services (${reason})`);

  for (const child of children.values()) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const child of children.values()) {
      child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 3500).unref();

  if (children.size === 0) {
    process.exit(exitCode);
  }
}
