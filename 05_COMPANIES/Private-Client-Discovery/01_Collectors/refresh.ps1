param([string]$Python='python',[string]$Node='node')
$ErrorActionPreference='Stop'
$moduleRoot=Split-Path $PSScriptRoot -Parent
$companies=Split-Path $moduleRoot -Parent
$repository=Split-Path $companies -Parent
$archive=if($env:GAGARIN_CLIENT_ARCHIVE){$env:GAGARIN_CLIENT_ARCHIVE}else{Join-Path (Split-Path $repository -Parent) '05_COMPANIES\Private-Client-Discovery'}
$work=Join-Path $archive ('Refresh-Inputs\'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work -Force | Out-Null
$lock=Join-Path $moduleRoot 'refresh.lock'
$handle=$null
try {
 $handle=[System.IO.File]::Open($lock,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
 Invoke-WebRequest -Uri 'https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx' -OutFile (Join-Path $work 'companies.xlsx')
 & $Node (Join-Path $PSScriptRoot 'suppliers.cjs') $repository (Join-Path $work 'suppliers.jsonl')
 if($LASTEXITCODE -ne 0){throw 'Supplier input failed; last master retained'}
 & $Python (Join-Path $PSScriptRoot 'clients.py') build --root $moduleRoot --archive $archive --xlsx (Join-Path $work 'companies.xlsx') --suppliers (Join-Path $work 'suppliers.jsonl')
 if($LASTEXITCODE -ne 0){throw 'Build failed; last master retained'}
} finally {
 if($null -ne $handle){$handle.Dispose();Remove-Item -LiteralPath $lock}
}
