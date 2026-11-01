# Récupère origin/main toutes les 60 s ; abandonne proprement en cas de conflit.
Set-Location (Split-Path $PSScriptRoot -Parent)
while ($true) {
  git fetch --quiet origin 2>$null
  $behind = git rev-list --count HEAD..origin/main 2>$null
  if ($behind -gt 0) {
    git pull --rebase --autostash --quiet origin main
    if ($LASTEXITCODE -ne 0) { git rebase --abort 2>$null; Write-Host "[auto-pull] conflit : à résoudre à la main" }
    else { Write-Host "[auto-pull] $(Get-Date -Format HH:mm:ss) : $behind commit(s) récupéré(s)" }
  }
  Start-Sleep -Seconds 60
}
