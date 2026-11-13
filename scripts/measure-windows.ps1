param([Parameter(Mandatory = $true)][int]$AppProcessId, [string]$OutputPath = '.cache/idle-resources.json', [switch]$MemoryOnly)
$ErrorActionPreference = 'Stop'

function Get-AppProcessIds {
    $taskProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $taskIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$taskIds.Add($AppProcessId)
    do {
        $taskAdded = $false
        foreach ($taskProcess in $taskProcesses) {
            if ($taskIds.Contains([int]$taskProcess.ParentProcessId) -and $taskIds.Add([int]$taskProcess.ProcessId)) { $taskAdded = $true }
        }
    } while ($taskAdded)
    return ,$taskIds
}

$taskIds = Get-AppProcessIds
$taskMemory = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $taskIds.Contains([int]$_.IDProcess) }
$taskPrivateWorkingSet = ($taskMemory | Measure-Object -Property WorkingSetPrivate -Sum).Sum
$taskCpuBefore = @{}
foreach ($taskId in $taskIds) {
    try { $taskCpuBefore[$taskId] = (Get-Process -Id $taskId).TotalProcessorTime.TotalMilliseconds } catch {}
}
$taskTimer = [System.Diagnostics.Stopwatch]::StartNew()
if (-not $MemoryOnly) { Start-Sleep -Seconds 60 }
$taskCpuDelta = 0.0
foreach ($taskId in $taskIds) {
    try { $taskCpuDelta += [Math]::Max(0, (Get-Process -Id $taskId).TotalProcessorTime.TotalMilliseconds - $taskCpuBefore[$taskId]) } catch {}
}
$taskTimer.Stop()
$taskResult = [ordered]@{
    processCount = $taskMemory.Count
    privateWorkingSetMiB = [Math]::Round($taskPrivateWorkingSet / 1MB, 2)
    idleCpuPercentMachine = if ($MemoryOnly) { $null } else { [Math]::Round(100 * $taskCpuDelta / $taskTimer.Elapsed.TotalMilliseconds / [Environment]::ProcessorCount, 4) }
    sampleSeconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 2)
    logicalProcessors = [Environment]::ProcessorCount
    memoryMetric = 'Sum of Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate for app and descendants'
}
$taskResult | ConvertTo-Json | Set-Content -LiteralPath $OutputPath
$taskResult | ConvertTo-Json
