import { cpus, totalmem, freemem, uptime, hostname, platform, arch, loadavg } from "os";
import { execSync } from "child_process";

export interface SystemStatus {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: {
    model: string;
    cores: number;
    loadAvg: number[];
  };
  memory: {
    total: string;
    used: string;
    free: string;
    usedPercent: number;
  };
  disk: DiskInfo[];
  topProcesses: ProcessInfo[];
}

interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usedPercent: string;
  mount: string;
}

interface ProcessInfo {
  pid: string;
  cpu: string;
  mem: string;
  command: string;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function getDiskInfo(): DiskInfo[] {
  try {
    const output = execSync("df -h --output=source,size,used,avail,pcent,target 2>/dev/null || df -h", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const lines = output.trim().split("\n").slice(1);
    return lines
      .filter((line) => line.startsWith("/"))
      .map((line) => {
        const parts = line.split(/\s+/);
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usedPercent: parts[4],
          mount: parts[5],
        };
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

function getTopProcesses(): ProcessInfo[] {
  try {
    const output = execSync(
      "ps aux --sort=-%cpu 2>/dev/null | head -6 || ps aux | head -6",
      { encoding: "utf-8", timeout: 5000 }
    );
    const lines = output.trim().split("\n").slice(1);
    return lines.map((line) => {
      const parts = line.split(/\s+/);
      return {
        pid: parts[1],
        cpu: parts[2] + "%",
        mem: parts[3] + "%",
        command: parts.slice(10).join(" ").slice(0, 60),
      };
    });
  } catch {
    return [];
  }
}

export function getSystemStatus(): SystemStatus {
  const cpuInfo = cpus();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;

  return {
    hostname: hostname(),
    platform: `${platform()} ${arch()}`,
    arch: arch(),
    uptime: formatUptime(uptime()),
    cpu: {
      model: cpuInfo[0]?.model ?? "unknown",
      cores: cpuInfo.length,
      loadAvg: loadavg().map((v) => Math.round(v * 100) / 100),
    },
    memory: {
      total: formatBytes(totalMem),
      used: formatBytes(usedMem),
      free: formatBytes(freeMem),
      usedPercent: Math.round((usedMem / totalMem) * 100),
    },
    disk: getDiskInfo(),
    topProcesses: getTopProcesses(),
  };
}
