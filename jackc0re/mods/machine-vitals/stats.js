// Windows port: one PowerShell call per sample (CIM counters), printed as JSON.
// No Herdr imports, so tests can load this file with plain Node.

const GIB = 2 ** 30;

export const SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$c=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime",
  "$o=Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory",
  "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$env:SystemDrive'\" -Property Size,FreeSpace",
  "$b=Get-CimInstance Win32_Battery -Property EstimatedChargeRemaining,BatteryStatus | Select-Object -First 1",
  "@{cpu=$c;memTotal=[double]$o.TotalVisibleMemorySize*1024;memFree=[double]$o.FreePhysicalMemory*1024;" +
    "commitTotal=[double]$o.TotalVirtualMemorySize*1024;commitFree=[double]$o.FreeVirtualMemory*1024;" +
    "diskTotal=[double]$d.Size;diskFree=[double]$d.FreeSpace;drive=$env:SystemDrive;" +
    "batt=$b.EstimatedChargeRemaining;battStatus=$b.BatteryStatus} | ConvertTo-Json -Compress",
].join("\n");

// Asked only while the pointer is on the CPU row: the busiest processes right now.
export const PROCS = [
  "$n=[Environment]::ProcessorCount",
  "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property Name,PercentProcessorTime |",
  " Where-Object { $_.Name -notin '_Total','Idle','pwsh','powershell','WmiPrvSE' } |",
  " Sort-Object PercentProcessorTime -Descending | Select-Object -First 3 |",
  " ForEach-Object { '{0} {1}' -f ($_.PercentProcessorTime / $n), ($_.Name -replace '#\\d+$','') }",
].join("\n");

// Win32_Battery BatteryStatus: 2 = on AC, 6-9 = charging.
const BATT = { 1: "discharging", 2: "on AC", 3: "fully charged", 4: "low", 5: "critical", 6: "charging", 7: "charging", 8: "charging", 9: "charging", 11: "partially charged" };

export function parse(out) {
  const j = JSON.parse(out.trim());
  const memUsed = j.memTotal - j.memFree;
  const commitUsed = j.commitTotal - j.commitFree;
  const memPct = j.memTotal ? memUsed / j.memTotal : 0;
  const commitPct = j.commitTotal ? commitUsed / j.commitTotal : 0;
  // A stand-in for macOS memory pressure: 1 normal, 2 warning, 4 critical.
  const worst = Math.max(memPct, commitPct);
  const pressure = worst >= 0.92 ? 4 : worst >= 0.8 ? 2 : 1;
  return {
    cpu: typeof j.cpu === "number" ? Math.max(0, Math.min(100, j.cpu)) : null,
    mem: { used: memUsed, total: j.memTotal || 0, pressure },
    swap: Math.max(0, commitUsed - memUsed),
    disk: j.diskTotal ? { total: j.diskTotal, free: j.diskFree, drive: j.drive } : null,
    battery: typeof j.batt === "number"
      ? { pct: j.batt, state: BATT[j.battStatus] ?? "unknown", ac: [2, 3, 6, 7, 8, 9, 11].includes(j.battStatus) }
      : null,
  };
}

export function parseProcs(out, count = 3) {
  return out.split(/\r?\n/)
    .map((l) => l.match(/^\s*([\d.]+)\s+(.+?)\s*$/))
    .filter(Boolean)
    .slice(0, count)
    .map((m) => ({ name: m[2], cpu: Number(m[1]) }));
}

export const gb = (bytes) => String(bytes / GIB >= 100 ? Math.round(bytes / GIB) : Math.round((bytes / GIB) * 10) / 10);
