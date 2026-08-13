param(
  [string]$OutputPath = ".codex-tmp/memoscape-source.tgz"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$outputFullPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath
} else {
  Join-Path $repoRoot $OutputPath
}

$requiredFiles = @(
  "app/work/page.tsx",
  "app/work/workbench-app.tsx",
  "app/imagegen/page.tsx",
  "app/imagegen/imagegen-settings-app.tsx"
)
$forbiddenFiles = @(
  ".dev.vars",
  "deploy/self-hosted/secrets.dev.vars"
)

Push-Location $repoRoot
try {
  # Package exactly the files Git considers source: tracked files plus
  # non-ignored new files. This avoids broad tar patterns such as "work"
  # accidentally matching the real app/work route.
  $sourceFiles = @(
    git -c core.quotepath=false ls-files --cached --others --exclude-standard |
      Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
      Sort-Object -Unique
  )
  if ($LASTEXITCODE -ne 0 -or $sourceFiles.Count -eq 0) {
    throw "Unable to enumerate source files with git ls-files."
  }

  foreach ($required in $requiredFiles) {
    if ($required -notin $sourceFiles) {
      throw "Required route source is missing from package input: $required"
    }
  }
  foreach ($forbidden in $forbiddenFiles) {
    if ($forbidden -in $sourceFiles) {
      throw "Secret file would be included in deployment package: $forbidden"
    }
  }

  $outputDirectory = Split-Path -Parent $outputFullPath
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  # Passing paths as native arguments keeps non-ASCII Windows filenames intact;
  # bsdtar's -T parser may interpret an UTF-8 list using the legacy code page.
  & tar -czf $outputFullPath @sourceFiles
  if ($LASTEXITCODE -ne 0) {
    throw "tar failed with exit code $LASTEXITCODE"
  }

  $archiveEntries = @(tar -tzf $outputFullPath)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify deployment package."
  }
  foreach ($required in $requiredFiles) {
    if ($required -notin $archiveEntries) {
      throw "Required route source was not archived: $required"
    }
  }
  foreach ($forbidden in $forbiddenFiles) {
    if ($forbidden -in $archiveEntries) {
      throw "Secret file was archived: $forbidden"
    }
  }

  Write-Host "Created $outputFullPath with $($archiveEntries.Count) source files."
} finally {
  Pop-Location
}
