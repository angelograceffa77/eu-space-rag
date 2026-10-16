param([Parameter(Mandatory=$true)][string]$Uri,[Parameter(Mandatory=$true)][string]$OutFile,[switch]$Binary)
$ErrorActionPreference='Stop'
for($attempt=0;$attempt -lt 3;$attempt++){
 try {
  if($Binary){$response=Invoke-WebRequest -Uri $Uri -TimeoutSec 60 -OutFile $OutFile -PassThru}
  else {$response=Invoke-WebRequest -Uri $Uri -TimeoutSec 60;[IO.File]::WriteAllText($OutFile,$response.Content,[Text.UTF8Encoding]::new($false))}
  [IO.File]::WriteAllText(($OutFile+'.headers.json'),($response.Headers | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  exit 0
 } catch {if($attempt -eq 2){throw};Start-Sleep -Seconds (2*($attempt+1))}
}
