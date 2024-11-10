# C:\Users\anh.phungtuan1\Documents\PowerShell\Microsoft.PowerShell_profile.ps1

function gitFetchPruneThenPull {
  git branch
  git fetch --prune
  git pull
}
Set-Alias gfp gitFetchPruneThenPull

function startNotepadPlusPlus {
  Start-Process notepad++
}
Set-Alias note startNotepadPlusPlus
Set-Alias notepad startNotepadPlusPlus

Invoke-Expression (&starship init powershell)
$ENV:STARSHIP_CONFIG = "$env:APPDATA\starship\starship.toml"

# proto
$env:PROTO_HOME = Join-Path $HOME ".proto"
$env:PATH = @(
  (Join-Path $env:PROTO_HOME "shims"),
  (Join-Path $env:PROTO_HOME "bin"),
  $env:PATH
) -join [IO.PATH]::PathSeparator
# go
$env:GOBIN = Join-Path $HOME "go" "bin"
$env:PATH = @(
  (Join-Path $env:GOBIN ""),
  $env:PATH
) -join [IO.PATH]::PathSeparator