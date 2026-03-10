import { execSync } from "node:child_process";

const inputs = process.argv.slice(2);
const ports = inputs.length > 0 ? inputs.map((i) => Number.parseInt(i, 10)) : [3000];

for (const port of ports) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`无效端口: ${port}`);
    process.exit(1);
  }
}

const run = (command) => execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const getPidsByPort = (port) => {
  try {
    if (process.platform === "win32") {
      const output = run("netstat -ano -p tcp");
      return Array.from(
        new Set(
          output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.includes("LISTENING"))
            .filter((line) => {
              const parts = line.split(/\s+/);
              return parts.length >= 5 && parts[1]?.endsWith(`:${port}`);
            })
            .map((line) => {
              const parts = line.split(/\s+/);
              return Number.parseInt(parts[parts.length - 1], 10);
            })
            .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
        ),
      );
    }

    const output = run(`lsof -ti tcp:${port}`);
    return Array.from(
      new Set(
        output
          .split(/\r?\n/)
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
      ),
    );
  } catch {
    return [];
  }
};

for (const port of ports) {
  const pids = getPidsByPort(port);

  if (pids.length === 0) {
    console.log(`[free-port] 端口 ${port} 空闲`);
    continue;
  }

  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        run(`taskkill /PID ${pid} /F`);
      } else {
        run(`kill -9 ${pid}`);
      }
      console.log(`[free-port] 已释放端口 ${port}（PID ${pid}）`);
    } catch (error) {
      console.error(`[free-port] 释放端口失败（PID ${pid}）`);
      // 不退出，继续尝试释放其他端口
    }
  }
}
